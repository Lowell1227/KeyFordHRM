import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import * as CFB from 'cfb';
import { TalentResumeService } from './talent-resume.service';
import { RESUME_LIMITS, ResumeClientError } from './talent-resume-client';
import type { AuthUser } from '@/common/types/auth.types';

const hr = { id: 'synthetic-hr', sysRole: 'hr' } as AuthUser;
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex');
const file = (buffer: Buffer = png, originalname = '虚构简历.png', mimetype = 'image/png') => ({ buffer, size: buffer.length, originalname, mimetype }) as Express.Multer.File;
async function docx(extra: Record<string, string | Buffer> = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>');
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function doc(encrypted = false) {
  const container = CFB.utils.cfb_new();
  const fib = Buffer.alloc(64);
  fib.writeUInt16LE(0xa5ec); fib.writeUInt16LE(0xc1, 2);
  if (encrypted) fib.writeUInt16LE(0x100, 10);
  CFB.utils.cfb_add(container, 'WordDocument', fib);
  CFB.utils.cfb_add(container, '0Table', Buffer.from('synthetic-table'));
  return CFB.write(container, { type: 'buffer', fileType: 'cfb' });
}

describe('TalentResumeService (no persistence / external calls)', () => {
  let service: TalentResumeService;
  let enabled: unknown;
  const ai = { getProviderRuntimeConfig: jest.fn() };
  const client = { parse: jest.fn(), parseText: jest.fn() };
  beforeEach(() => {
    enabled = undefined;
    ai.getProviderRuntimeConfig.mockReset().mockResolvedValue({ provider: 'deepseek', apiKey: 'synthetic-key', modelId: 'performance-model' });
    client.parse.mockReset().mockResolvedValue({ fields: { name: '虚构候选人' }, reviewItems: [], pageCount: 1 });
    client.parseText.mockReset().mockResolvedValue({ fields: { name: '虚构候选人' }, reviewItems: [], pageCount: 0 });
    service = new TalentResumeService(ai as never, { get: () => enabled } as unknown as ConfigService, client as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the existing parser permission, enablement and field extraction for mail text', async () => {
    enabled = true;
    expect(await service.parseText('Name: Synthetic', hr)).toMatchObject({ fields: { name: '虚构候选人' }, source: { kind: 'text', pageCount: 0 } });
    expect(client.parseText).toHaveBeenCalledWith('Name: Synthetic', 'synthetic-key', undefined);
    expect(client.parse).not.toHaveBeenCalled();
    await expect(service.parseText('Name: Synthetic', { id: 'viewer', sysRole: 'employee' } as AuthUser)).rejects.toThrow('权限');
    enabled = false;
    await expect(service.parseText('Name: Synthetic', hr)).rejects.toThrow('未启用');
  });

  it('keeps failed text parsing retriable and never exposes a provider response', async () => {
    enabled = true;
    client.parseText.mockRejectedValueOnce(new ResumeClientError('timeout'));
    await expect(service.parseText('Name: Synthetic', hr)).rejects.toThrow('超时');
    await expect(service.parseText('Name: Synthetic', hr)).resolves.toHaveProperty('fields');
  });

  it('accepts an explicit employee operator but denies its assessor-only variant before provider access', async () => {
    enabled = true;
    const operator = { ...hr, sysRole: 'employee', hrCapabilities: ['recruitment_edit'] } as AuthUser;
    await expect(service.parse(file(), operator)).resolves.toMatchObject({ fields: { name: '虚构候选人' } });
    ai.getProviderRuntimeConfig.mockClear(); client.parse.mockClear();
    await expect(service.parse(file(), { ...operator, isAssessorOnly: true })).rejects.toThrow('权限');
    expect(client.parse).not.toHaveBeenCalled();
    expect(ai.getProviderRuntimeConfig).not.toHaveBeenCalled();
  });

  it.each([undefined, false, 'false', '0', 'yes'])('reports disabled config accurately: %s', async (value) => {
    enabled = value;
    expect(await service.getStatus(hr)).toEqual({ configured: true, enabled: false, provider: 'deepseek', modelId: 'deepseek-flash' });
    await expect(service.parse(file(), hr)).rejects.toThrow('未启用');
    expect(client.parse).not.toHaveBeenCalled();
  });

  it.each([true, 'true'])('reports the independent resume switch enabled (%s)', async (value) => {
    enabled = value;
    expect(await service.getStatus(hr)).toMatchObject({ enabled: true, configured: true });
    ai.getProviderRuntimeConfig.mockResolvedValue(null);
    expect(await service.getStatus(hr)).toMatchObject({ enabled: true, configured: false });
    await expect(service.parse(file(), hr)).rejects.toThrow('配置');
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('returns only safe status and source to the current user without sending the original filename', async () => {
    enabled = true;
    const result = await service.parse(file(), hr);
    expect(result).toEqual({ fields: { name: '虚构候选人' }, reviewItems: [], source: { fileName: '虚构简历.png', pageCount: 1 } });
    expect(ai.getProviderRuntimeConfig).toHaveBeenCalledWith('deepseek');
    expect(client.parse.mock.calls[0][0]).toMatchObject({ mimeType: 'image/png', extension: 'png' });
    expect(JSON.stringify(client.parse.mock.calls[0][0])).not.toContain('虚构简历');
    expect(JSON.stringify(result)).not.toContain('synthetic-key');
  });

  it.each([
    undefined, { id: 'employee', sysRole: 'employee', canViewAll: true },
    { id: 'reviewer', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] },
    { id: 'manager', sysRole: 'manager', hrCapabilities: ['employee_archive_edit'] },
  ])('denies non-maintainers before credential reads %#', async (actor) => {
    enabled = true;
    await expect(service.getStatus(actor as AuthUser)).rejects.toThrow('权限');
    await expect(service.parse(file(), actor as AuthUser)).rejects.toThrow('权限');
    expect(ai.getProviderRuntimeConfig).not.toHaveBeenCalled();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('preserves explicit archive-edit authorization for hr_user and existing system admins', async () => {
    enabled = true;
    for (const actor of [{ id: 'editor', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }, { id: 'admin', sysRole: 'system_admin' }]) {
      await expect(service.parse(file(), actor as AuthUser)).resolves.toHaveProperty('fields');
    }
  });

  it.each([
    () => undefined,
    () => file(Buffer.alloc(0)),
    () => file(Buffer.alloc(RESUME_LIMITS.fileBytes + 1)),
    () => ({ ...file(), size: 1 }),
    () => file(Buffer.from('<html>fake</html>'), 'resume.pdf', 'application/pdf'),
    () => file(png, 'resume.pdf', 'application/pdf'),
    () => file(png, 'resume.png.exe'),
    () => file(png, '../resume.png'),
    () => file(png, 'resume\r\n.png'),
    () => file(Buffer.from('PK\x03\x04'), 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    () => file(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'resume.doc', 'application/msword'),
    () => file(png.subarray(0, 16)),
    () => file(Buffer.from('%PDF-1.4 invalid'), 'resume.pdf', 'application/pdf'),
  ])('rejects empty, oversize, forged, truncated or malicious upload %#', async (make) => {
    enabled = true;
    await expect(service.parse(make() as any, hr)).rejects.toThrow();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('accepts actual DOCX and legacy Word containers without disk writes', async () => {
    enabled = true;
    await service.parse(file(await docx(), 'resume.docx', 'application/octet-stream'), hr);
    await service.parse(file(doc(), 'resume.doc', 'application/msword'), hr);
    expect(client.parse).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => docx({ 'word/vbaProject.bin': 'macro' }),
    () => docx({ 'word/embeddings/file.bin': 'embedded' }),
    () => docx({ 'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://private.invalid"/></Relationships>' }),
    () => docx({ 'word/document.xml': '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///private">]><doc>&x;</doc>' }),
    () => docx({ 'word/document.xml': 'a'.repeat(RESUME_LIMITS.docxExpandedBytes + 1) }),
    () => docx({ 'word/document.xml': '<html/>' }),
    () => docx({ 'word/../../escape.xml': '<a/>' }),
  ])('rejects unsafe, invalid and decompression-bomb DOCX before HTTP %#', async (make) => {
    enabled = true;
    await expect(service.parse(file(await make(), 'resume.docx'), hr)).rejects.toThrow();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('rejects encrypted DOC and non-Word OLE containers', async () => {
    enabled = true;
    await expect(service.parse(file(doc(true), 'resume.doc'), hr)).rejects.toThrow();
    const cfb = CFB.utils.cfb_new(); CFB.utils.cfb_add(cfb, 'Workbook', Buffer.from('xlsx'));
    await expect(service.parse(file(CFB.write(cfb, { type: 'buffer' }), 'resume.doc'), hr)).rejects.toThrow();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('bounds actual inflation even when a DOCX lies about its expanded size', async () => {
    enabled = true;
    const buffer = await docx({ 'word/document.xml': 'a'.repeat(RESUME_LIMITS.docxExpandedBytes + 1) });
    let index = 0;
    while ((index = buffer.indexOf(Buffer.from('504b0102', 'hex'), index)) !== -1) {
      const length = buffer.readUInt16LE(index + 28);
      if (buffer.toString('utf8', index + 46, index + 46 + length) === 'word/document.xml') {
        buffer.writeUInt32LE(1, index + 24);
        break;
      }
      index += 4;
    }
    await expect(service.parse(file(buffer, 'resume.docx'), hr)).rejects.toThrow();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('identifies PDF and JPEG content rather than trusting an arbitrary MIME header', async () => {
    enabled = true;
    await service.parse(file(Buffer.from('%PDF-1.4\nsynthetic\n%%EOF\n'), 'resume.pdf', 'image/png'), hr);
    const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex');
    await service.parse(file(Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(8), jpeg.subarray(-2)]), 'resume.jpeg', 'application/octet-stream'), hr);
    expect(client.parse.mock.calls.map(call => call[0].mimeType)).toEqual(['application/pdf', 'image/jpeg']);
  });

  it('limits two simultaneous users globally and lets a failed validation release the slot', async () => {
    enabled = true;
    const finishes: Array<() => void> = [];
    client.parse.mockImplementation(() => new Promise(resolve => { finishes.push(() => resolve({ fields: {}, reviewItems: [], pageCount: 1 })); }));
    const first = service.parse(file(), hr);
    const second = service.parse(file(), { ...hr, id: 'second' });
    await new Promise(resolve => setImmediate(resolve));
    await expect(service.parse(file(), { ...hr, id: 'third' })).rejects.toThrow('正在解析');
    finishes.forEach(finish => finish()); await Promise.all([first, second]);
    await expect(service.parse(file(Buffer.from('invalid')), hr)).rejects.toThrow();
    client.parse.mockResolvedValue({ fields: {}, reviewItems: [], pageCount: 1 });
    await expect(service.parse(file(), hr)).resolves.toHaveProperty('source');
  });

  it('expires rate counters after a minute', async () => {
    enabled = true;
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    for (let i = 0; i < RESUME_LIMITS.userRequestsPerMinute; i++) await service.parse(file(), hr);
    await expect(service.parse(file(), hr)).rejects.toThrow('频繁');
    now.mockReturnValue(1_060_001);
    await expect(service.parse(file(), hr)).resolves.toHaveProperty('source');
  });

  it('bounds decoded image dimensions before OCR', async () => {
    enabled = true;
    const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16);
    await expect(service.parse(file(huge), hr)).rejects.toThrow();
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('rejects concurrent requests before any second pair of network calls', async () => {
    enabled = true;
    let finish: () => void;
    client.parse.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ fields: {}, reviewItems: [], pageCount: 1 }); }));
    const pending = service.parse(file(), hr);
    await new Promise(resolve => setImmediate(resolve));
    await expect(service.parse(file(), hr)).rejects.toThrow('正在解析');
    finish!(); await pending;
  });

  it('limits per-user and total process request rate, releasing slots on sanitized failures', async () => {
    enabled = true;
    client.parse.mockRejectedValue(new ResumeClientError('timeout'));
    for (let i = 0; i < RESUME_LIMITS.userRequestsPerMinute; i++) {
      await expect(service.parse(file(), hr)).rejects.toThrow('超时');
    }
    await expect(service.parse(file(), hr)).rejects.toThrow('频繁');
    for (let i = RESUME_LIMITS.userRequestsPerMinute; i < RESUME_LIMITS.requestsPerMinute; i++) {
      await expect(service.parse(file(), { ...hr, id: 'synthetic-' + i })).rejects.toThrow('超时');
    }
    await expect(service.parse(file(), { ...hr, id: 'extra' })).rejects.toThrow('频繁');
  });

  it('sanitizes unexpected client failures without logging or serializing upstream content', async () => {
    enabled = true;
    const log = jest.spyOn(console, 'error').mockImplementation();
    client.parse.mockRejectedValue(new Error('synthetic-key PRIVATE-RESUME-BODY'));
    await expect(service.parse(file(), hr)).rejects.toThrow('解析暂时失败');
    expect(log).not.toHaveBeenCalled();
  });
});
