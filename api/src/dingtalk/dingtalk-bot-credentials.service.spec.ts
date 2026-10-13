import { ConfigService } from '@nestjs/config';
import { DingtalkBotCredentialsService } from './dingtalk-bot-credentials.service';

describe('DingtalkBotCredentialsService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses only the dedicated robot app credentials and caches its token', async () => {
    const values: Record<string, string> = {
      DINGTALK_APP_KEY: 'hrm-login-app',
      DINGTALK_APP_SECRET: 'hrm-login-secret',
      DINGTALK_BOT_APP_KEY: 'pilot-bot-app',
      DINGTALK_BOT_APP_SECRET: 'pilot-bot-secret',
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      errcode: 0,
      access_token: 'pilot-token',
      expires_in: 7200,
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new DingtalkBotCredentialsService(config);

    await expect(service.getAccessToken()).resolves.toBe('pilot-token');
    await expect(service.getAccessToken()).resolves.toBe('pilot-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string | URL);
    expect(url.searchParams.get('appkey')).toBe('pilot-bot-app');
    expect(url.searchParams.get('appsecret')).toBe('pilot-bot-secret');
  });

  it('fails closed if robot app credentials are missing instead of reusing HRM credentials', async () => {
    const config = {
      get: (key: string) => ({
        DINGTALK_APP_KEY: 'hrm-login-app',
        DINGTALK_APP_SECRET: 'hrm-login-secret',
      }[key]),
    } as unknown as ConfigService;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new DingtalkBotCredentialsService(config);

    await expect(service.getAccessToken()).rejects.toThrow('机器人应用凭证未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
