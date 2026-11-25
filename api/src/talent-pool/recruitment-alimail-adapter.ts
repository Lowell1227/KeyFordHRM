import { createHash } from 'crypto';
import { Readable } from 'stream';
import { isEmail, isISO8601 } from 'class-validator';
import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, ImapFlowOptions, MailboxObject } from 'imapflow';
import { MailParser } from 'mailparser';
import type { Headers, StructuredHeader } from 'mailparser';
import type { RecruitmentMailboxPage, RecruitmentMailMessage } from './recruitment-mail-gateway';
import { RESUME_LIMITS } from './talent-resume-client';

export interface AlimailRecruitmentConfig {
  account: string;
  password: string;
  folder: string;
  authorizedFrom: string;
}

export type AlimailRecruitmentClient = Pick<ImapFlow, 'connect' | 'mailboxOpen' | 'fetch' | 'download' | 'close' | 'on'>;
export type AlimailRecruitmentClientFactory = (options: ImapFlowOptions) => AlimailRecruitmentClient;
type ErrorCode = 'invalid_config' | 'invalid_request' | 'invalid_cursor' | 'invalid_response' | 'connection_failed' | 'timeout';
export class AlimailRecruitmentError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`Recruitment mailbox: ${code}`);
    this.name = 'AlimailRecruitmentError';
  }
}

const MiB = 1024 * 1024;
const RAW_MESSAGE = 32 * MiB, RAW_PAGE = 40 * MiB, DECODED_PAGE = 30 * MiB;
const DEADLINE_MS = 90_000, UID_MAX = 0xffffffff;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
};
type MaterialIssue = NonNullable<RecruitmentMailMessage['materialIssue']>;
class UnusableMaterial extends Error {
  constructor(readonly issue: MaterialIssue) { super(issue); }
}
class PageFull extends Error {}
interface Cursor { version: 1; scope: string; validity: string; after: number }
interface Session {
  client: AlimailRecruitmentClient;
  check(): void;
  track<T extends Readable>(stream: T): T;
  untrack(stream: Readable): void;
}

function fail(code: ErrorCode): never { throw new AlimailRecruitmentError(code); }
function integer(value: unknown, max = UID_MAX): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function clean(value: string | undefined, max: number): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, max);
}

/** One fresh connection per operation; only the configured folder is ever examined. */
export class AlimailRecruitmentAdapter {
  private readonly config: AlimailRecruitmentConfig;
  private readonly scope: string;

