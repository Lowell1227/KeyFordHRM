import { ConfigService } from '@nestjs/config';
import { RecruitmentMailboxGateway } from './recruitment-mail-gateway';
import { AlimailRecruitmentAdapter } from './recruitment-alimail-adapter';
import { readRecruitmentMailSettings } from './recruitment-mail-settings';
import { createHash } from 'crypto';

jest.mock('./recruitment-alimail-adapter');
jest.mock('./recruitment-mail-settings');

describe('Recruitment mailbox private configuration', () => {
  const settings = jest.mocked(readRecruitmentMailSettings);
  const Adapter = jest.mocked(AlimailRecruitmentAdapter);
  const config = new ConfigService();
  const value = { account: 'fixture@example.invalid', password: 'fictional-client-value',
    folder: 'Recruitment', authorizedFrom: '2037-01-01T00:00:00.000Z' };
  const readPage = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    settings.mockReturnValue(null);
    Adapter.mockImplementation(() => ({ readPage }) as unknown as AlimailRecruitmentAdapter);
  });

  it('does not construct a mailbox client when explicitly disabled or unconfigured', async () => {
    const gateway = new RecruitmentMailboxGateway(config);
    expect(gateway.status()).toEqual({ configured: false });
    expect(Adapter).not.toHaveBeenCalled();
    await expect(gateway.readPage({ limit: 10 })).rejects.toThrow('未配置');
  });

  it('delegates only server-owned settings and a bounded page request', async () => {
    settings.mockReturnValue(value);
    const result = { mailboxKey: 'fictional', authorizedFrom: value.authorizedFrom, messages: [], nextCursor: null };
    readPage.mockResolvedValue(result);
    const gateway = new RecruitmentMailboxGateway(config);
    expect(settings).toHaveBeenCalledWith(config);
    expect(Adapter).toHaveBeenCalledWith(value);
    expect(gateway.status()).toEqual({ configured: true });
    expect(readPage).not.toHaveBeenCalled();
    await expect(gateway.readPage({ cursor: 'approved-cursor', limit: 5 })).resolves.toBe(result);
    expect(readPage).toHaveBeenCalledWith({ cursor: 'approved-cursor', limit: 5 });
    expect(JSON.stringify(gateway.status())).not.toContain(value.password);
  });

  it('keeps the application available but fails closed on invalid private configuration', async () => {
    settings.mockImplementation(() => { throw new Error(value.password); });
    const gateway = new RecruitmentMailboxGateway(config);
    expect(gateway.status()).toEqual({ configured: false });
    await expect(gateway.readPage({ limit: 1 })).rejects.toThrow('安全配置未就绪');
    expect(Adapter).not.toHaveBeenCalled();
  });

  it('redacts client failures and does not fall back to another mailbox', async () => {
    settings.mockReturnValue(value);
    readPage.mockRejectedValue(new Error(value.password));
    const gateway = new RecruitmentMailboxGateway(config);
    await expect(gateway.readPage({ limit: 1 })).rejects.toThrow('读取未完成');
    await expect(gateway.readPage({ limit: 1 })).rejects.not.toThrow(value.password);
    expect(Adapter).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the adapter after a saved credential change rather than keeping constructor settings', async () => {
    settings.mockReturnValue(value);
    const gateway = new RecruitmentMailboxGateway(config);
    gateway.status();
    settings.mockReturnValue({ ...value, password: 'replacement-private-value' });
    gateway.status();
    expect(Adapter).toHaveBeenCalledTimes(2);
    expect(Adapter.mock.calls[1][0].password).toBe('replacement-private-value');
  });

  it('keeps enabled mailboxes explicit and gives each scope an independent bounded state key', async () => {
    const first = 'recruitment-mail:11111111-1111-4111-8111-111111111111';
    const second = 'recruitment-mail:22222222-2222-4222-8222-222222222222';
    const values = { RECRUITMENT_MAIL_ENABLED: true, RECRUITMENT_MAIL_NAME: 'Synthetic inbox', RECRUITMENT_MAIL_ACCOUNT: value.account,
      RECRUITMENT_MAIL_PASSWORD: value.password, RECRUITMENT_MAIL_FOLDER: value.folder, RECRUITMENT_MAIL_AUTHORIZED_FROM: value.authorizedFrom };
    const rows = [{ id: first, values: { ...values } }, { id: second, values: { ...values, RECRUITMENT_MAIL_ACCOUNT: 'second@example.invalid' } }];
    const dynamic = { get: () => undefined, mailboxConfigurations: () => rows } as unknown as ConfigService;
    const gateway = new RecruitmentMailboxGateway(dynamic);
    expect(gateway.choices()).toHaveLength(2);
    expect(() => gateway.select()).toThrow('选择');
    const initial = gateway.select(first).stateId;
    expect(initial.length).toBeLessThanOrEqual(20);
    expect(gateway.select(second).stateId).not.toBe(initial);
    rows[0].values.RECRUITMENT_MAIL_PASSWORD = 'replacement-private-value';
    expect(gateway.select(first).stateId).toBe(initial);
    rows[0].values.RECRUITMENT_MAIL_FOLDER = 'Another folder';
    expect(gateway.select(first).stateId).not.toBe(initial);
    expect(JSON.stringify(gateway.choices())).not.toContain(value.password);
  });

  it('keeps the selected account snapshot while another account is edited and attributes new mail without guessing legacy', async () => {
    const id = 'recruitment-mail:11111111-1111-4111-8111-111111111111';
    const values = { RECRUITMENT_MAIL_ENABLED: true, RECRUITMENT_MAIL_NAME: 'Synthetic inbox', RECRUITMENT_MAIL_ACCOUNT: value.account,
      RECRUITMENT_MAIL_PASSWORD: value.password, RECRUITMENT_MAIL_FOLDER: value.folder, RECRUITMENT_MAIL_AUTHORIZED_FROM: value.authorizedFrom };
    const gateway = new RecruitmentMailboxGateway({ get: () => undefined, mailboxConfigurations: () => [{ id, values }] } as unknown as ConfigService);
    const selected = gateway.select(id);
    readPage.mockResolvedValue({ mailboxKey: 'alimail:' + 'a'.repeat(64), authorizedFrom: value.authorizedFrom, messages: [], nextCursor: null });
    const page = await selected.readPage({ limit: 1 });
    expect(gateway.sourceForKey(page.mailboxKey)).toEqual({ mailboxId: id, mailboxName: 'Synthetic inbox' });
    expect(gateway.sourceForKey('alimail:' + 'a'.repeat(64))).toEqual({ mailboxId: null, mailboxName: null });
  });

  it('does not let applied mailbox switches bypass the preview external-side-effect gate', () => {
    const id = 'recruitment-mail:11111111-1111-4111-8111-111111111111';
    const values = { RECRUITMENT_MAIL_ENABLED: true, RECRUITMENT_MAIL_ACCOUNT: value.account, RECRUITMENT_MAIL_PASSWORD: value.password,
      RECRUITMENT_MAIL_FOLDER: value.folder, RECRUITMENT_MAIL_AUTHORIZED_FROM: value.authorizedFrom };
    const gateway = new RecruitmentMailboxGateway({ get: (key: string) => key === 'HRM_PREVIEW' ? 'true' : undefined, mailboxConfigurations: () => [{ id, values }] } as unknown as ConfigService);
    expect(gateway.status()).toEqual({ configured: false });
    expect(() => gateway.select(id)).toThrow('未配置');
    expect(readPage).not.toHaveBeenCalled();
  });

  it('adopts a saved legacy mailbox without resetting its existing cursor or changing its source key', async () => {
    settings.mockReturnValue(value);
    const values = { RECRUITMENT_MAIL_ENABLED: true, RECRUITMENT_MAIL_ACCOUNT: value.account,
      RECRUITMENT_MAIL_PASSWORD: 'rotated-private-value', RECRUITMENT_MAIL_FOLDER: value.folder, RECRUITMENT_MAIL_AUTHORIZED_FROM: value.authorizedFrom };
    const gateway = new RecruitmentMailboxGateway({ get: () => undefined, mailboxConfigurations: () => [{ id: 'recruitment-mail', values }] } as unknown as ConfigService);
    const selected = gateway.select('recruitment-mail');
    expect(selected.stateId).toBe('primary');
    const page = { mailboxKey: 'alimail:' + 'a'.repeat(64), authorizedFrom: value.authorizedFrom, messages: [], nextCursor: null };
    readPage.mockResolvedValue(page);
    expect(await selected.readPage({ cursor: 'legacy-cursor', limit: 1 })).toBe(page);
    expect(readPage).toHaveBeenCalledWith({ cursor: 'legacy-cursor', limit: 1 });
  });

  it('uses the persisted original legacy scope after removing the old file, and does not adopt a changed scope as primary', () => {
    const originalScope = createHash('sha256').update(JSON.stringify([value.account, value.folder, value.authorizedFrom])).digest('hex');
    const values = { RECRUITMENT_MAIL_ENABLED: true, RECRUITMENT_MAIL_ACCOUNT: value.account, RECRUITMENT_MAIL_PASSWORD: value.password,
      RECRUITMENT_MAIL_FOLDER: value.folder, RECRUITMENT_MAIL_AUTHORIZED_FROM: value.authorizedFrom, __legacyMailboxScope: originalScope };
    settings.mockReturnValue(null);
    const gateway = new RecruitmentMailboxGateway({ get: () => undefined, mailboxConfigurations: () => [{ id: 'recruitment-mail', values }] } as unknown as ConfigService);
    expect(gateway.select().stateId).toBe('primary');
    values.RECRUITMENT_MAIL_FOLDER = 'New scope';
    settings.mockReturnValue({ ...value, folder: 'New scope' });
    expect(gateway.select().stateId).not.toBe('primary');
  });
});
