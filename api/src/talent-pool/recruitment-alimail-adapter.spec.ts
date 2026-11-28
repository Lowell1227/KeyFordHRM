import { EventEmitter } from 'events';
import { Duplex, Readable } from 'stream';
import { ImapFlow } from 'imapflow';
import { AlimailRecruitmentAdapter } from './recruitment-alimail-adapter';
import type { AlimailRecruitmentClientFactory } from './recruitment-alimail-adapter';

const MiB = 1024 * 1024;
const config = {
  account: 'recruitment@example.invalid', password: 'fictional-client-password',
  folder: 'Recruitment', authorizedFrom: '2026-11-25T00:00:00.000Z',
};
const received = new Date('2026-11-25T01:00:00Z');
const plain = (body = 'Name: Fictional Applicant') => Buffer.from([
  'From: BOSS <unverified@example.invalid>', 'Subject: Resume',
  'Date: Tue, 01 Jan 2000 00:00:00 +0000', 'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8', '', body,
].join('\r\n'));
function multipart(parts: Array<{ name: string; type: string; bytes: Buffer }>, body = 'Name: Fictional Applicant') {
  return Buffer.from([
    'Subject: Documents', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="test-boundary"', '',
    '--test-boundary', 'Content-Type: text/plain; charset=utf-8', '', body,
    ...parts.flatMap(part => [
      '--test-boundary', `Content-Type: ${part.type}`, `Content-Disposition: attachment; filename="${part.name}"`,
      'Content-Transfer-Encoding: base64', '', part.bytes.toString('base64'),
    ]), '--test-boundary--', '',
  ].join('\r\n'));
}

class FakeClient extends EventEmitter {
  mailbox = { path: config.folder, readOnly: true, exists: 1, uidNext: 2, uidValidity: 9n };
  rows: Array<{ uid: number; internalDate?: Date; size?: number }> = [];
  sources = new Map<number, Buffer>();
  activeFetch = false;
  streams: Readable[] = [];
  connect = jest.fn(async () => undefined);
  close = jest.fn(() => { for (const stream of this.streams) stream.destroy(); });
  mailboxOpen = jest.fn(async (_path: string, _options: unknown) => ({ ...this.mailbox }));
  fetch = jest.fn((range: string, _query: unknown, _options: unknown) => {
    const [start, end] = range.split(':').map(Number);
    const self = this;
    return (async function* () {
      self.activeFetch = true;
      try {
        for (const row of self.rows) if (row.uid >= start && row.uid <= end) yield row;
      } finally { self.activeFetch = false; }
    })();
  });
  download = jest.fn(async (uid: string, _part: unknown, options: { maxBytes: number }) => {
    if (this.activeFetch) throw new Error('IMAP command issued inside metadata iterator');
    const source = this.sources.get(Number(uid));
    if (!source) return {};
    const content = Readable.from([source.subarray(0, options.maxBytes)]);
    this.streams.push(content);
    return { meta: { expectedSize: source.length }, content };
  });
  add(uid: number, source: Buffer = plain(), internalDate = received, size = source.length) {
    this.rows.push({ uid, internalDate, size });
    this.sources.set(uid, source);
    this.mailbox.exists = this.rows.length;
    this.mailbox.uidNext = Math.max(this.mailbox.uidNext, uid + 1);
    return this;
  }
}

function setup(client = new FakeClient(), override: Record<string, unknown> = {}) {
  const factory = jest.fn((_options: unknown) => client);
  return { client, factory, adapter: new AlimailRecruitmentAdapter({ ...config, ...override }, factory as unknown as AlimailRecruitmentClientFactory) };
}
const cursorData = (value: string | undefined | null) => JSON.parse(Buffer.from(value!, 'base64url').toString());