  constructor(config: AlimailRecruitmentConfig, private readonly factory: AlimailRecruitmentClientFactory = options => new ImapFlow(options)) {
    if (!config || typeof config.account !== 'string' || config.account !== config.account.trim() ||
      config.account.length > 254 || !isEmail(config.account) || CONTROL.test(config.account) ||
      typeof config.password !== 'string' || !config.password || config.password.length > 512 || CONTROL.test(config.password) ||
      typeof config.folder !== 'string' || !config.folder.trim() || config.folder !== config.folder.trim() ||
      config.folder.length > 128 || CONTROL.test(config.folder) || /[\\/*%]/.test(config.folder) ||
      typeof config.authorizedFrom !== 'string' || !config.authorizedFrom.endsWith('Z') ||
      !isISO8601(config.authorizedFrom, { strict: true, strictSeparator: true }) || !Number.isFinite(Date.parse(config.authorizedFrom))) fail('invalid_config');
    this.config = Object.freeze({ ...config, authorizedFrom: new Date(config.authorizedFrom).toISOString() });
    this.scope = createHash('sha256').update(JSON.stringify([
      this.config.account, this.config.folder, this.config.authorizedFrom,
    ])).digest('hex');
  }

  status(): { configured: boolean } { return { configured: true }; }

  async probe(): Promise<{ readOnly: true; messages: number }> {
    return this.withMailbox(async (_session, mailbox) => ({ readOnly: true, messages: mailbox.exists }));
  }

  async readPage(input: { cursor?: string; limit: number }): Promise<RecruitmentMailboxPage> {
    if (!input || !integer(input.limit, 20) || input.limit < 1) fail('invalid_request');
    const previous = input.cursor === undefined ? undefined : this.decodeCursor(input.cursor);
    return this.withMailbox(async (session, mailbox) => {
      const validity = mailbox.uidValidity.toString();
      const highwater = mailbox.uidNext - 1;
      if (previous && (previous.validity !== validity || previous.after > highwater)) fail('invalid_cursor');
      let after = previous?.after ?? 0;
      const end = Math.min(after + 100, highwater);
      const rows: Array<FetchMessageObject & { internalDate: Date }> = [];
      const seen = new Set<number>();
      if (after < end) {
        // Finish the metadata iterator before issuing another IMAP command (ImapFlow forbids nesting).
        for await (const row of session.client.fetch(`${after + 1}:${end}`, { uid: true, internalDate: true, size: true }, { uid: true })) {
          session.check();
          if (!integer(row.uid) || row.uid <= after || row.uid > end || seen.has(row.uid) || rows.length >= 100 ||
            !(row.internalDate instanceof Date) || !Number.isFinite(row.internalDate.getTime())) fail('invalid_response');
          seen.add(row.uid);
          rows.push({ ...row, internalDate: row.internalDate });
        }
      }
      session.check();
      rows.sort((a, b) => a.uid - b.uid);
      const messages: RecruitmentMailMessage[] = [];
      const budget = { raw: 0, decoded: 0 };
      let stopped = false;
      for (const row of rows) {
        session.check();
        if (row.internalDate.toISOString() < this.config.authorizedFrom) { after = row.uid; continue; }
        if (messages.length === input.limit) { stopped = true; break; }
        const message: RecruitmentMailMessage = {
          id: `alimail:${this.scope}:${validity}:${row.uid}`, receivedAt: row.internalDate.toISOString(),
          subject: '', bodyText: '', sourceChannel: null, attachments: [],
        };
        if (!integer(row.size, Number.MAX_SAFE_INTEGER) || row.size === 0) message.materialIssue = 'missing_material';
        else if (row.size >= RAW_MESSAGE) message.materialIssue = 'file_too_large';
        else {
          // Reserve the extra truncation-detection byte too; never discard a message just because this page is full.
          const maxBytes = Math.min(row.size + 1, RAW_MESSAGE);
          if (budget.raw + maxBytes > RAW_PAGE) { stopped = true; break; }
          try {
            const raw = await this.readRaw(session, row.uid, row.size, maxBytes, budget);
            Object.assign(message, await this.parseMime(session, raw, budget));
          } catch (error) {
            if (error instanceof PageFull) { stopped = true; break; }
            if (!(error instanceof UnusableMaterial)) throw error;
            message.materialIssue = error.issue;
          }
        }
        messages.push(message);
        after = row.uid;
      }
      if (!stopped) after = end; // Empty UID holes are consumed, including an empty terminal page.
      session.check();
      const cursor = Buffer.from(JSON.stringify({ version: 1, scope: this.scope, validity, after } satisfies Cursor)).toString('base64url');
      return {
        mailboxKey: `alimail:${this.scope}`, authorizedFrom: this.config.authorizedFrom, messages,
        nextCursor: after < highwater ? cursor : null,
        ...(after === highwater ? { checkpointCursor: cursor } : {}),
      };
    });
  }

  private decodeCursor(value: string): Cursor {
    if (typeof value !== 'string' || !value || value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) fail('invalid_cursor');
    try {
      const bytes = Buffer.from(value, 'base64url');
      if (bytes.toString('base64url') !== value) fail('invalid_cursor');
      const cursor = JSON.parse(bytes.toString('utf8')) as Cursor;
      if (!cursor || Object.keys(cursor).sort().join(',') !== 'after,scope,validity,version' ||
        cursor.version !== 1 || cursor.scope !== this.scope || !integer(cursor.after) ||
        typeof cursor.validity !== 'string' || !/^[1-9]\d{0,9}$/.test(cursor.validity) || Number(cursor.validity) > UID_MAX) fail('invalid_cursor');
      return cursor;
    } catch { return fail('invalid_cursor'); }
  }

  private async withMailbox<T>(operation: (session: Session, mailbox: MailboxObject) => Promise<T>): Promise<T> {
    let client: AlimailRecruitmentClient | undefined;
    let closed = false;
    let aborted: AlimailRecruitmentError | undefined;
    const streams = new Set<Readable>();
    const disconnect = () => {
      for (const stream of streams) stream.destroy();
      streams.clear();
      if (!closed && client) { closed = true; try { client.close(); } catch { /* Already disconnected. */ } }
    };
    let rejectFailure!: (error: AlimailRecruitmentError) => void;
    const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
    const abort = (code: 'timeout' | 'connection_failed') => {
      if (aborted || closed) return;
      aborted = new AlimailRecruitmentError(code);
      rejectFailure(aborted);
      disconnect();
    };
    const deadline = Date.now() + DEADLINE_MS;
    const timer = setTimeout(() => abort('timeout'), DEADLINE_MS);
    const check = () => {
      if (aborted) throw aborted;
      if (closed || Date.now() >= deadline) fail('timeout');
    };
    try {
      client = this.factory({
        host: 'imap.qiye.aliyun.com', port: 993, secure: true, tls: { rejectUnauthorized: true },
        auth: { user: this.config.account, pass: this.config.password },
        logger: false, logRaw: false, emitLogs: false, disableAutoIdle: true,
        disableCompression: true, disableBinary: true, disableAutoEnable: true,
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
        maxLineLength: 128 * 1024, maxLiteralSize: 128 * 1024, maxResponseSize: 2 * MiB,
      });
      client.on('error', () => abort('connection_failed'));
      const session: Session = {
        client, check,
        track: stream => {
          if (closed || aborted) { stream.destroy(); check(); }
          streams.add(stream);
          return stream;
        },
        untrack: stream => { streams.delete(stream); stream.destroy(); },
      };
      const work = (async () => {
        await client!.connect();
        check();
        const mailbox = await client!.mailboxOpen(this.config.folder, { readOnly: true });
        check();
        if (!mailbox || mailbox.path !== this.config.folder || mailbox.readOnly !== true ||
          !integer(mailbox.exists, Number.MAX_SAFE_INTEGER) || !integer(mailbox.uidNext) || mailbox.uidNext < 1 ||
          typeof mailbox.uidValidity !== 'bigint' || mailbox.uidValidity < 1n || mailbox.uidValidity > BigInt(UID_MAX)) fail('invalid_response');
        return operation(session, mailbox);
      })();
      return await Promise.race([work, failure]);
    } catch (error) {
      if (error instanceof AlimailRecruitmentError) throw error;
      throw new AlimailRecruitmentError('connection_failed');
    } finally {
      clearTimeout(timer);
      disconnect();
    }
  }

  private async readRaw(session: Session, uid: number, expected: number, maxBytes: number, budget: { raw: number }): Promise<Buffer> {
    session.check();
    // download() requests partial BODY.PEEK[]; never use a body fetch that sets \Seen.
    const result = await session.client.download(String(uid), undefined, { uid: true, maxBytes, chunkSize: 64 * 1024, binary: false });
    if (!result.content) { session.check(); throw new UnusableMaterial('missing_material'); }
    const stream = session.track(result.content);
    let length = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of stream) {
        session.check();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        budget.raw += bytes.length;
        if (length > maxBytes || budget.raw > RAW_PAGE) throw new UnusableMaterial('file_too_large');
        chunks.push(bytes);
      }
      session.check();
      if (length > expected || length >= RAW_MESSAGE) throw new UnusableMaterial('file_too_large');
      if (length !== expected) throw new UnusableMaterial('missing_material');
      return Buffer.concat(chunks, length);
    } finally { session.untrack(stream); }
  }

  private async parseMime(session: Session, raw: Buffer, budget: { decoded: number }): Promise<Pick<RecruitmentMailMessage, 'subject' | 'bodyText' | 'attachments'>> {
    const separator = raw.indexOf('\r\n\r\n') < 0 ? raw.indexOf('\n\n') : raw.indexOf('\r\n\r\n');
    if (separator < 0) throw new UnusableMaterial('missing_material');
    if (separator > 128 * 1024) throw new UnusableMaterial('file_too_large');
    const parser = session.track(new MailParser({
      skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true,
      maxHtmlLengthToParse: RESUME_LIMITS.textChars, checksumAlgo: 'sha256',
    }));
    let headers: Headers = new Map();
    parser.on('headers', value => { headers = value; });
    let bodyText = '';
    const attachments: RecruitmentMailMessage['attachments'] = [];
    let attachmentStream: Readable | undefined;
    const before = budget.decoded;
    const consume = (bytes: number) => {
      budget.decoded += bytes;
      if (budget.decoded > DECODED_PAGE) {
        if (before > 0) throw new PageFull();
        throw new UnusableMaterial('file_too_large');
      }
    };
    parser.end(raw);
    try {
      for await (const part of parser) {
        session.check();
        if (part.type === 'text') {
          bodyText = typeof part.text === 'string' ? part.text : '';
          if (bodyText.length > RESUME_LIMITS.textChars) throw new UnusableMaterial('file_too_large');
          if (bodyText.includes('\0')) throw new UnusableMaterial('missing_material');
          consume(Buffer.byteLength(bodyText));
        } else if (part.type === 'attachment') {
          attachmentStream = session.track(part.content as Readable);
          if (attachments.length >= 10) throw new UnusableMaterial('file_too_large');
          const fileName = clean(part.filename?.split(/[\\/]/).pop(), 255);
          const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
          const mimeType = MIME_TYPES[extension];
          if (!mimeType || ![mimeType, 'application/octet-stream'].includes(part.contentType)) throw new UnusableMaterial('unsupported_attachment');
          const chunks: Buffer[] = [];
          let length = 0;
          try {
            for await (const chunk of attachmentStream) {
              session.check();
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              length += bytes.length;
              consume(bytes.length);
              if (length > RESUME_LIMITS.fileBytes) throw new UnusableMaterial('file_too_large');
              chunks.push(bytes);
            }
            if (!length) throw new UnusableMaterial('missing_material');
            attachments.push({ id: String(attachments.length + 1), fileName, mimeType, bytes: Buffer.concat(chunks, length) });
          } finally { session.untrack(attachmentStream); attachmentStream = undefined; part.release(); }
        }
      }
      session.check();
      const type = headers.get('content-type') as StructuredHeader | undefined;
      if (type?.value?.startsWith('multipart/')) {
        const boundary = type.params?.boundary;
        // MailParser tolerates truncated multipart sources; do not accept their partial attachments as complete.
        if (!boundary || boundary.length > 200 || raw.indexOf(Buffer.from(`\n--${boundary}--`)) < 0) throw new UnusableMaterial('missing_material');
      }
      if (!headers.size || (!bodyText.trim() && !attachments.length)) throw new UnusableMaterial('missing_material');
      return { subject: clean(typeof headers.get('subject') === 'string' ? headers.get('subject') as string : '', 500), bodyText, attachments };
    } catch (error) {
      session.check();
      if (error instanceof UnusableMaterial || error instanceof PageFull || error instanceof AlimailRecruitmentError) throw error;
      throw new UnusableMaterial('missing_material');
    } finally {
      if (attachmentStream) session.untrack(attachmentStream);
      session.untrack(parser);
    }
  }
}
