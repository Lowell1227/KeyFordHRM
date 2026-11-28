import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RuntimeSettingsService } from '@/system-configuration/runtime-settings.service';
import { isISO8601 } from 'class-validator';
import { AlimailRecruitmentAdapter } from './recruitment-alimail-adapter';
import { readRecruitmentMailSettings } from './recruitment-mail-settings';
import { TALENT_SOURCE_CHANNELS } from './talent.constants';
import { RESUME_LIMITS } from './talent-resume-client';
import { RecruitmentMailProvider } from './recruitment-mail-providers';

export interface RecruitmentMailAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface RecruitmentMailMessage {
  id: string;
  receivedAt: string;
  subject: string;
  bodyText: string;
  sourceChannel?: string | null;
  postingChannel?: string;
  externalPostingId?: string;
  externalPostingUrl?: string;
  attachments: RecruitmentMailAttachment[];
  materialIssue?: 'file_too_large' | 'unsupported_attachment' | 'missing_material';
}

export interface RecruitmentMailboxPage {
  mailboxKey: string;
  authorizedFrom: string;
  messages: RecruitmentMailMessage[];
  nextCursor: string | null;
  checkpointCursor?: string;
}

export interface NormalizedRecruitmentMail extends RecruitmentMailMessage {
  sourceChannel: string | null;
  attachments: Array<RecruitmentMailAttachment & { issue?: 'file_too_large' }>;
  issues: string[];
}

export interface RecruitmentMailUnit {
  sourcePartId: string;
  bodyText: string;
  attachment?: RecruitmentMailAttachment;
  state: 'pending_review' | 'needs_material';
  issue: string | null;
}

@Injectable()
export class RecruitmentMailboxGateway {
  private readonly cache = new Map<string, { fingerprint: string; adapter: AlimailRecruitmentAdapter }>();
  constructor(@Optional() @Inject(RuntimeSettingsService) private readonly config?: ConfigService) { this.entries(); }

