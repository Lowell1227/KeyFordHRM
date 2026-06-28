import { ConfigService } from '@nestjs/config';
import { DingtalkService } from './dingtalk.service';

function createConfigService() {
  return {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        DINGTALK_APP_KEY: 'ding-test-app-key',
        DINGTALK_APP_SECRET: 'ding-test-app-secret',
        DINGTALK_AGENT_ID: '123456',
      };
      return map[key];
    }),
  } as unknown as ConfigService;
}

function mockJsonResponse(data: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: jest.fn().mockResolvedValue(data),
  } as any;
}

describe('DingtalkService', () => {
  let service: DingtalkService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new DingtalkService(createConfigService());
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetchDepartments 应解析 result 直接数组', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, access_token: 'corp-token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          errcode: 0,
          result: [{ dept_id: 1001, name: '项目中心', parent_id: 1 }],
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, result: [] }));

    const depts = await service.fetchDepartments();

    expect(depts).toEqual([{ dept_id: 1001, name: '项目中心', parent_id: 1 }]);
  });

  it('getAuthCodeUnionId 应优先走 sns/getuserinfo_bycode', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        errcode: 0,
        user_info: { unionid: 'union-from-sns' },
      }),
    );

    const unionId = await service.getAuthCodeUnionId('oauth-code');

    expect(unionId).toBe('union-from-sns');
    expect(fetchMock.mock.calls[0][0]).toContain('sns/getuserinfo_bycode');
  });

  it('getAuthCodeUnionId 在 sns 失败时应回退到企业免登接口', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 400, errmsg: 'invalid sns code' }, false, 400, 'Bad Request'))
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, access_token: 'corp-token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          errcode: 0,
          result: { userid: 'manager001' },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          errcode: 0,
          result: { unionid: 'union-from-app' },
        }),
      );

    const unionId = await service.getAuthCodeUnionId('dd-runtime-code');

    expect(unionId).toBe('union-from-app');
    expect(fetchMock.mock.calls[2][0]).toContain('topapi/v2/user/getuserinfo');
    expect(fetchMock.mock.calls[3][0]).toContain('topapi/v2/user/get');
  });
});
