import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isISO8601 } from 'class-validator';
import { AlimailRecruitmentAdapter } from './recruitment-alimail-adapter';
import { readRecruitmentMailSettings } from './recruitment-mail-settings';
import { TALENT_SOURCE_CHANNELS } from './talent.constants';
import { RESUME_LIMITS } from './talent-resume-client';

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
  private readonly adapter?: AlimailRecruitmentAdapter;
  private readonly invalidConfiguration: boolean = false;

  constructor(@Optional() config?: ConfigService) {
    try {
      const settings = readRecruitmentMailSettings(config);
      if (settings) this.adapter = new AlimailRecruitmentAdapter(settings);
    } catch {
      this.invalidConfiguration = true;
    }
  }

  status(): { configured: boolean } { return { configured: !!this.adapter }; }

  async readPage(input: { cursor?: string; limit: number }): Promise<RecruitmentMailboxPage> {
    if (this.invalidConfiguration) {
      throw new ServiceUnavailableException('招聘邮箱安全配置未就绪，请管理员检查私有配置');
    }
    if (!this.adapter) {
      throw new ServiceUnavailableException('招聘邮箱未配置，请先手工上传；专用邮箱授权后再开启读取');
    }
    try {
      return await this.adapter.readPage(input);
    } catch {
      throw new ServiceUnavailableException('招聘邮箱读取未完成，本页未完成；请核对授权和指定文件夹后重试');
    }
  }
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