  private entries() {
    const runtime = this.config as unknown as RuntimeSettingsService | undefined;
    const saved = typeof runtime?.mailboxConfigurations === 'function' ? runtime.mailboxConfigurations() : [];
    const entries: Array<{ id: string; name: string; enabled: boolean; configured: boolean; stateId: string; adapter?: AlimailRecruitmentAdapter; invalid?: boolean }> = [];
    for (const row of saved) {
      const value = row.values, enabled = value?.RECRUITMENT_MAIL_ENABLED === true;
      const item = { id: row.id, name: String(value?.RECRUITMENT_MAIL_NAME || '招聘邮箱'), enabled, configured: false, stateId: '', invalid: value === null };
      try {
        if (value && value.RECRUITMENT_MAIL_ACCOUNT && value.RECRUITMENT_MAIL_PASSWORD && value.RECRUITMENT_MAIL_FOLDER && value.RECRUITMENT_MAIL_AUTHORIZED_FROM) {
          const settings = { provider: (value.RECRUITMENT_MAIL_PROVIDER || 'alimail') as RecruitmentMailProvider, account: value.RECRUITMENT_MAIL_ACCOUNT as string, password: value.RECRUITMENT_MAIL_PASSWORD as string, folder: value.RECRUITMENT_MAIL_FOLDER as string, authorizedFrom: new Date(value.RECRUITMENT_MAIL_AUTHORIZED_FROM as string).toISOString() };
          const adapter = this.adapter(row.id, settings);
          const scope = createHash('sha256').update(JSON.stringify([...(settings.provider === 'alimail' ? [] : [settings.provider]), settings.account, settings.folder, settings.authorizedFrom])).digest('hex');
          let legacy = row.id === 'recruitment-mail' && settings.provider === 'alimail' && value.__legacyMailboxScope === scope;
          if (row.id === 'recruitment-mail' && settings.provider === 'alimail' && !value.__legacyMailboxScope) {
            try {
              const old = readRecruitmentMailSettings({ get: ((key: string) => key === 'RECRUITMENT_MAIL_ENABLED' ? 'true' : this.config?.get(key)) as ConfigService['get'] });
              legacy ||= !!old && old.account === settings.account && old.folder === settings.folder && new Date(old.authorizedFrom).toISOString() === settings.authorizedFrom;
            } catch { /* An unavailable old file cannot override a valid saved account. */ }
          }
          entries.push({ ...item, configured: true, stateId: legacy ? 'primary' : 'm' + createHash('sha256').update(row.id + ':' + scope).digest('hex').slice(0, 19), adapter });
          continue;
        }
      } catch { item.invalid = true; }
      entries.push(item);
    }
    if (!saved.some(row => row.id === 'recruitment-mail')) {
      try {
        const settings = readRecruitmentMailSettings(this.config);
        if (settings) entries.unshift({ id: 'recruitment-mail', name: '招聘邮箱', enabled: true, configured: true, stateId: 'primary', adapter: this.adapter('recruitment-mail', settings) });
      } catch { entries.unshift({ id: 'recruitment-mail', name: '招聘邮箱', enabled: true, configured: false, stateId: 'primary', invalid: true }); }
    }
    if (this.config?.get('HRM_PREVIEW') === 'true') return entries.map(item => ({ ...item, enabled: false, configured: false, adapter: undefined }));
    return entries;
  }
  private adapter(id: string, settings: { provider?: RecruitmentMailProvider; account: string; password: string; folder: string; authorizedFrom: string }) {
    const fingerprint = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const old = this.cache.get(id);
    if (old?.fingerprint === fingerprint) return old.adapter;
    const adapter = new AlimailRecruitmentAdapter(settings);
    this.cache.set(id, { fingerprint, adapter });
    return adapter;
  }
  choices() { return this.entries().map(({ id, name, enabled, configured }) => ({ id, name, enabled, configured })); }
  stateId(mailboxId: string) { return this.entries().find(item => item.id === mailboxId)?.stateId ?? null; }
  sourceForKey(key: string | null) {
    const id = key?.match(/^(recruitment-mail(?::[0-9a-f-]{36})?)\|(?:alimail|qq|netease163|netease126):[a-f0-9]{64}$/i)?.[1];
    if (!id) return { mailboxId: null, mailboxName: null };
    const entry = this.entries().find(item => item.id === id);
    return { mailboxId: id, mailboxName: entry?.name ?? null };
  }
  status(): { configured: boolean } { return { configured: this.entries().some(item => item.enabled && item.configured) }; }
  select(mailboxId?: string) {
    const entries = this.entries();
    const enabled = entries.filter(item => item.enabled);
    if (!mailboxId && enabled.length > 1) throw new BadRequestException('已启用多个招聘邮箱，请先选择本次读取的邮箱');
    const item = mailboxId ? entries.find(row => row.id === mailboxId) : enabled[0];
    if (item?.invalid) throw new ServiceUnavailableException('招聘邮箱安全配置未就绪，请管理员检查已保存配置');
    if (!item?.enabled || !item.adapter) throw new ServiceUnavailableException('招聘邮箱未配置，请先手工上传；专用邮箱授权后再开启读取');
    const adapter = item.adapter;
    return { id: item.id, name: item.name, stateId: item.stateId, readPage: async (input: { cursor?: string; limit: number }) => {
      try { const page = await adapter.readPage(input); return item.stateId === 'primary' ? page : { ...page, mailboxKey: `${item.id}|${page.mailboxKey}` }; }
      catch { throw new ServiceUnavailableException('招聘邮箱读取未完成，本页未完成；请核对授权和指定文件夹后重试'); }
    } };
  }
  async readPage(input: { cursor?: string; limit: number }): Promise<RecruitmentMailboxPage> { return this.select().readPage(input); }
}

function invalidPage(): never {
  throw new ServiceUnavailableException('邮箱返回资料或读取范围无效，本页未完成，请核对邮箱接入配置后重试');
}

function metadata(value: unknown, max: number, optional = false): string {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalidPage();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !isISO8601(value, { strict: true, strictSeparator: true }) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalidPage();
  return new Date(value).toISOString();
}

