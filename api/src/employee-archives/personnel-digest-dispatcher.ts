import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { PrismaService } from '@/prisma/prisma.service';
import { digestBody, digestDay } from './personnel-digest';
import { PersonnelDigestService } from './personnel-digest.service';

@Injectable()
export class PersonnelDigestDispatcher {
  private readonly logger = new Logger(PersonnelDigestDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly digest: PersonnelDigestService,
  ) {}

  @Cron('* * * * *', { timeZone: 'Asia/Shanghai' })
  async sendDaily(at = new Date()) {
    if (this.config.get('PERSONNEL_DIGEST_ENABLED') !== 'true') return;
    const { day, time } = digestDay(at);
    const sendTime = this.config.get<string>('PERSONNEL_DIGEST_SEND_TIME') || '09:00';
    // Limit catch-up to the configured hour so a late deployment cannot push an unexpected afternoon summary.
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime) || time < sendTime || time.slice(0, 2) !== sendTime.slice(0, 2)) return;
    const hash = createHash('sha256').update('keyford:personnel-digest:' + day).digest('hex');
    const id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
    try {
      if (await this.prisma.auditLog.findUnique({ where: { id }, select: { id: true } })) return;
      const actorId = this.config.get<string>('PERSONNEL_DIGEST_HR_USER_ID');
      const credentialFile = this.config.get<string>('PERSONNEL_DIGEST_CREDENTIALS_FILE');
      const origin = this.config.get<string>('PERSONNEL_DIGEST_HRM_ORIGIN');
      if (!actorId || !credentialFile || !origin || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin)) {
        this.logger.warn('人事待办推送配置缺失');
        return;
      }
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId, deletedAt: null, archivedAt: null, status: 'active' },
        select: { id: true, sysRole: true, hrCapabilities: true },
      });
      if (!actor || !hasHrCapability(actor, 'employee_archive_edit')) {
        this.logger.warn('人事待办推送负责账号不可用');
        return;
      }

      const { accessToken, signingSecret } = JSON.parse((await readFile(credentialFile, 'utf8')).replace(/^\uFEFF/, ''));
      if (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(accessToken)
          || typeof signingSecret !== 'string' || !/^SEC[A-Za-z0-9_-]{16,}$/.test(signingSecret)) {
        this.logger.warn('人事待办推送凭据格式无效');
        return;
      }
      const { items } = await this.digest.list(actor, day);
      const fetchedAt = digestDay(new Date());
      if (fetchedAt.day !== day || fetchedAt.time.slice(0, 2) !== sendTime.slice(0, 2)) return;
      const claim = await this.prisma.auditLog.createMany({
        data: [{ id, userId: actor.id, action: 'personnel_digest_delivery', entityType: 'personnel_digest',
          newValue: { state: 'attempting', day, total: items.length } }],
        skipDuplicates: true,
      });
      if (claim.count !== 1) return;

      let state: 'accepted' | 'rejected' | 'unknown' = 'unknown';
      try {
        const timestamp = Date.now().toString();
        const sign = createHmac('sha256', signingSecret).update(timestamp + '\n' + signingSecret).digest('base64');
        const url = new URL('https://oapi.dingtalk.com/robot/send');
        url.search = new URLSearchParams({ access_token: accessToken, timestamp, sign }).toString();
        const response = await fetch(url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(digestBody(day, items, origin + '/personnel-digest')),
        });
        if (response.ok) {
          const receipt: { errcode?: unknown } = await response.json();
          if (typeof receipt.errcode === 'number') state = receipt.errcode === 0 ? 'accepted' : 'rejected';
        }
      } catch {
        // A network error can mean delivery with a lost response. Keep the claim and never repost automatically.
      }
      await this.prisma.auditLog.update({ where: { id }, data: { newValue: { state, day, total: items.length } } });
      if (state !== 'accepted') this.logger.warn('人事待办推送结果：' + state);
    } catch {
      this.logger.error('人事待办推送未能完成，请检查配置和审计记录');
    }
  }
}