describe('AlimailRecruitmentAdapter (no real network)', () => {
  it.each([['qq', 'imap.qq.com'], ['netease163', 'imap.163.com'], ['netease126', 'imap.126.com']])('uses the fixed %s TLS endpoint and a provider-specific read scope', async (provider, host) => {
    const { adapter, factory } = setup(undefined, { provider });
    await adapter.probe();
    expect(factory.mock.calls[0][0]).toMatchObject({ host, port: 993, secure: true, tls: { rejectUnauthorized: true } });
    if (provider.startsWith('netease')) expect(factory.mock.calls[0][0]).toHaveProperty('clientInfo.name', 'HRM');
    const page = await adapter.readPage({ limit: 1 });
    expect(page.mailboxKey).toMatch(new RegExp('^' + provider + ':'));
    expect(() => setup(undefined, { provider: 'arbitrary-host' })).toThrow('invalid_config');
  });
  it('validates without constructing a client and exposes no private configuration', () => {
    const { adapter, factory } = setup();
    expect(adapter.status()).toEqual({ configured: true });
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(adapter.status())).not.toContain(config.account);
  });

  it.each([
    { account: '' }, { account: 'not-an-email' }, { account: 'a@example.invalid\r\nINBOX' },
    { password: '' }, { folder: '' }, { folder: 'Recruitment\nINBOX' },
    { folder: '*' }, { folder: 'Recruitment/%' },
    { password: 'x'.repeat(513) }, { folder: 'x'.repeat(129) },
    { folder: 'Recruitment/Resumes' }, { folder: 'Recruitment\\Resumes' },
    { authorizedFrom: '2026-11-25' }, { authorizedFrom: '2026-02-30T00:00:00Z' },
    { authorizedFrom: '2026-11-25T00:00:00+08:00' },
  ])('rejects invalid configuration before any connection: %j', override => {
    expect(() => setup(undefined, override)).toThrow(/invalid_config/);
  });

  it('probes only authentication and the exact read-only folder, returning counts only', async () => {
    const { adapter, client, factory } = setup();
    expect(await adapter.probe()).toEqual({ readOnly: true, messages: 1 });
    expect(factory.mock.calls[0][0]).toMatchObject({
      host: 'imap.qiye.aliyun.com', port: 993, secure: true, tls: { rejectUnauthorized: true },
      logger: false, logRaw: false, emitLogs: false, disableAutoIdle: true,
      disableCompression: true, disableBinary: true,
    });
    expect(client.mailboxOpen).toHaveBeenCalledWith('Recruitment', { readOnly: true });
    expect(client.fetch).not.toHaveBeenCalled();
    expect(client.download).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it.each([{ path: 'INBOX' }, { readOnly: false }])('rejects a different or writable opened folder without fallback', async override => {
    const { adapter, client } = setup();
    Object.assign(client.mailbox, override);
    await expect(adapter.readPage({ limit: 20 })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(client.mailboxOpen).toHaveBeenCalledTimes(1);
    expect(client.download).not.toHaveBeenCalled();
  });

  it('fetches metadata first, filters by INTERNALDATE, and uses bounded UID raw downloads', async () => {
    const client = new FakeClient().add(1, plain('Historical'), new Date('2026-11-24T23:59:59Z'))
      .add(2).add(4, plain('Name: Another Fictional Applicant'));
    const { adapter } = setup(client);
    const page = await adapter.readPage({ limit: 20 });
    expect(client.fetch).toHaveBeenCalledWith('1:4', { uid: true, internalDate: true, size: true }, { uid: true });
    expect(client.download.mock.calls.map(call => call[0])).toEqual(['2', '4']);
    expect(client.download.mock.calls[0]).toEqual(['2', undefined, {
      uid: true, maxBytes: plain().length + 1, chunkSize: 64 * 1024, binary: false,
    }]);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]).toMatchObject({ receivedAt: received.toISOString(), bodyText: 'Name: Fictional Applicant', sourceChannel: null });
    expect(page.messages[0]).not.toHaveProperty('externalPostingId');
    expect(page.messages[0]).not.toHaveProperty('externalPostingUrl');
    expect(page.nextCursor).toBeNull();
    expect(cursorData(page.checkpointCursor)).toMatchObject({ after: 4, validity: '9' });
    expect(page.mailboxKey).not.toContain(config.account);
  });

  it('pages through UID holes with a 100-UID metadata window and replays deterministically', async () => {
    const client = new FakeClient().add(99).add(103);
    const { adapter } = setup(client);
    const first = await adapter.readPage({ limit: 20 });
    expect(client.fetch.mock.calls[0][0]).toBe('1:100');
    expect(first.messages).toHaveLength(1);
    expect(first.checkpointCursor).toBeUndefined();
    expect(cursorData(first.nextCursor).after).toBe(100);
    const second = await adapter.readPage({ limit: 20, cursor: first.nextCursor! });
    expect(client.fetch.mock.calls[1][0]).toBe('101:103');
    expect(second.nextCursor).toBeNull();
    expect(cursorData(second.checkpointCursor).after).toBe(103);
    const replay = await adapter.readPage({ limit: 20, cursor: first.nextCursor! });
    expect(replay).toEqual(second);
    const empty = await adapter.readPage({ limit: 20, cursor: second.checkpointCursor });
    expect(empty.messages).toEqual([]);
    expect(empty.checkpointCursor).toBe(second.checkpointCursor);
    expect(client.fetch).toHaveBeenCalledTimes(3);
    client.add(104);
    const later = await adapter.readPage({ limit: 20, cursor: empty.checkpointCursor });
    expect(later.messages).toHaveLength(1);
    expect(cursorData(later.checkpointCursor).after).toBe(104);
  });

  it('resumes at the last returned UID when the message limit is reached', async () => {
    const client = new FakeClient();
    for (let uid = 1; uid <= 22; uid++) client.add(uid);
    const { adapter } = setup(client);
    const first = await adapter.readPage({ limit: 20 });
    expect(first.messages).toHaveLength(20);
    expect(cursorData(first.nextCursor).after).toBe(20);
    const second = await adapter.readPage({ limit: 20, cursor: first.nextCursor! });
    expect(second.messages).toHaveLength(2);
    expect(cursorData(second.checkpointCursor).after).toBe(22);
  });

  it.each([0, -1, 21, 1.5, NaN])('rejects invalid page limits (%s) before connecting', async limit => {
    const { adapter, factory } = setup();
    await expect(adapter.readPage({ limit })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(['', 'not-json', 'e30', 'a'.repeat(1001)])('rejects malformed cursors before connecting', async cursor => {
    const { adapter, factory } = setup();
    await expect(adapter.readPage({ cursor, limit: 20 })).rejects.toMatchObject({ code: 'invalid_cursor' });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    { account: 'another@example.invalid' }, { folder: 'Other' }, { authorizedFrom: '2026-11-26T00:00:00Z' },
  ])('rejects foreign configuration cursors before connecting: %j', async override => {
    const first = await setup(new FakeClient().add(1)).adapter.readPage({ limit: 20 });
    const { adapter, factory } = setup(undefined, override);
    await expect(adapter.readPage({ cursor: first.checkpointCursor, limit: 20 })).rejects.toMatchObject({ code: 'invalid_cursor' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects changed UIDVALIDITY and future watermarks before message fetch', async () => {
    const { adapter, client } = setup(new FakeClient().add(1));
    const page = await adapter.readPage({ limit: 20 });
    client.mailbox.uidValidity = 10n;
    await expect(adapter.readPage({ cursor: page.checkpointCursor, limit: 20 })).rejects.toMatchObject({ code: 'invalid_cursor' });
    client.mailbox.uidValidity = 9n;
    const data = cursorData(page.checkpointCursor);
    data.after = 100;
    await expect(adapter.readPage({ cursor: Buffer.from(JSON.stringify(data)).toString('base64url'), limit: 20 }))
      .rejects.toMatchObject({ code: 'invalid_cursor' });
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('decodes actual GB18030 MIME text and encoded subject without using the sender as channel proof', async () => {
    const raw = Buffer.from([
      'From: BOSS <sender@example.invalid>', 'Subject: =?GB2312?B?1tDOxA==?=', 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=gb18030', 'Content-Transfer-Encoding: base64', '', '1tDOxA==',
    ].join('\r\n'));
    const page = await setup(new FakeClient().add(1, raw)).adapter.readPage({ limit: 20 });
    expect(page.messages[0]).toMatchObject({ subject: '\u4e2d\u6587', bodyText: '\u4e2d\u6587', sourceChannel: null, attachments: [] });
  });

  it('converts HTML to plain text without emitting HTML, inline data or remote context', async () => {
    const raw = Buffer.from([
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
      '<html><script>doNotExecute()</script><p>Name: Fictional</p><img src="https://remote.invalid/tracker">',
      '<a href="https://remote.invalid/resume">Resume</a></html>',
    ].join('\r\n'));
    const page = await setup(new FakeClient().add(1, raw)).adapter.readPage({ limit: 20 });
    expect(page.messages[0].bodyText).toContain('Name: Fictional');
    expect(page.messages[0].bodyText).not.toMatch(/<html|<script|<img|doNotExecute|data:/);
    expect(page.messages[0]).not.toHaveProperty('html');
    expect(page.messages[0]).not.toHaveProperty('externalPostingUrl');
  });

  it('decodes actual attachments with stable part IDs and safe filenames', async () => {
    const raw = multipart([{ name: '../resume.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-fictional') }]);
    const { adapter } = setup(new FakeClient().add(1, raw));
    const page = await adapter.readPage({ limit: 20 });
    expect(page.messages[0].attachments).toEqual([{
      id: '1', fileName: 'resume.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-fictional'),
    }]);
    expect(page.messages[0].materialIssue).toBeUndefined();
  });

  it.each([
    ['malformed headers', Buffer.from('malformed source without MIME headers'), 'missing_material'],
    ['empty body', plain(''), 'missing_material'],
    ['long body', plain('x'.repeat(60001)), 'file_too_large'],
    ['unsupported file', multipart([{ name: 'resume.exe', type: 'application/octet-stream', bytes: Buffer.from('unsafe') }]), 'unsupported_attachment'],
    ['eleven attachments', multipart(Array.from({ length: 11 }, () => ({ name: 'resume.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF') }))), 'file_too_large'],
    ['large attachment', multipart([{ name: 'resume.pdf', type: 'application/pdf', bytes: Buffer.alloc(10 * MiB + 1) }]), 'file_too_large'],
  ])('quarantines unusable MIME without retaining partial documents (%s)', async (_label, raw, issue) => {
    const page = await setup(new FakeClient().add(1, raw as Buffer)).adapter.readPage({ limit: 20 });
    expect(page.messages[0]).toMatchObject({ bodyText: '', attachments: [], materialIssue: issue });
    expect(page.checkpointCursor).toBeTruthy();
  });

  it('quarantines oversized metadata without fetching raw content', async () => {
    const client = new FakeClient().add(1, plain(), received, 32 * MiB + 1);
    const page = await setup(client).adapter.readPage({ limit: 20 });
    expect(client.download).not.toHaveBeenCalled();
    expect(page.messages[0].materialIssue).toBe('file_too_large');
  });

  it('stops before exceeding 40 MiB raw per page, leaving the next message for a later page', async () => {
    const raw = plain('x'.repeat(21 * MiB));
    const client = new FakeClient().add(1, raw).add(2, raw);
    const { adapter } = setup(client);
    const first = await adapter.readPage({ limit: 20 });
    expect(first.messages).toHaveLength(1);
    expect(cursorData(first.nextCursor).after).toBe(1);
    expect(client.download).toHaveBeenCalledTimes(1);
    const second = await adapter.readPage({ limit: 20, cursor: first.nextCursor! });
    expect(second.messages).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('quarantines truncated raw content and cancels a stream that exceeds the requested bound', async () => {
    const client = new FakeClient().add(1, plain(), received, plain().length + 20);
    const first = await setup(client).adapter.readPage({ limit: 20 });
    expect(first.messages[0].materialIssue).toBe('missing_material');
    const stream = Readable.from([Buffer.alloc(2000)]);
    client.download.mockImplementation(async () => ({ content: stream, meta: { expectedSize: 2000 } }));
    client.rows[0].size = 20;
    const second = await setup(client).adapter.readPage({ limit: 20 });
    expect(second.messages[0].materialIssue).toBe('file_too_large');
    expect(stream.destroyed).toBe(true);
  });

  it('bounds decoded attachment output to 30 MiB per page', async () => {
    const raw = multipart([{ name: 'resume.pdf', type: 'application/pdf', bytes: Buffer.alloc(10 * MiB) }]);
    const client = new FakeClient().add(1, raw).add(2, raw).add(3, raw);
    const first = await setup(client).adapter.readPage({ limit: 20 });
    // Base64 wire size enforces the 40 MiB limit before the third document.
    expect(first.messages).toHaveLength(2);
    expect(first.messages.flatMap(message => message.attachments).reduce((n, part) => n + part.bytes.length, 0)).toBe(20 * MiB);
    expect(cursorData(first.nextCursor).after).toBe(2);
  });

  it.each(['auth', 'connect', 'folder', 'fetch', 'download'])('redacts raw provider errors at %s and disconnects', async stage => {
    const client = new FakeClient().add(1);
    const error = new Error(`private account ${config.account}; password ${config.password}`);
    if (stage === 'auth' || stage === 'connect') client.connect.mockRejectedValue(error);
    if (stage === 'folder') client.mailboxOpen.mockRejectedValue(error);
    if (stage === 'fetch') client.fetch.mockImplementation(() => (async function* () { throw error; })());
    if (stage === 'download') client.download.mockRejectedValue(error);
    const { adapter } = setup(client);
    const failure = await adapter.readPage({ limit: 20 }).catch(value => value);
    expect(failure).toMatchObject({ code: 'connection_failed' });
    expect(String(failure)).not.toContain(config.account);
    expect(String(failure)).not.toContain(config.password);
    expect(failure.cause).toBeUndefined();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('enforces one absolute deadline below the 120-second mailbox lease and closes a stalled stream', async () => {
    jest.useFakeTimers();
    try {
      const client = new FakeClient().add(1);
      const stream = new Readable({ read() {} });
      client.download.mockResolvedValue({ content: stream, meta: { expectedSize: plain().length } });
      const pending = setup(client).adapter.readPage({ limit: 20 });
      const result = pending.catch(value => value);
      await jest.advanceTimersByTimeAsync(110_000);
      expect(await result).toMatchObject({ code: 'timeout' });
      expect(stream.destroyed).toBe(true);
      expect(client.close).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('handles error events without unhandled exceptions or leaking provider details', async () => {
    const client = new FakeClient().add(1);
    client.connect.mockImplementation(async () => {
      client.emit('error', new Error(config.password));
    });
    await expect(setup(client).adapter.probe()).rejects.toMatchObject({ code: 'connection_failed' });
    expect(client.mailboxOpen).not.toHaveBeenCalled();
    expect(() => client.emit('error', new Error(config.password))).not.toThrow();
  });

  it('advances through a completely empty UID window without fetching any content', async () => {
    const client = new FakeClient().add(150);
    const page = await setup(client).adapter.readPage({ limit: 20 });
    expect(page.messages).toEqual([]);
    expect(cursorData(page.nextCursor!).after).toBe(100);
    expect(client.download).not.toHaveBeenCalled();
  });

  it('does not download even oversized historical mail outside the authorized time', async () => {
    const client = new FakeClient().add(1, plain(), new Date('2026-11-24T23:59:59Z'), 33 * MiB);
    const page = await setup(client).adapter.readPage({ limit: 20 });
    expect(page.messages).toEqual([]);
    expect(page.checkpointCursor).toBeTruthy();
    expect(client.download).not.toHaveBeenCalled();
  });

  it.each(['duplicate', 'invalid-date', 'out-of-window'])('rejects unsafe metadata instead of advancing the checkpoint: %s', async kind => {
    const client = new FakeClient().add(1);
    if (kind === 'duplicate') client.rows.push({ ...client.rows[0] });
    if (kind === 'invalid-date') client.rows[0].internalDate = new Date(NaN);
    if (kind === 'out-of-window') client.fetch.mockImplementation(() => (async function* () { yield { uid: 200, internalDate: received, size: 20 }; })());
    await expect(setup(client).adapter.readPage({ limit: 20 })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(client.download).not.toHaveBeenCalled();
  });

  it('quarantines a multipart source missing its closing boundary', async () => {
    const raw = multipart([{ name: 'resume.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF') }]);
    const broken = raw.subarray(0, raw.lastIndexOf('--test-boundary--'));
    const page = await setup(new FakeClient().add(1, broken)).adapter.readPage({ limit: 20 });
    expect(page.messages[0]).toMatchObject({ attachments: [], bodyText: '', materialIssue: 'missing_material' });
  });

  it('preserves a source that exceeds only the remaining decoded page budget for the next page', async () => {
    const binaryMime = Buffer.concat([
      Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="binary"\r\n\r\n--binary\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="resume.pdf"\r\nContent-Transfer-Encoding: binary\r\n\r\n'),
      Buffer.alloc(8 * MiB, 65), Buffer.from('\r\n--binary--\r\n'),
    ]);
    const client = new FakeClient().add(1, binaryMime).add(2, binaryMime).add(3, binaryMime).add(4, binaryMime);
    const { adapter } = setup(client);
    const page = await adapter.readPage({ limit: 20 });
    expect(page.messages).toHaveLength(3);
    expect(page.messages.every(message => !message.materialIssue)).toBe(true);
    expect(cursorData(page.nextCursor!).after).toBe(3);
    const next = await adapter.readPage({ cursor: page.nextCursor!, limit: 20 });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].attachments[0].bytes.length).toBe(8 * MiB);
    expect(next.nextCursor).toBeNull();
  });

  it('destroys a download stream that arrives after the absolute deadline', async () => {
    jest.useFakeTimers();
    try {
      const client = new FakeClient().add(1);
      let resolveDownload!: (value: any) => void;
      client.download.mockImplementation(() => new Promise(resolve => { resolveDownload = resolve; }));
      const pending = setup(client).adapter.readPage({ limit: 20 }).catch(value => value);
      await jest.advanceTimersByTimeAsync(95_000);
      expect(await pending).toMatchObject({ code: 'timeout' });
      const lateStream = new Readable({ read() {} });
      resolveDownload({ content: lateStream, meta: {} });
      await jest.advanceTimersByTimeAsync(0);
      expect(lateStream.destroyed).toBe(true);
      expect(client.close).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('uses actual ImapFlow EXAMINE and BODY.PEEK on an in-memory transport, with no modifying commands or broad listing', async () => {
    const raw = plain();
    const commands: string[] = [];
    const adapter = new AlimailRecruitmentAdapter(config, options => {
      let pending = '';
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          pending += chunk.toString();
          let eol: number;
          while ((eol = pending.indexOf('\r\n')) >= 0) {
            const line = pending.slice(0, eol);
            pending = pending.slice(eol + 2);
            commands.push(line);
            const tag = line.split(' ')[0];
            let response: string | Buffer;
            if (/^\S+ CAPABILITY$/i.test(line)) response = '* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR NAMESPACE\r\n';
            else if (/^\S+ (?:AUTHENTICATE PLAIN|LOGIN)\b/i.test(line)) response = '';
            else if (/^\S+ NAMESPACE$/i.test(line)) response = '* NAMESPACE (("" "/")) NIL NIL\r\n';
            else if (/^\S+ (?:LIST|LSUB)\b/i.test(line)) response = '* LIST () "/" "Recruitment"\r\n';
            else if (/^\S+ EXAMINE\b/i.test(line)) response = '* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\n* OK [UIDNEXT 2] next\r\n';
            else if (/^\S+ UID FETCH\b/i.test(line)) {
              const partial = /BODY\.PEEK\[\]<([0-9]+)\.([0-9]+)>/i.exec(line);
              if (partial) {
                const start = Number(partial[1]), length = Number(partial[2]);
                const bytes = raw.subarray(start, start + length);
                response = Buffer.concat([
                  Buffer.from(`* 1 FETCH (UID 1 RFC822.SIZE ${raw.length} BODY[]<${start}> {${bytes.length}}\r\n`),
                  bytes, Buffer.from(')\r\n'),
                ]);
              } else response = `* 1 FETCH (UID 1 RFC822.SIZE ${raw.length} INTERNALDATE "25-Nov-2026 01:00:00 +0000")\r\n`;
            } else { callback(new Error('Forbidden IMAP command in memory transport')); return; }
            socket.push(response);
            socket.push(`${tag} OK ${/ EXAMINE\b/i.test(line) ? '[READ-ONLY] ' : ''}completed\r\n`);
          }
          callback();
        },
      }) as Duplex & { setTimeout(ms: number): void };
      socket.setTimeout = () => undefined;
      return new ImapFlow({ ...options, transport: { connect: (_options, onConnect) => {
        setImmediate(() => { onConnect(); socket.push('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR NAMESPACE] fictional\r\n'); });
        return socket;
      } } });
    });
    const page = await adapter.readPage({ limit: 20 });
    expect(page.messages[0].bodyText).toBe('Name: Fictional Applicant');
    expect(commands.some(line => / EXAMINE "?Recruitment"?$/i.test(line))).toBe(true);
    expect(commands.some(line => /BODY\.PEEK\[\]</i.test(line))).toBe(true);
    expect(commands.some(line => /\b(?:SELECT|STORE|MOVE|COPY|APPEND|EXPUNGE|CREATE|DELETE|RENAME|IDLE)\b/i.test(line))).toBe(false);
    expect(commands.filter(line => / (?:LIST|LSUB)\b/i.test(line)).every(line => line.endsWith(' Recruitment') || line.endsWith(' "Recruitment"'))).toBe(true);
  });
});
