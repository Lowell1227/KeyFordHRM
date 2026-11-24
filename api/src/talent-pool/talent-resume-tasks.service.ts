import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus,
  Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma, TalentResumeTask } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'crypto';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { TalentResumeService, validateResumeFile } from './talent-resume.service';
import { assertRecruitmentEditor } from './talent-recruitment-policy';

export const RESUME_TASK_WAIT_MS = 150_000;
export const RESUME_TASK_TTL_MS = 30 * 60_000;
const TIMEOUT_MESSAGE = '解析已超时，可重试或手工填写';
const SELECT = {
  id: true, ownerId: true, context: true, fingerprint: true, status: true, stage: true,
  metadataEncrypted: true, resultEncrypted: true, message: true,
  createdAt: true, selectedAt: true, deadlineAt: true, expiresAt: true,
} satisfies Prisma.TalentResumeTaskSelect;
type TaskRow = Omit<TalentResumeTask, 'fileEncrypted'>;

@Injectable()
export class TalentResumeTasksService implements OnModuleDestroy {
  private readonly active = new Map<string, { controller: AbortController; deadline: number }>();

  constructor(private readonly db: PrismaService, private readonly config: ConfigService,
    private readonly resumes: TalentResumeService) {}

  private authorize(user: AuthUser) {
    if (!user?.id || user.isAssessorOnly || (!hasHrCapability(user, 'recruitment_edit') && !hasHrCapability(user, 'employee_archive_edit'))) throw new ForbiddenException('无权限解析人才简历');
  }

  private context(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new BadRequestException('解析页面标识无效');
    return value;
  }

