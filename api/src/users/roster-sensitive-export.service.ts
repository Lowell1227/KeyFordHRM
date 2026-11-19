import { BadRequestException, ForbiddenException, HttpException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDecipheriv, createHash } from 'crypto';
import { Worker } from 'worker_threads';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { canExportArchiveFields } from './roster-export-catalog';

export interface SensitiveExportCredentials { accountPassword: string; filePassword: string }

@Injectable()
export class RosterSensitiveExportService {
  // Current deployment is a single API process. Bounded per-actor attempts are
  // reserved synchronously before bcrypt; parallel requests cannot bypass them.
  private attempts = new Map<string, { count: number; until: number }>();
  private encryptionJobs = 0;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async authorize(viewer: AuthUser, input: SensitiveExportCredentials): Promise<void> {
    if (!['system_admin', 'hr', 'hr_user'].includes(viewer.sysRole) || !canExportArchiveFields(viewer)) {
      throw new ForbiddenException('没有导出身份证号或银行卡号的权限');
    }
    if (typeof input?.accountPassword !== 'string' || !input.accountPassword || input.accountPassword.length > 128) {
      throw new BadRequestException('请输入当前账号密码');
    }
    if (typeof input.filePassword !== 'string' || input.filePassword.length < 4 || input.filePassword.length > 64 || !input.filePassword.trim()) {
      throw new BadRequestException('Excel打开密码须为4至64位');
    }
    if (input.accountPassword === input.filePassword) throw new BadRequestException('Excel打开密码不能与账号密码相同');
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(key);
    const entry = this.attempts.get(viewer.id) ?? { count: 0, until: now + 15 * 60_000 };
    if (entry.count >= 5) throw new HttpException('密码尝试次数过多，请15分钟后再试', 429);
    if (this.attempts.size >= 10000 && !this.attempts.has(viewer.id)) throw new HttpException('请稍后再试', 429);
    entry.count++; this.attempts.set(viewer.id, entry);
    const actor = await this.prisma.user.findUnique({ where: { id: viewer.id }, select: {
      passwordHash: true, mustChangePassword: true, status: true, deletedAt: true, archivedAt: true,
    } });
    if (!actor || actor.deletedAt || actor.archivedAt || !['active', 'probation'].includes(actor.status)) {
      throw new ForbiddenException('当前账号不可导出身份证号或银行卡号');
    }
    if (!actor.passwordHash || actor.mustChangePassword) throw new ForbiddenException('请先设置或修改当前账号密码，再导出身份证号或银行卡号');
    if (!await bcrypt.compare(input.accountPassword, actor.passwordHash)) throw new ForbiddenException('账号密码不正确');
    this.attempts.delete(viewer.id);
  }

  decryptIdentity(value: Buffer | Uint8Array | null | undefined, label: '身份证' | '银行卡' = '身份证'): string {
    if (value == null) return '';
    const secret = this.config.get<string>('EMPLOYEE_ARCHIVE_ENCRYPTION_KEY') ?? this.config.get<string>('JWT_SECRET');
    try {
      const data = Buffer.from(value);
      if (!secret || data.length < 30 || data[0] !== 1) throw new Error();
      const key = createHash('sha256').update(`employee-archive:${secret}`).digest();
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(1, 13));
      decipher.setAuthTag(data.subarray(13, 29));
      try { return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8'); }
      finally { key.fill(0); }
    } catch { throw new InternalServerErrorException(`${label}资料解密失败，请联系管理员核对资料`); }
  }

  async encryptWorkbook(plain: Buffer, password: string): Promise<Buffer> {
    if (this.encryptionJobs >= 2) throw new HttpException('加密导出繁忙，请稍后再试', 429);
    this.encryptionJobs++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const worker = new Worker(`const {parentPort,workerData}=require('worker_threads');
          const source=Buffer.from(workerData.data);try {
            const encrypted=require(workerData.library).encrypt(source,{password:workerData.password});
            parentPort.postMessage(encrypted);
          } catch { parentPort.postMessage(null); } finally {source.fill(0);workerData.password='';}`, {
          eval: true, workerData: { library: require.resolve('officecrypto-tool'), data: plain, password },
        });
        const fail = () => reject(new InternalServerErrorException('Excel加密失败，请重试'));
        const timer = setTimeout(() => { void worker.terminate(); fail(); }, 60_000);
        worker.once('message', output => { clearTimeout(timer); if (output) resolve(Buffer.from(output)); else fail(); void worker.terminate(); });
        worker.once('error', () => { clearTimeout(timer); fail(); });
        worker.once('exit', () => { clearTimeout(timer); fail(); });
      });
    } finally { this.encryptionJobs--; }
  }
}