/** Adapter output is still untrusted; validate the whole page before persisting its cursor. */
export function normalizeRecruitmentMailboxPage(input: RecruitmentMailboxPage): Omit<RecruitmentMailboxPage, 'messages'> & { messages: NormalizedRecruitmentMail[] } {
  if (!input || !Array.isArray(input.messages) || input.messages.length > 20) invalidPage();
  const mailboxKey = metadata(input.mailboxKey, 200);
  const authorizedFrom = timestamp(input.authorizedFrom);
  const nextCursor = input.nextCursor === null ? null : metadata(input.nextCursor, 1000);
  const checkpointCursor = input.checkpointCursor === undefined ? undefined : metadata(input.checkpointCursor, 1000);
  if (checkpointCursor !== undefined && nextCursor !== null) invalidPage();
  const seen = new Set<string>();
  let totalBytes = 0;
  const messages = input.messages.map(message => {
    if (!message || !Array.isArray(message.attachments) || message.attachments.length > 10) invalidPage();
    const id = metadata(message.id, 500);
    if (seen.has(id)) invalidPage();
    seen.add(id);
    const receivedAt = timestamp(message.receivedAt);
    if (receivedAt < authorizedFrom) invalidPage();
    const issues: string[] = [];
    if (message.materialIssue !== undefined) {
      if (!['file_too_large', 'unsupported_attachment', 'missing_material'].includes(message.materialIssue)) invalidPage();
      issues.push(message.materialIssue);
    }
    if (typeof message.bodyText !== 'string' || message.bodyText.includes('\0')) invalidPage();
    const bodyText = message.bodyText.length > RESUME_LIMITS.textChars ? '' : message.bodyText;
    if (message.bodyText.length > RESUME_LIMITS.textChars) issues.push('body_too_large');
    const sourceChannel = typeof message.sourceChannel === 'string' &&
      (TALENT_SOURCE_CHANNELS as readonly string[]).includes(message.sourceChannel) ? message.sourceChannel : null;
    if (message.sourceChannel && !sourceChannel) issues.push('source_unverified');
    const parts = new Set<string>();
    const attachments = message.attachments.map(part => {
      if (!part) invalidPage();
      const partId = metadata(part.id, 200);
      if (parts.has(partId) || !Buffer.isBuffer(part.bytes)) invalidPage();
      parts.add(partId);
      totalBytes += part.bytes.length;
      if (totalBytes > 30 * 1024 * 1024) invalidPage();
      const oversized = part.bytes.length > RESUME_LIMITS.fileBytes;
      return { id: partId, fileName: metadata(part.fileName, 255), mimeType: metadata(part.mimeType, 100),
        bytes: oversized ? Buffer.alloc(0) : part.bytes, ...(oversized ? { issue: 'file_too_large' as const } : {}) };
    });
    return {
      id, receivedAt, subject: metadata(message.subject, 500, true), bodyText, sourceChannel, attachments, issues,
      postingChannel: metadata(message.postingChannel, 80, true) || undefined,
      externalPostingId: metadata(message.externalPostingId, 200, true) || undefined,
      externalPostingUrl: metadata(message.externalPostingUrl, 2000, true) || undefined,
      ...(message.materialIssue ? { materialIssue: message.materialIssue } : {}),
    };
  });
  return { mailboxKey, authorizedFrom, messages, nextCursor, ...(checkpointCursor === undefined ? {} : { checkpointCursor }) };
}

export function recruitmentMailUnits(message: NormalizedRecruitmentMail): RecruitmentMailUnit[] {
  if (message.attachments.length) return message.attachments.map(attachment => ({
    sourcePartId: `attachment:${attachment.id}`, attachment,
    bodyText: message.bodyText, state: attachment.issue || message.materialIssue ? 'needs_material' : 'pending_review', issue: attachment.issue ?? message.materialIssue ?? null,
  }));
  const text = message.bodyText.trim();
  const withoutLinks = text.replace(/https?:\/\/[^\s<>]+/gi, '').trim();
  // Conservative routing only; actual resume facts still require the existing evidence-checked parser and human review.
  const hasResumeFacts = /(?:姓名|性别|出生(?:年月|日期)?|电话|手机|邮箱|学历|教育经历|工作经历|项目经历|\b(?:name|gender|phone|email|education|experience)\b)\s*[:：]/i.test(withoutLinks);
  const notificationOnly = !hasResumeFacts && /(?:通知|提醒|点击|查看|链接|投递成功|\b(?:notification|received|click|view|link)\b)/i.test(withoutLinks);
  const issue = message.materialIssue ?? (message.issues.includes('body_too_large') ? 'body_too_large' : !text ? 'missing_material'
    : !withoutLinks ? 'link_only' : notificationOnly ? 'notification_only' : null);
  return [{ sourcePartId: 'body', bodyText: message.bodyText, state: issue ? 'needs_material' : 'pending_review', issue }];
}
