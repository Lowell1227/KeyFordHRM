import { ConfigService } from '@nestjs/config';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecruitmentMailSettings } from './recruitment-mail-settings';

describe('server-owned recruitment mail settings', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'hrm-mail-settings-')); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
  const payload = () => ({ version: 1, provider: 'alimail', account: 'hr@example.invalid', password: 'fictional-client-password',
    folder: 'Fictional recruitment', authorizedFrom: '2037-01-01T00:00:00.000Z' });
  function configured(value: unknown = payload(), mode = 0o600) {
    const file = join(directory, 'private.json');
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode });
    return new ConfigService({ RECRUITMENT_MAIL_ENABLED: 'true', RECRUITMENT_MAIL_CONFIG_FILE: file });
  }
  it('stays disabled unless the server explicitly enables it', () => {
    expect(readRecruitmentMailSettings()).toBeNull();
    expect(readRecruitmentMailSettings(new ConfigService({ RECRUITMENT_MAIL_CONFIG_FILE: 'never-read-this-file' }))).toBeNull();
    expect(readRecruitmentMailSettings(new ConfigService({ RECRUITMENT_MAIL_ENABLED: 'false' }))).toBeNull();
  });
  it('returns only the validated adapter fields from a private bounded file', () => {
    const { version: _version, provider: _provider, ...expected } = payload();
    expect(readRecruitmentMailSettings(configured())).toEqual(expected);
  });
  it.each(['{bad-json', 'x'.repeat(8193), { ...payload(), password: null }, { ...payload(), folder: '' },
    { ...payload(), provider: 'arbitrary' }, { ...payload(), version: 2 }, { ...payload(), rejectUnauthorized: false },
    { ...payload(), host: 'unapproved.invalid' }])('rejects malformed, partial or extensible credentials without leaking values %#', value => {
    let error: Error | undefined;
    try { readRecruitmentMailSettings(configured(value)); } catch (cause) { error = cause as Error; }
    expect(error).toBeDefined();
    expect(error!.message).not.toContain(payload().password);
    expect(error!.message).not.toContain(directory);
  });
  it('rejects missing server paths with a redacted error', () => {
    expect(() => readRecruitmentMailSettings(new ConfigService({ RECRUITMENT_MAIL_ENABLED: 'true' }))).toThrow('安全配置');
  });
  if (process.platform !== 'win32') {
    it('rejects broadly readable secret files and symlink targets', () => {
      expect(() => readRecruitmentMailSettings(configured(payload(), 0o644))).toThrow('安全配置');
      const target = join(directory, 'private.json'), link = join(directory, 'alias.json');
      symlinkSync(target, link);
      expect(() => readRecruitmentMailSettings(new ConfigService({ RECRUITMENT_MAIL_ENABLED: 'true', RECRUITMENT_MAIL_CONFIG_FILE: link }))).toThrow('安全配置');
    });
  }
});
