import { ConfigService } from '@nestjs/config';
import { DingtalkService } from './dingtalk.service';

function createConfigService() {
  return {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        DINGTALK_APP_KEY: 'ding-test-app-key',
        DINGTALK_APP_SECRET: 'ding-test-app-secret',
        DINGTALK_AGENT_ID: '123456',
        DINGTALK_CORP_ID: 'corp-test',
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

  it('fetchUserDetail 应返回用户详情中的直属主管', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, access_token: 'corp-token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          errcode: 0,
          result: {
            userid: 'u10',
            unionid: 'union10',
            name: '员工甲',
            dept_id_list: [10],
            manager_userid: 'u20',
          },
        }),
      );

    const user = await service.fetchUserDetail('u10');

    expect(user.manager_userid).toBe('u20');
    expect(fetchMock.mock.calls[1][0]).toContain('topapi/v2/user/get');
  });

  it('getAuthCodeUnionId 应使用 OAuth 授权码换取用户 token 和 unionId', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          accessToken: 'user-access-token',
          refreshToken: 'refresh-token',
          expireIn: 7200,
          corpId: 'corp-test',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          unionId: 'union-from-oauth',
          nick: '测试用户',
        }),
      );

    const unionId = await service.getAuthCodeUnionId('oauth-code', 'oauth');

    expect(unionId).toBe('union-from-oauth');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.dingtalk.com/v1.0/oauth2/userAccessToken');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      clientId: 'ding-test-app-key',
      clientSecret: 'ding-test-app-secret',
      code: 'oauth-code',
      grantType: 'authorization_code',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.dingtalk.com/v1.0/contact/users/me');
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      'x-acs-dingtalk-access-token': 'user-access-token',
    });
  });

  it('getAuthCodeUnionId 应拒绝不属于系统企业的 OAuth 组织', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        accessToken: 'user-access-token',
        refreshToken: 'refresh-token',
        expireIn: 7200,
        corpId: 'other-corp',
      }),
    );

    await expect(service.getAuthCodeUnionId('oauth-code', 'oauth')).rejects.toThrow(
      '当前选择的钉钉组织不属于本系统企业',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getAuthCodeUnionId 应直接使用企业内部应用免登接口处理客户端授权码', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, access_token: 'corp-token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          errcode: 0,
          result: { unionid: 'union-from-app', userid: 'manager001' },
        }),
      );

    const unionId = await service.getAuthCodeUnionId('dd-runtime-code', 'internal');

    expect(unionId).toBe('union-from-app');
    expect(fetchMock.mock.calls[1][0]).toContain('topapi/v2/user/getuserinfo');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('sns/getuserinfo_bycode'))).toBe(false);
  });
});
