import { ConfigService } from '@nestjs/config';
import { RecruitmentMailboxGateway } from './recruitment-mail-gateway';
import { AlimailRecruitmentAdapter } from './recruitment-alimail-adapter';
import { readRecruitmentMailSettings } from './recruitment-mail-settings';

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
});
