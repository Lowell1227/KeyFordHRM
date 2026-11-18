import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as ExcelJS from 'exceljs';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import * as officeCrypto from 'officecrypto-tool';
import { RosterSensitiveExportService } from './roster-sensitive-export.service';

describe('sensitive roster export', () => {
  const viewer = { id: 'fixture-hr', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] } as any;
  const credentials = { accountPassword: 'fixture-account', filePassword: 'fixture-file-2026' };
  let service: RosterSensitiveExportService;
  let findUnique: jest.Mock;
  beforeEach(async () => {
    findUnique = jest.fn().mockResolvedValue({ status: 'active', deletedAt: null, archivedAt: null,
      mustChangePassword: false, passwordHash: await bcrypt.hash(credentials.accountPassword, 4) });
    service = new RosterSensitiveExportService({ user: { findUnique } } as any, new ConfigService({ EMPLOYEE_ARCHIVE_ENCRYPTION_KEY: 'fictional-secret' }));
  });
  it('denies organization-only access before reading the account', async () => {
    await expect(service.authorize({ ...viewer, hrCapabilities: ['organization_edit'] }, credentials)).rejects.toThrow('权限');
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('checks the current actor password, rejects reuse and incomplete credentials', async () => {
    await expect(service.authorize(viewer, credentials)).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: viewer.id } }));
    await expect(service.authorize(viewer, { ...credentials, accountPassword: 'wrong' })).rejects.toThrow('账号密码不正确');
    await expect(service.authorize(viewer, { ...credentials, filePassword: credentials.accountPassword })).rejects.toThrow('不能与账号密码相同');
    await expect(service.authorize(viewer, { ...credentials, filePassword: '' })).rejects.toThrow('8');
  });
  it.each([{ passwordHash: null }, { mustChangePassword: true }, { status: 'resigned' }])('rejects unavailable accounts %p', async changes => {
    findUnique.mockResolvedValue({ status: 'active', passwordHash: await bcrypt.hash(credentials.accountPassword, 4), ...changes });
    await expect(service.authorize(viewer, credentials)).rejects.toThrow();
  });
  it('limits password guesses even when the caller sends concurrent requests', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.authorize(viewer, { ...credentials, accountPassword: 'wrong' })));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(5);
    await expect(service.authorize(viewer, credentials)).rejects.toThrow('15分钟');
  });
  it('decrypts the existing AES-GCM profile envelope and fails closed on corrupt records', () => {
    const key = createHash('sha256').update('employee-archive:fictional-secret').digest();
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const text = '000000200001010000';
    const content = Buffer.concat([cipher.update(text), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), content]);
    expect(service.decryptIdentity(envelope)).toBe(text);
    expect(service.decryptIdentity(null)).toBe('');
    envelope[14] ^= 1;
    expect(() => service.decryptIdentity(envelope)).toThrow('身份证资料解密失败');
  });
  it('creates a file-encrypted workbook, preserves text and rejects the wrong opening password', async () => {
    const book = new ExcelJS.Workbook(); book.addWorksheet('花名册').addRow(['000000200001010000']);
    const plain = Buffer.from(await book.xlsx.writeBuffer());
    const encrypted = await service.encryptWorkbook(plain, credentials.filePassword);
    expect(officeCrypto.isEncrypted(encrypted)).toBe(true);
    await expect(officeCrypto.decrypt(encrypted, { password: 'wrong' })).rejects.toThrow();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await officeCrypto.decrypt(encrypted, { password: credentials.filePassword }) as any);
    expect(restored.getWorksheet('花名册')!.getCell('A1').value).toBe('000000200001010000');
  });
});