  private key() {
    const value = this.config.get<string>('AI_PROVIDER_ENCRYPTION_KEY');
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new ServiceUnavailableException('AI 加密配置不可用');
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32 || key.toString('base64') !== value) throw new ServiceUnavailableException('AI 加密配置不可用');
    return key;
  }

  private encrypt(value: Buffer, id: string, owner: string, kind: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`resume-task:v1:${id}:${owner}:${kind}`));
    const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
  }

  private decrypt(value: Uint8Array, row: TaskRow, kind: string): Buffer {
    try {
      const bytes = Buffer.from(value);
      if (bytes.length < 29 || bytes[0] !== 1) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(1, 13));
      cipher.setAAD(Buffer.from(`resume-task:v1:${row.id}:${row.ownerId}:${kind}`));
      cipher.setAuthTag(bytes.subarray(13, 29));
      return Buffer.concat([cipher.update(bytes.subarray(29)), cipher.final()]);
    } catch { throw new ServiceUnavailableException('临时解析资料不可读取，请重新添加文件'); }
  }

  private metadata(row: TaskRow): { fileName: string; mimeType: string } {
    return JSON.parse(this.decrypt(row.metadataEncrypted, row, 'metadata').toString('utf8'));
  }

  private view(row: TaskRow) {
    return {
      id: row.id, context: row.context, status: row.status, stage: row.stage,
      fileName: this.metadata(row).fileName, createdAt: row.createdAt.toISOString(),
      deadlineAt: row.deadlineAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      ...(row.message ? { message: row.message } : {}),
      ...(row.status === 'succeeded' && row.resultEncrypted
        ? { result: JSON.parse(this.decrypt(row.resultEncrypted, row, 'result').toString('utf8')) } : {}),
    };
  }

  private async expire(db = this.db) {
    const now = new Date(Date.now());
    await db.talentResumeTask.updateMany({ where: { status: 'processing', deadlineAt: { lte: now } },
      data: { status: 'timed_out', message: TIMEOUT_MESSAGE } });
    for (const item of this.active.values()) if (item.deadline <= now.getTime()) item.controller.abort();
  }

  private async owned(id: string, user: AuthUser, includeFile = false) {
    this.authorize(user);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('解析任务不存在或已过期');
    await this.expire();
    const row = await this.db.talentResumeTask.findFirst({
      where: { id, ownerId: user.id, expiresAt: { gt: new Date(Date.now()) } },
      select: { ...SELECT, ...(includeFile ? { fileEncrypted: true } : {}) },
    });
    if (!row) throw new NotFoundException('解析任务不存在或已过期');
    return row;
  }

  async get(id: string, user: AuthUser) { return this.view(await this.owned(id, user)); }

  async current(context: string, user: AuthUser) {
    this.authorize(user); this.context(context);
    await this.expire();
    const row = await this.db.talentResumeTask.findFirst({
      where: { ownerId: user.id, context, expiresAt: { gt: new Date(Date.now()) } },
      orderBy: [{ selectedAt: 'desc' }, { id: 'desc' }], select: SELECT,
    });
    return row ? this.view(row) : null;
  }

  async start(file: Express.Multer.File | undefined, context: string, user: AuthUser) {
    return this.admit(file, context, user);
  }

  private async admit(file: Express.Multer.File | undefined, context: string, user: AuthUser, retrySourceId?: string) {
    this.authorize(user); this.context(context);
    const status = await this.resumes.getStatus(user);
    if (!status.enabled) throw new ServiceUnavailableException('简历解析未启用，请手工填写');
    if (!status.configured) throw new ServiceUnavailableException('请先保存并测试当前 DeepSeek 配置');
    const document = await validateResumeFile(file);
    const fingerprint = createHmac('sha256', this.key()).update(user.id).update(context).update(file!.buffer).update(file!.originalname).digest('hex');
    const now = new Date(Date.now());
    const outcome = await this.db.$transaction(async tx => {
      // Serialize admission across API processes; do not hold this lock during AI requests.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(126012, 19019)`;
      await assertRecruitmentEditor(tx, user);
      await this.expire(tx as PrismaService);
      if (retrySourceId && !await tx.talentResumeTask.findFirst({ where: {
        id: retrySourceId, ownerId: user.id, context, expiresAt: { gt: now },
      }, select: { id: true } })) throw new NotFoundException('解析任务不存在或已过期');
      const latest = await tx.talentResumeTask.findFirst({ where: { ownerId: user.id, context, expiresAt: { gt: now } },
        orderBy: [{ selectedAt: 'desc' }, { id: 'desc' }], select: SELECT });
      const selectedAt = new Date(Math.max(now.getTime(), (latest?.selectedAt.getTime() ?? 0) + 1));
      const existing = await tx.talentResumeTask.findFirst({ where: { ownerId: user.id, context, fingerprint,
        status: { in: ['processing', 'succeeded'] }, expiresAt: { gt: now } }, select: SELECT });
      if (existing) {
        await tx.talentResumeTask.updateMany({ where: { id: existing.id }, data: { selectedAt } });
        return { row: { ...existing, selectedAt }, created: false };
      }
      if (await tx.talentResumeTask.count({ where: { ownerId: user.id, status: 'processing' } })) {
        throw new ConflictException('已有简历正在解析，请先查看当前任务');
      }
      if (await tx.talentResumeTask.count({ where: { status: 'processing' } }) >= 2) {
        throw new HttpException('解析服务繁忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (await tx.talentResumeTask.count({ where: { expiresAt: { gt: now } } }) >= 20) {
        throw new HttpException('临时解析资料较多，请清除不再需要的任务后重试', HttpStatus.TOO_MANY_REQUESTS);
      }
      const since = new Date(now.getTime() - 60_000);
      if (await tx.talentResumeTask.count({ where: { ownerId: user.id, createdAt: { gte: since } } }) >= 3
        || await tx.talentResumeTask.count({ where: { createdAt: { gte: since } } }) >= 10) {
        throw new HttpException('简历解析请求过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
      }
      const id = randomUUID();
      const row = await tx.talentResumeTask.create({ data: {
        id, ownerId: user.id, context, fingerprint, status: 'processing', stage: 'recognizing',
        metadataEncrypted: this.encrypt(Buffer.from(JSON.stringify({ fileName: file!.originalname, mimeType: document.mimeType })), id, user.id, 'metadata'),
        fileEncrypted: this.encrypt(file!.buffer, id, user.id, 'file'), resultEncrypted: null, message: null,
        createdAt: now, selectedAt, deadlineAt: new Date(now.getTime() + RESUME_TASK_WAIT_MS), expiresAt: new Date(now.getTime() + RESUME_TASK_TTL_MS),
      }, select: SELECT });
      return { row, created: true };
    });
    if (outcome.created) void this.run(outcome.row, file!, user);
    return this.view(outcome.row);
  }

  async retry(id: string, user: AuthUser) {
    const row = await this.owned(id, user, true);
    if (row.status === 'processing' || row.status === 'succeeded') return this.view(row);
    const metadata = this.metadata(row), buffer = this.decrypt(row.fileEncrypted!, row, 'file');
    return this.admit({ buffer, size: buffer.length, originalname: metadata.fileName, mimetype: metadata.mimeType } as Express.Multer.File, row.context, user, id);
  }

  async file(id: string, user: AuthUser) {
    const row = await this.owned(id, user, true);
    return { buffer: this.decrypt(row.fileEncrypted!, row, 'file'), ...this.metadata(row) };
  }

  async clear(id: string, user: AuthUser) {
    this.authorize(user);
    const row = await this.owned(id, user);
    const cleared = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(126012, 19019)`;
      await assertRecruitmentEditor(tx, user);
      const current = await tx.talentResumeTask.findFirst({ where: { ownerId: user.id, context: row.context,
        expiresAt: { gt: new Date(Date.now()) } }, orderBy: [{ selectedAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      if (current?.id !== id) throw new ConflictException('解析任务已更新，请重新连接后再清除');
      const attempts = await tx.talentResumeTask.findMany({ where: { ownerId: user.id, context: row.context }, select: { id: true } });
      await tx.talentResumeTask.deleteMany({ where: { ownerId: user.id, context: row.context } });
      return attempts;
    });
    for (const attempt of cleared) this.active.get(attempt.id)?.controller.abort();
  }

  private async run(row: TaskRow, file: Express.Multer.File, user: AuthUser) {
    const controller = new AbortController();
    this.active.set(row.id, { controller, deadline: row.deadlineAt.getTime() });
    const timer = setTimeout(() => controller.abort(), Math.max(0, row.deadlineAt.getTime() - Date.now()));
    const where = () => ({ id: row.id, status: 'processing', deadlineAt: { gt: new Date(Date.now()) } });
    try {
      const result = await this.resumes.parse(file, user, { signal: controller.signal, onStage: async stage => {
        const changed = await this.db.talentResumeTask.updateMany({ where: where(), data: { stage } });
        if (!changed.count) { controller.abort(); throw new Error('Attempt ended'); }
      } });
      await this.db.talentResumeTask.updateMany({ where: where(), data: {
        status: 'succeeded', resultEncrypted: this.encrypt(Buffer.from(JSON.stringify(result)), row.id, row.ownerId, 'result'),
      } });
    } catch (error) {
      const timedOut = controller.signal.aborted || Date.now() >= row.deadlineAt.getTime()
        || (error instanceof HttpException && JSON.stringify(error.getResponse()).includes('超时'));
      const busy = error instanceof HttpException && error.getStatus() === 429;
      await this.db.talentResumeTask.updateMany({ where: { id: row.id, status: 'processing' }, data: {
        status: timedOut ? 'timed_out' : 'failed', message: timedOut ? TIMEOUT_MESSAGE
          : busy ? '解析服务繁忙，请稍后重试' : '解析失败，可重试或手工填写，文件已保留',
      } }).catch(() => undefined);
    } finally {
      clearTimeout(timer); this.active.delete(row.id);
      await this.expire().catch(() => undefined);
    }
  }

  @Cron('0 * * * * *')
  async cleanup() {
    await this.expire();
    await this.db.talentResumeTask.deleteMany({ where: { expiresAt: { lte: new Date(Date.now()) } } });
  }

  async onModuleDestroy() {
    const ids = [...this.active.keys()];
    for (const item of this.active.values()) item.controller.abort();
    if (ids.length) await this.db.talentResumeTask.updateMany({ where: { id: { in: ids }, status: 'processing' },
      data: { status: 'failed', message: '解析中断，可重试或手工填写' } }).catch(() => undefined);
  }
}
