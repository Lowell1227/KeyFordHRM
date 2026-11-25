import { ConfigService } from '@nestjs/config';
import { DingtalkService } from './dingtalk.service';
import { DingtalkRecruitmentService } from './dingtalk-recruitment.service';

const config = {
  DINGTALK_CORP_ID: 'fictional-org',
  DINGTALK_APP_KEY: 'fictional-app',
  DINGTALK_APP_SECRET: 'fictional-secret',
  DINGTALK_RECRUITMENT_PROCESS_CODE: 'PROC-fictional',
  DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID: 'dept-field',
  DINGTALK_RECRUITMENT_POSITION_CONTROL_ID: 'position-field',
  DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID: 'count-field',
};
const created = '2026-11-01T01:00:00Z';
function instance(overrides: Record<string, unknown> = {}) {
  return {
    status: 'COMPLETED',
    result: 'agree',
    bizAction: 'NONE',
    createTime: created,
    finishTime: '2026-11-02T02:00:00Z',
    formComponentValues: [
      { id: 'dept-field', name: 'Department', value: 'Fictional department' },
      { id: 'position-field', name: 'Position', value: 'Fictional role' },
      { id: 'count-field', name: 'Count', value: '2' },
      { id: 'salary-field', name: 'Salary', value: 'PRIVATE-SALARY' },
      { id: 'attachment-field', value: 'PRIVATE-ATTACHMENT' },
    ],
    originatorUserId: 'PRIVATE-USER',
    title: 'PRIVATE-TITLE',
    operationRecords: [{ remark: 'PRIVATE-REMARK' }],
    ...overrides,
  };
}

describe('DingtalkRecruitmentService read-only adapter', () => {
  let service: DingtalkRecruitmentService;
  let transport: jest.Mock;
  let token: jest.Mock;
  let detail: Record<string, unknown>;
  let listed: string[];
  const realFetch = global.fetch;
  const make = (values: Record<string, string> = config) =>
    new DingtalkRecruitmentService(
      { getAccessToken: token } as unknown as DingtalkService,
      { get: (key: string) => values[key] } as unknown as ConfigService,
    );
  beforeEach(() => {
    token = jest.fn().mockResolvedValue('fictional-token');
    service = make();
    detail = instance();
    listed = ['child', 'original'];
    transport = jest.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/v1.0/workflow/processInstances')
        return Response.json({ success: true, result: detail });
      if (path === '/v1.0/workflow/processes/instanceIds/query')
        return Response.json({
          success: true,
          result: { list: listed, nextToken: null },
        });
      throw new Error('Unexpected network path');
    });
    global.fetch = transport;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('reports missing server config without returning values or making calls', async () => {
    service = make({});
    expect(service.status()).toEqual({
      configured: false,
      readOnly: true,
      scopeVerified: false,
      missing: Object.keys(config),
    });
    await expect(service.readInstance('child')).rejects.toThrow(
      'RECRUITMENT_CONFIG_MISSING',
    );
    await expect(
      service.listIds({ from: '2026-11-01', to: '2026-11-02' }),
    ).rejects.toThrow('RECRUITMENT_CONFIG_MISSING');
    expect(token).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects duplicate control IDs instead of mixing fields', () => {
    service = make({
      ...config,
      DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID: 'dept-field',
    });
    expect(service.status().configured).toBe(false);
  });
  it('accepts the observed Unicode control identifiers without relaxing app or instance identity', async () => {
    service = make({
      ...config,
      DINGTALK_RECRUITMENT_POSITION_CONTROL_ID: '需求岗位',
      DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID: '需求人数',
    });
    detail = instance({
      formComponentValues: [
        { id: 'dept-field', value: 'Fictional department' },
        { id: '需求岗位', value: 'Fictional position' },
        { id: '需求人数', value: '2' },
        { id: 'salary-field', value: 'PRIVATE-SALARY' },
      ],
    });
    expect(service.status().configured).toBe(true);
    const result = await service.readInstance('child');
    expect(result).toMatchObject({
      rawDepartment: 'Fictional department',
      rawPosition: 'Fictional position',
      rawHeadcount: '2',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-');
    await expect(service.readInstance('非法实例')).rejects.toThrow(
      'RECRUITMENT_INSTANCE_INVALID',
    );
    expect(
      make({ ...config, DINGTALK_APP_KEY: '非法应用' }).status().configured,
    ).toBe(false);
  });
  it('returns only allowlisted fields and app-bound source provenance', async () => {
    expect(service.status()).toEqual({
      configured: true,
      missing: [],
      readOnly: true,
      scopeVerified: false,
      scope: {
        organizationKey: 'fictional-org',
        processCode: 'PROC-fictional',
      },
    });
    const source = await service.readInstance('child');
    expect(source).toEqual({
      organizationKey: 'fictional-org',
      processCode: 'PROC-fictional',
      instanceId: 'child',
      status: 'approved',
      rawDepartment: 'Fictional department',
      rawPosition: 'Fictional role',
      rawHeadcount: '2',
      approvedAt: '2026-11-02T02:00:00.000Z',
      sourceCreatedAt: '2026-11-01T01:00:00.000Z',
      sourceUpdatedAt: null,
      sourceLink:
        'https://applink.dingtalk.com/approval/detail?corpId=fictional-org&instanceId=child&from=fictional-app',
      mainInstanceId: null,
      bizAction: 'NONE',
    });
    expect(JSON.stringify(source)).not.toContain('PRIVATE-');
    for (const [url, init] of transport.mock.calls) {
      expect(new URL(url).origin).toBe('https://api.dingtalk.com');
      expect(url).not.toContain('token');
      expect(init.redirect).toBe('error');
      expect(init.headers['x-acs-dingtalk-access-token']).toBe(
        'fictional-token',
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    const body = JSON.parse(transport.mock.calls[1][1].body);
    expect(body.processCode).toBe('PROC-fictional');
    expect(body.endTime - body.startTime).toBe(59999);
    expect(body.statuses).toBeUndefined();
  });
  it('exposes only the current configured source scope after reconfiguration, never credentials', () => {
    const values = { ...config };
    service = make(values);
    expect(service.status().scope).toEqual({
      organizationKey: 'fictional-org',
      processCode: 'PROC-fictional',
    });
    values.DINGTALK_CORP_ID = 'fictional-second-org';
    values.DINGTALK_RECRUITMENT_PROCESS_CODE = 'PROC-second';
    const status = service.status();
    expect(status.scope).toEqual({
      organizationKey: 'fictional-second-org',
      processCode: 'PROC-second',
    });
    expect(Object.keys(status.scope!)).toEqual([
      'organizationKey',
      'processCode',
    ]);
    expect(JSON.stringify(status)).not.toContain('fictional-secret');
    values.DINGTALK_RECRUITMENT_PROCESS_CODE = '';
    expect(service.status().scope).toBeUndefined();
  });
  it.each([
    ['RUNNING', 'agree', 'pending'],
    ['COMPLETED', 'refuse', 'rejected'],
    ['TERMINATED', 'agree', 'withdrawn'],
    ['COMPLETED', 'AGREE', 'unknown'],
    ['COMPLETED', undefined, 'unknown'],
    ['NEW', 'agree', 'unknown'],
  ])(
    'maps only instance-level terminal proof %s/%s',
    async (status, result, expected) => {
      detail = instance({
        status,
        result,
        tasks: [{ status: 'COMPLETED', result: 'AGREE' }],
      });
      const source = await service.readInstance('child');
      expect(source.status).toBe(expected);
      if (expected !== 'approved') expect(source.approvedAt).toBeNull();
      expect(source.supersedesInstanceId).toBeUndefined();
    },
  );
  it('does not treat missing final time or missing allowlisted fields as usable', async () => {
    detail = instance({ finishTime: null });
    expect((await service.readInstance('child')).status).toBe('unknown');
    detail = instance({
      formComponentValues: [
        { id: 'other', name: 'Department', value: 'PRIVATE' },
      ],
    });
    expect(await service.readInstance('child')).toMatchObject({
      status: 'unknown',
      rawDepartment: null,
    });
  });
  it('keeps nonnumeric headcount as text for explicit downstream mapping, without guessing', async () => {
    const fields = instance().formComponentValues as Array<
      Record<string, string>
    >;
    fields[2].value = 'two or three';
    detail = instance({ formComponentValues: fields });
    expect((await service.readInstance('child')).rawHeadcount).toBe(
      'two or three',
    );
  });
  it('marks duplicate configured control IDs as unverifiable without guessing a value', async () => {
    const fields = instance().formComponentValues as Array<
      Record<string, string>
    >;
    detail = instance({ formComponentValues: [...fields, fields[0]] });
    expect(await service.readInstance('child')).toMatchObject({
      status: 'unknown',
      rawDepartment: null,
    });
  });
  it('preserves bounded department JSON and uncertain headcount as approved source evidence for manual mapping', async () => {
    const fields = instance().formComponentValues as Array<
      Record<string, string>
    >;
    const department =
      '[{"deptId":"fictional-dept","name":"Fictional department"}]';
    fields[0].value = department;
    fields[2].value = '若干';
    detail = instance({ formComponentValues: fields });
    const source = await service.readInstance('child');
    expect(source).toMatchObject({
      status: 'approved',
      rawDepartment: department,
      rawHeadcount: '若干',
    });
    expect(JSON.stringify(source)).not.toContain('PRIVATE-SALARY');
    expect(JSON.stringify(source)).not.toContain('PRIVATE-ATTACHMENT');
  });
  it('bounds raw allowlisted strings and does not deserialize object-valued responses', async () => {
    const fields = instance().formComponentValues as Array<
      Record<string, unknown>
    >;
    fields[0].value = 'x'.repeat(2001);
    detail = instance({ formComponentValues: fields });
    expect(await service.readInstance('child')).toMatchObject({
      status: 'unknown',
      rawDepartment: null,
    });
    fields[0].value = { deptId: 'fictional-dept' };
    expect(await service.readInstance('child')).toMatchObject({
      status: 'unknown',
      rawDepartment: null,
    });
  });
  it.each(['MODIFY', 'REVOKE'])(
    'verifies approved %s and same-form original before exposing replacement',
    async (bizAction) => {
      detail = instance({ bizAction, mainProcessInstanceId: 'original' });
      const defaultFetch = transport.getMockImplementation()!;
      transport.mockImplementation((url, init) =>
        new URL(url).searchParams.get('processInstanceId') === 'original'
          ? Response.json({
              success: true,
              result: instance({ status: 'TERMINATED' }),
            })
          : defaultFetch(url, init),
      );
      expect(await service.readInstance('child')).toMatchObject({
        status: 'approved',
        bizAction,
        mainInstanceId: 'original',
        supersedesInstanceId: 'original',
        approvedAt: '2026-11-02T02:00:00.000Z',
      });
      expect(await service.readInstance('original')).toMatchObject({
        status: 'withdrawn',
        approvedAt: null,
      });
    },
  );
  it.each(['MODIFY', 'REVOKE'])(
    'does not approve %s with unverifiable required source controls or invalidate its original',
    async (bizAction) => {
      detail = instance({
        bizAction,
        mainProcessInstanceId: 'original',
        formComponentValues: [],
      });
      const defaultFetch = transport.getMockImplementation()!;
      transport.mockImplementation((url, init) =>
        new URL(url).searchParams.get('processInstanceId') === 'original'
          ? Response.json({ success: true, result: instance() })
          : defaultFetch(url, init),
      );
      const source = await service.readInstance('child');
      expect(source.status).toBe('unknown');
      expect(source.status).not.toBe('approved');
      expect(source.approvedAt).toBeNull();
      expect(source.supersedesInstanceId).toBeUndefined();
    },
  );
  it.each([
    ['RUNNING', 'agree', 'pending'],
    ['COMPLETED', 'refuse', 'rejected'],
    ['TERMINATED', 'agree', 'withdrawn'],
  ])(
    'keeps REVOKE relationship separate from its current %s/%s terminal evidence',
    async (status, result, expected) => {
      detail = instance({
        status,
        result,
        bizAction: 'REVOKE',
        mainProcessInstanceId: 'original',
      });
      const source = await service.readInstance('child');
      expect(source.status).toBe(expected);
      expect(source.approvedAt).toBeNull();
      expect(source.supersedesInstanceId).toBeUndefined();
      expect(
        transport.mock.calls.filter(([url]) =>
          new URL(url).pathname.endsWith('/processInstances'),
        ),
      ).toHaveLength(1);
    },
  );
  it.each(['MODIFY', 'REVOKE'])(
    'rejects %s relationship when the original was created after the new instance',
    async (bizAction) => {
      detail = instance({ bizAction, mainProcessInstanceId: 'original' });
      const defaultFetch = transport.getMockImplementation()!;
      transport.mockImplementation((url, init) =>
        new URL(url).searchParams.get('processInstanceId') === 'original'
          ? Response.json({
              success: true,
              result: instance({ createTime: '2026-11-03T01:00:00Z' }),
            })
          : defaultFetch(url, init),
      );
      const source = await service.readInstance('child');
      expect(source.status).toBe('unknown');
      expect(source.supersedesInstanceId).toBeUndefined();
    },
  );
  it('generates only the documented approval AppLink from trusted IDs, not upstream links or secrets', async () => {
    detail = instance({
      sourceLink: 'https://evil.example/PRIVATE',
      tasks: [{ pcUrl: 'https://evil.example/PRIVATE' }],
    });
    const link = new URL((await service.readInstance('child')).sourceLink!);
    expect(link.origin + link.pathname).toBe(
      'https://applink.dingtalk.com/approval/detail',
    );
    expect([...link.searchParams.keys()]).toEqual([
      'corpId',
      'instanceId',
      'from',
    ]);
    expect(link.searchParams.get('corpId')).toBe('fictional-org');
    expect(link.searchParams.get('instanceId')).toBe('child');
    expect(link.searchParams.get('from')).toBe('fictional-app');
    expect(link.href).not.toContain('secret');
    expect(link.href).not.toContain('token');
  });
  it.each(['RUNNING', 'COMPLETED', 'TERMINATED'])(
    'never invalidates original for a non-approved correction (%s)',
    async (status) => {
      detail = instance({
        status,
        result: 'refuse',
        bizAction: 'MODIFY',
        mainProcessInstanceId: 'original',
      });
      expect(
        (await service.readInstance('child')).supersedesInstanceId,
      ).toBeUndefined();
      expect(
        transport.mock.calls.filter(([url]) =>
          new URL(url).pathname.endsWith('/processInstances'),
        ),
      ).toHaveLength(1);
    },
  );
  it.each(['MODIFY', 'REVOKE'])(
    'fails closed if %s original has no trusted form membership',
    async (bizAction) => {
      detail = instance({ bizAction, mainProcessInstanceId: 'original' });
      listed = ['child'];
      expect(await service.readInstance('child')).toMatchObject({
        status: 'unknown',
      });
      expect(
        (await service.readInstance('child')).supersedesInstanceId,
      ).toBeUndefined();
    },
  );
  it.each([
    { bizAction: 'MODIFY', mainProcessInstanceId: 'child' },
    { bizAction: 'REVOKE' },
    { bizAction: 'UNRECOGNIZED' },
    { bizAction: undefined },
  ])(
    'keeps incomplete or self-referential relationship non-usable: %j',
    async (overrides) => {
      detail = instance(overrides);
      expect((await service.readInstance('child')).status).toBe('unknown');
    },
  );
  it('rejects a contradictory organization or form echo even if list membership matches', async () => {
    for (const echo of [
      { corpId: 'other-org' },
      { processCode: 'other-form' },
      { processInstanceId: 'other-instance' },
    ]) {
      detail = instance(echo);
      await expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_SOURCE_MISMATCH',
      );
    }
  });
  it('rejects instances absent from the configured form list, not by title or field names', async () => {
    listed = ['other'];
    await expect(service.readInstance('child')).rejects.toThrow(
      'RECRUITMENT_SOURCE_MISMATCH',
    );
  });
  it('does not expose a correction pointer if its original belongs to another organization', async () => {
    detail = instance({
      bizAction: 'MODIFY',
      mainProcessInstanceId: 'original',
    });
    const defaultFetch = transport.getMockImplementation()!;
    transport.mockImplementation((url, init) =>
      new URL(url).searchParams.get('processInstanceId') === 'original'
        ? Response.json({
            success: true,
            result: instance({ corpId: 'other-org' }),
          })
        : defaultFetch(url, init),
    );
    const source = await service.readInstance('child');
    expect(source.status).toBe('unknown');
    expect(source.supersedesInstanceId).toBeUndefined();
  });
  it('does not invent source timestamps or fall back to originator department and titles', async () => {
    detail = instance({
      createTime: undefined,
      updateTime: '2026-11-03T00:00:00Z',
    });
    await expect(service.readInstance('child')).rejects.toThrow(
      'RECRUITMENT_SOURCE_UNVERIFIED',
    );
    detail = instance({
      formComponentValues: [],
      originatorDeptName: 'PRIVATE-DEPARTMENT',
      title: 'PRIVATE-TITLE',
    });
    expect(await service.readInstance('child')).toMatchObject({
      status: 'unknown',
      rawDepartment: null,
      rawPosition: null,
    });
  });
  it('traverses numeric cursors, deduplicates IDs and splits ranges into bounded windows', async () => {
    transport.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      return Response.json({
        success: true,
        result:
          body.nextToken === 0
            ? { list: ['child'], nextToken: '20' }
            : { list: ['child', 'original'], nextToken: '' },
      });
    });
    expect(
      await service.listIds({ from: '2026-01-01', to: '2026-06-01' }),
    ).toEqual({ instanceIds: ['child', 'original'], complete: true });
    const bodies = transport.mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    );
    expect(bodies).toHaveLength(4);
    expect(bodies.map((body) => body.nextToken)).toEqual([0, 20, 0, 20]);
    expect(
      bodies.every(
        (body) =>
          body.endTime - body.startTime < 120 * 86400000 &&
          body.maxResults === 20,
      ),
    ).toBe(true);
    expect(bodies[2].startTime).toBe(bodies[1].endTime + 1);
  });
  it('marks looping pages incomplete instead of claiming all instances were read', async () => {
    transport.mockImplementation(async () =>
      Response.json({
        success: true,
        result: { list: ['child'], nextToken: '20' },
      }),
    );
    expect(
      await service.listIds({ from: '2026-11-01', to: '2026-11-01' }),
    ).toEqual({ instanceIds: ['child'], complete: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('caps listing at 10000 IDs and marks a further page incomplete', async () => {
    transport.mockImplementation(async (_url, init) => {
      const offset = JSON.parse(init.body).nextToken;
      return Response.json({
        success: true,
        result: {
          list: Array.from({ length: 20 }, (_, n) => `instance-${offset + n}`),
          nextToken: String(offset + 20),
        },
      });
    });
    const result = await service.listIds({
      from: '2026-11-01',
      to: '2026-11-01',
    });
    expect(result.complete).toBe(false);
    expect(result.instanceIds).toHaveLength(10000);
    expect(transport).toHaveBeenCalledTimes(500);
  });
  it.each([
    { list: ['child'], nextToken: 'unsafe-cursor' },
    { list: ['child'], nextToken: '9007199254740992' },
    { list: 'invalid', nextToken: null },
    { list: ['../other'], nextToken: null },
    { list: Array(21).fill('child'), nextToken: null },
  ])('rejects malformed list evidence: %j', async (result) => {
    transport.mockImplementation(async () =>
      Response.json({ success: true, result }),
    );
    await expect(
      service.listIds({ from: '2026-11-01', to: '2026-11-01' }),
    ).rejects.toThrow('RECRUITMENT_RESPONSE_INVALID');
  });
  it('never trusts instance membership from an incomplete listing', async () => {
    const defaultFetch = transport.getMockImplementation()!;
    transport.mockImplementation((url, init) =>
      new URL(url).pathname.endsWith('/query')
        ? Response.json({
            success: true,
            result: { list: ['child'], nextToken: '0' },
          })
        : defaultFetch(url, init),
    );
    await expect(service.readInstance('child')).rejects.toThrow(
      'RECRUITMENT_SOURCE_UNVERIFIED',
    );
  });
  it('rejects invalid ranges and IDs before fetching', async () => {
    for (const range of [
      { from: 'bad', to: '2026-11-01' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-11-02', to: '2026-11-01' },
      { from: '2020-01-01', to: '2026-11-01' },
    ])
      await expect(service.listIds(range)).rejects.toThrow(
        'RECRUITMENT_RANGE_INVALID',
      );
    await expect(
      service.readInstance('../other?token=PRIVATE'),
    ).rejects.toThrow('RECRUITMENT_INSTANCE_INVALID');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['network', 'permission', 'invalid-json', 'failed-envelope'])(
    'sanitizes %s failures including token and raw response data',
    async (failure) => {
      if (failure === 'network')
        transport.mockRejectedValue(new Error('PRIVATE-TOKEN PRIVATE-SALARY'));
      if (failure === 'permission')
        transport.mockImplementation(async () =>
          Response.json({ message: 'PRIVATE-TOKEN' }, { status: 403 }),
        );
      if (failure === 'invalid-json')
        transport.mockImplementation(async () => new Response('PRIVATE-TOKEN'));
      if (failure === 'failed-envelope')
        transport.mockImplementation(async () =>
          Response.json({ success: false, message: 'PRIVATE-SALARY' }),
        );
      await expect(service.readInstance('child')).rejects.toThrow(
        /^RECRUITMENT_(READ_FAILED|PERMISSION_DENIED|RESPONSE_INVALID)$/,
      );
    },
  );
  it('sanitizes existing token-service failures and never calls fetch afterward', async () => {
    token.mockRejectedValue(new Error('PRIVATE-TOKEN PRIVATE-RAW-RESPONSE'));
    await expect(service.readInstance('child')).rejects.toThrow(
      /^RECRUITMENT_READ_FAILED$/,
    );
    expect(transport).not.toHaveBeenCalled();
  });
  describe('minute-Z wire clock requires unique form membership evidence', () => {
    const utc = Date.parse('2026-11-04T09:30:00Z');
    const beijing = Date.parse('2026-11-04T01:30:00Z');
    function wire(
      memberships: Record<number, string[]>,
      changes: Record<string, unknown> = {},
    ) {
      detail = instance({
        status: 'RUNNING',
        result: '',
        createTime: '2026-11-04T09:30Z',
        finishTime: null,
        ...changes,
      });
      transport.mockImplementation(async (url: string, init: RequestInit) => {
        if (new URL(url).pathname.endsWith('/processInstances'))
          return Response.json({ success: true, result: detail });
        const body = JSON.parse(String(init.body));
        return Response.json({
          success: true,
          result: { list: memberships[body.startTime] ?? [], nextToken: null },
        });
      });
    }
    it.each([
      { clock: 'UTC', start: utc, createdAt: '2026-11-04T09:30:00.000Z' },
      {
        clock: 'Beijing wall clock',
        start: beijing,
        createdAt: '2026-11-04T01:30:00.000Z',
      },
    ])(
      'resolves $clock only after checking both exact form minutes',
      async ({ start, createdAt }) => {
        wire({ [start]: ['child'] });
        const result = await service.readInstance('child');
        expect(result).toMatchObject({
          status: 'pending',
          sourceCreatedAt: createdAt,
          approvedAt: null,
        });
        const bodies = transport.mock.calls
          .filter(([url]) => new URL(url).pathname.endsWith('/query'))
          .map(([, init]) => JSON.parse(String(init.body)));
        expect(bodies.map((body) => body.startTime).sort()).toEqual(
          [utc, beijing].sort(),
        );
        for (const body of bodies)
          expect(body).toMatchObject({
            processCode: 'PROC-fictional',
            endTime: body.startTime + 59999,
          });
        expect(detail.createTime).toBe('2026-11-04T09:30Z');
        expect(detail.finishTime).toBeNull();
      },
    );
    it('rejects duplicate inclusion in both candidate minutes rather than choosing an offset', async () => {
      wire({ [utc]: ['child'], [beijing]: ['child'] });
      await expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_SOURCE_UNVERIFIED',
      );
    });
    it('rejects absence from both candidates without widening the form or source', async () => {
      wire({});
      await expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_SOURCE_MISMATCH',
      );
      expect(
        transport.mock.calls.filter(([url]) =>
          new URL(url).pathname.endsWith('/query'),
        ),
      ).toHaveLength(2);
    });
    it('does not trust an incomplete alternative minute even when one candidate matches', async () => {
      wire({ [utc]: ['child'] });
      const original = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        if (init.body && JSON.parse(init.body).startTime === beijing)
          return Response.json({
            success: true,
            result: { list: [], nextToken: '0' },
          });
        return original(url, init);
      });
      await expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_SOURCE_UNVERIFIED',
      );
    });
    it('fails closed on an unreadable alternative without swallowing permission errors', async () => {
      wire({ [utc]: ['child'] });
      const original = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        if (init.body && JSON.parse(init.body).startTime === beijing)
          return Response.json({ message: 'PRIVATE-DENIED' }, { status: 403 });
        return original(url, init);
      });
      await expect(service.readInstance('child')).rejects.toThrow(
        /^RECRUITMENT_PERMISSION_DENIED$/,
      );
    });
    it('preserves explicit-offset timestamps and the normal single-minute membership path', async () => {
      wire(
        { [beijing]: ['child'] },
        {
          status: 'COMPLETED',
          result: 'agree',
          createTime: '2026-11-04T09:30:45+08:00',
          finishTime: '2026-11-04T09:35:45+08:00',
        },
      );
      await expect(service.readInstance('child')).resolves.toMatchObject({
        sourceCreatedAt: '2026-11-04T01:30:45.000Z',
        approvedAt: '2026-11-04T01:35:45.000Z',
      });
      expect(transport).toHaveBeenCalledTimes(2);
    });
    it('does not shift an explicit finish-time offset when creation uses Beijing minute-Z', async () => {
      wire(
        { [beijing]: ['child'] },
        {
          status: 'COMPLETED',
          result: 'agree',
          finishTime: '2026-11-04T10:40:35+08:00',
        },
      );
      await expect(service.readInstance('child')).resolves.toMatchObject({
        sourceCreatedAt: '2026-11-04T01:30:00.000Z',
        approvedAt: '2026-11-04T02:40:35.000Z',
      });
    });
    it('rejects an impossible calendar date without querying either candidate', async () => {
      wire({}, { createTime: '2026-02-30T09:30Z' });
      await expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_SOURCE_UNVERIFIED',
      );
      expect(transport).toHaveBeenCalledTimes(1);
    });
    it('does not infer an ambiguous minute-Z approval time from the creation clock', async () => {
      jest.useFakeTimers({ now: Date.parse('2026-11-05T03:00:00Z') });
      wire(
        { [beijing]: ['child'] },
        {
          status: 'COMPLETED',
          result: 'agree',
          finishTime: '2026-11-04T09:35Z',
        },
      );
      await expect(service.readInstance('child')).resolves.toMatchObject({
        status: 'unknown',
        sourceCreatedAt: '2026-11-04T01:30:00.000Z',
        approvedAt: null,
      });
    });
    it('uses a minute-Z finish only when creation order and the current cutoff prove one candidate', async () => {
      jest.useFakeTimers({ now: Date.parse('2026-11-04T01:40:00Z') });
      wire(
        { [beijing]: ['child'] },
        {
          status: 'COMPLETED',
          result: 'agree',
          finishTime: '2026-11-04T09:35Z',
        },
      );
      await expect(service.readInstance('child')).resolves.toMatchObject({
        status: 'approved',
        sourceCreatedAt: '2026-11-04T01:30:00.000Z',
        approvedAt: '2026-11-04T01:35:00.000Z',
      });
    });
    it('uses the verified normalized creation minute for bounded submission coverage', async () => {
      jest.useFakeTimers({ now: Date.parse('2026-11-05T03:00:00Z') });
      wire({ [beijing]: ['child'] });
      const original = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        if (init.body) {
          const body = JSON.parse(init.body);
          if (body.endTime - body.startTime > 60000)
            return Response.json({
              success: true,
              result: { list: ['child'], nextToken: null },
            });
        }
        return original(url, init);
      });
      service = make({
        ...config,
        DINGTALK_RECRUITMENT_VERIFIED_SCOPE: JSON.stringify({
          organizationKey: config.DINGTALK_CORP_ID,
          processCode: config.DINGTALK_RECRUITMENT_PROCESS_CODE,
          appKey: config.DINGTALK_APP_KEY,
          recordId: 'fictional-clock-acceptance',
          verifiedAt: '2026-11-04T00:00:00Z',
        }),
      });
      const result = await service.verifyForSubmission('child');
      expect(result).toMatchObject({
        replacementCoverage: 'complete',
        source: { sourceCreatedAt: '2026-11-04T01:30:00.000Z' },
      });
      const scans = transport.mock.calls.filter(
        ([, init]) =>
          init.body &&
          JSON.parse(init.body).endTime - JSON.parse(init.body).startTime >
            60000,
      );
      expect(scans).toHaveLength(1);
      expect(JSON.parse(scans[0][1].body).startTime).toBe(beijing);
    });
  });
  describe('verifyForSubmission fresh bounded replacement evidence', () => {
    const now = Date.parse('2026-11-25T03:00:00Z');
    let instances: Map<string, Record<string, unknown>>;
    let scanIds: string[];
    let scanPages: Array<{ list: string[]; nextToken: string | null }>;
    const isScan = (init: RequestInit) => {
      if (!init.body) return false;
      const body = JSON.parse(String(init.body));
      return body.endTime - body.startTime > 60000;
    };
    beforeEach(() => {
      jest.useFakeTimers({ now });
      instances = new Map([['child', instance()]]);
      scanIds = ['child'];
      scanPages = [];
      transport.mockImplementation(async (url, init) => {
        const target = new URL(url);
        if (target.pathname.endsWith('/processInstances')) {
          const value = instances.get(
            target.searchParams.get('processInstanceId')!,
          );
          if (!value)
            return Response.json(
              { message: 'PRIVATE-UNAVAILABLE' },
              { status: 403 },
            );
          return Response.json({ success: true, result: value });
        }
        const body = JSON.parse(init.body);
        const offset = Number(body.nextToken);
        const page = isScan(init) ? scanPages[offset / 20] : undefined;
        const ids = isScan(init) ? scanIds : [...instances.keys()];
        return Response.json({
          success: true,
          result: page ?? {
            list: ids.slice(offset, offset + 20),
            nextToken: offset + 20 < ids.length ? String(offset + 20) : null,
          },
        });
      });
    });
    it('freshly reads the selected source but never treats exhausted visible lists as proven absence of replacements', async () => {
      instances.set(
        'child',
        instance({
          status: 'TERMINATED',
          attachedProcessInstanceIds: ['unproven-hint'],
        }),
      );
      const result = await service.verifyForSubmission('child');
      expect(result).toMatchObject({
        source: { instanceId: 'child', status: 'withdrawn' },
        relatedSources: [],
        replacementCoverage: 'unproven',
        checkedAt: new Date(now).toISOString(),
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE-');
      expect(
        transport.mock.calls.some(
          ([url]) =>
            new URL(url).searchParams.get('processInstanceId') ===
            'unproven-hint',
        ),
      ).toBe(false);
      const body = JSON.parse(
        transport.mock.calls.find(([, init]) => isScan(init))![1].body,
      );
      expect(body.processCode).toBe(config.DINGTALK_RECRUITMENT_PROCESS_CODE);
      expect(body.endTime).toBe(now);
      expect(body.endTime - body.startTime).toBe(120 * 86400000 - 1);
      expect(body.statuses).toBeUndefined();
      expect(body.userIds).toBeUndefined();
    });
    it.each(['MODIFY', 'REVOKE'])(
      'returns only a verified approved %s successor without changing the original status',
      async (bizAction) => {
        scanIds = ['child', 'successor'];
        instances.set(
          'successor',
          instance({ bizAction, mainProcessInstanceId: 'child' }),
        );
        const result = await service.verifyForSubmission('child');
        expect(result.source.status).toBe('approved');
        expect(result.relatedSources).toEqual([
          expect.objectContaining({
            instanceId: 'successor',
            status: 'approved',
            supersedesInstanceId: 'child',
          }),
        ]);
        expect(result.replacementCoverage).toBe('unproven');
        expect(JSON.stringify(result)).not.toContain('PRIVATE-');
      },
    );
    it.each([
      ['RUNNING', 'agree', 'pending'],
      ['COMPLETED', 'refuse', 'rejected'],
      ['TERMINATED', 'agree', 'withdrawn'],
    ])(
      'keeps %s/%s correction state separate from a proven supersession',
      async (status, result, expected) => {
        scanIds = ['child', 'successor'];
        instances.set(
          'successor',
          instance({
            status,
            result,
            bizAction: 'MODIFY',
            mainProcessInstanceId: 'child',
          }),
        );
        const verification = await service.verifyForSubmission('child');
        expect(verification.relatedSources).toEqual([
          expect.objectContaining({
            instanceId: 'successor',
            status: expected,
          }),
        ]);
        expect(
          verification.relatedSources[0].supersedesInstanceId,
        ).toBeUndefined();
        expect(verification.source.status).toBe('approved');
        expect(verification.replacementCoverage).toBe('unproven');
      },
    );
    it('discovers a verified related chain regardless of list order, not unrelated form instances', async () => {
      scanIds = ['leaf', 'unrelated', 'successor', 'child'];
      instances.set(
        'successor',
        instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'child' }),
      );
      instances.set(
        'leaf',
        instance({ bizAction: 'REVOKE', mainProcessInstanceId: 'successor' }),
      );
      instances.set('unrelated', instance());
      const result = await service.verifyForSubmission('child');
      expect(result.relatedSources.map((row) => row.instanceId)).toEqual([
        'successor',
        'leaf',
      ]);
      expect(result.relatedSources[1].supersedesInstanceId).toBe('successor');
      expect(result.replacementCoverage).toBe('unproven');
    });
    it('bounds directory reads to two pages and detail checks to twenty candidates, without a false complete result', async () => {
      const candidates = Array.from({ length: 40 }, (_, n) => `candidate-${n}`);
      for (const id of candidates) instances.set(id, instance());
      scanPages = [
        { list: candidates.slice(0, 20), nextToken: '20' },
        { list: candidates.slice(20), nextToken: '40' },
      ];
      const result = await service.verifyForSubmission('child');
      expect(
        transport.mock.calls.filter(([, init]) => isScan(init)),
      ).toHaveLength(2);
      const inspected = transport.mock.calls.filter(([url]) =>
        new URL(url).pathname.endsWith('/processInstances'),
      );
      expect(inspected.length).toBeLessThanOrEqual(20);
      expect(result.relatedSources).toEqual([]);
      expect(result.replacementCoverage).toBe('unproven');
    });
    it('does not return a wrong-organization or wrong-form candidate as a verified replacement', async () => {
      scanIds = ['wrong-org', 'wrong-form', 'child'];
      instances.set(
        'wrong-org',
        instance({
          corpId: 'other-org',
          bizAction: 'MODIFY',
          mainProcessInstanceId: 'child',
        }),
      );
      instances.set(
        'wrong-form',
        instance({
          processCode: 'other-form',
          bizAction: 'MODIFY',
          mainProcessInstanceId: 'child',
        }),
      );
      const result = await service.verifyForSubmission('child');
      expect(result.relatedSources).toEqual([]);
      expect(result.replacementCoverage).toBe('unproven');
    });
    it('returns unproven coverage if the compensating list or candidate read is forbidden, without leaking its response', async () => {
      const immediate = transport.getMockImplementation()!;
      transport.mockImplementation((url, init) =>
        isScan(init)
          ? Response.json(
              { message: 'PRIVATE-RESPONSE PermissionDenied' },
              { status: 403 },
            )
          : immediate(url, init),
      );
      expect(await service.verifyForSubmission('child')).toMatchObject({
        relatedSources: [],
        replacementCoverage: 'unproven',
      });
      transport.mockImplementation(immediate);
      scanIds = ['child', 'unreadable'];
      const result = await service.verifyForSubmission('child');
      expect(result.relatedSources).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('PRIVATE-');
    });
    it('fails closed if the selected instance cannot be freshly read or the server config is missing', async () => {
      instances.delete('child');
      await expect(service.verifyForSubmission('child')).rejects.toThrow(
        'RECRUITMENT_PERMISSION_DENIED',
      );
      service = make({});
      transport.mockClear();
      token.mockClear();
      await expect(service.verifyForSubmission('child')).rejects.toThrow(
        'RECRUITMENT_CONFIG_MISSING',
      );
      expect(transport).not.toHaveBeenCalled();
      expect(token).not.toHaveBeenCalled();
      service = make();
      await expect(service.verifyForSubmission('../PRIVATE')).rejects.toThrow(
        'RECRUITMENT_INSTANCE_INVALID',
      );
      expect(transport).not.toHaveBeenCalled();
      expect(token).not.toHaveBeenCalled();
    });
    it('uses one ten-second budget and stops before candidate reads after a late compensating page', async () => {
      const immediate = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return immediate(url, init);
      });
      let error: Error | undefined;
      const done = service.verifyForSubmission('child').catch((cause) => {
        error = cause;
      });
      await jest.advanceTimersByTimeAsync(10000);
      expect(error?.message).toBe('RECRUITMENT_TIMEOUT');
      expect(transport).toHaveBeenCalledTimes(3);
      const signal = transport.mock.calls[0][1].signal;
      expect(
        transport.mock.calls.every(
          ([, init]) => init.signal === signal && init.signal.aborted,
        ),
      ).toBe(true);
      await jest.advanceTimersByTimeAsync(20000);
      await done;
      expect(transport).toHaveBeenCalledTimes(3);
      expect(token).toHaveBeenCalledTimes(3);
      expect(jest.getTimerCount()).toBe(0);
    });
    describe('verified scope receipt and bounded complete coverage', () => {
      const receipt = (changes: Record<string, unknown> = {}) =>
        JSON.stringify({
          organizationKey: config.DINGTALK_CORP_ID,
          processCode: config.DINGTALK_RECRUITMENT_PROCESS_CODE,
          appKey: config.DINGTALK_APP_KEY,
          recordId: 'fictional-scope-acceptance',
          verifiedAt: '2026-11-24T00:00:00Z',
          ...changes,
        });
      const useReceipt = (value = receipt()) => {
        service = make({
          ...config,
          DINGTALK_RECRUITMENT_VERIFIED_SCOPE: value,
        });
      };
      beforeEach(() => {
        useReceipt();
      });
      it('can complete the fully enumerated, readable current form scope without inventing global absence', async () => {
        expect(
          (service.status() as { scopeVerified?: boolean }).scopeVerified,
        ).toBe(true);
        const result = await service.verifyForSubmission('child');
        expect(result).toMatchObject({
          source: { instanceId: 'child', status: 'approved' },
          relatedSources: [],
          replacementCoverage: 'complete',
          checkedAt: new Date(now).toISOString(),
        });
        const body = JSON.parse(
          transport.mock.calls.find(([, init]) => isScan(init))![1].body,
        );
        expect(body.startTime).toBe(Date.parse(created));
        expect(body.endTime).toBe(now);
        const status = JSON.stringify(service.status());
        expect(status).not.toContain('fictional-scope-acceptance');
        expect(status).not.toContain('fictional-app');
      });
      it.each([
        '',
        '{bad',
        '[]',
        'null',
        receipt({ organizationKey: 'other-org' }),
        receipt({ processCode: 'other-form' }),
        receipt({ appKey: 'other-app' }),
        receipt({ recordId: ' ' }),
        receipt({ verifiedAt: 'invalid' }),
        receipt({ verifiedAt: '2026-02-30T00:00:00Z' }),
        receipt({ verifiedAt: '2026-11-26T00:00:00Z' }),
      ])(
        'keeps missing, malformed or mismatched receipt unproven: %s',
        async (value) => {
          useReceipt(value);
          expect(
            (service.status() as { scopeVerified?: boolean }).scopeVerified,
          ).toBe(false);
          expect(service.status().configured).toBe(true);
          expect(
            (await service.verifyForSubmission('child')).replacementCoverage,
          ).toBe('unproven');
        },
      );
      it('does not treat receipt as a permission credential or suppress a fresh 403', async () => {
        instances.delete('child');
        await expect(service.verifyForSubmission('child')).rejects.toThrow(
          'RECRUITMENT_PERMISSION_DENIED',
        );
      });
      it('pins checkedAt to the enumeration cutoff, not a later response completion time', async () => {
        const immediate = transport.getMockImplementation()!;
        transport.mockImplementation(async (url, init) => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return immediate(url, init);
        });
        const pending = service.verifyForSubmission('child');
        await jest.advanceTimersByTimeAsync(3000);
        const result = await pending;
        const body = JSON.parse(
          transport.mock.calls.find(([, init]) => isScan(init))![1].body,
        );
        expect(result.checkedAt).toBe(new Date(body.endTime).toISOString());
        expect(body.endTime).toBe(now + 2000);
        expect(Date.now()).toBe(now + 3000);
        expect(result.replacementCoverage).toBe('complete');
      });
      it('extends a modified selection to its earliest verified main-chain creation time', async () => {
        const rootCreatedAt = '2026-10-20T00:00:00Z';
        instances.set('root', instance({ createTime: rootCreatedAt }));
        instances.set(
          'child',
          instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'root' }),
        );
        scanIds = ['root', 'child'];
        const result = await service.verifyForSubmission('child');
        const body = JSON.parse(
          transport.mock.calls.find(([, init]) => isScan(init))![1].body,
        );
        expect(body.startTime).toBe(Date.parse(rootCreatedAt));
        expect(result.replacementCoverage).toBe('complete');
        expect(result.relatedSources).toEqual([]);
      });
      it('cannot complete when the selected main chain predates the 120-day coverage window', async () => {
        instances.set('root', instance({ createTime: '2026-06-01T00:00:00Z' }));
        instances.set(
          'child',
          instance({ bizAction: 'REVOKE', mainProcessInstanceId: 'root' }),
        );
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
      });
      it('keeps same-main siblings unproven when direct predecessor identity is ambiguous', async () => {
        instances.set('root', instance({ createTime: '2026-10-20T00:00:00Z' }));
        instances.set(
          'child',
          instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'root' }),
        );
        instances.set(
          'sibling',
          instance({
            createTime: '2026-10-25T00:00:00Z',
            bizAction: 'MODIFY',
            mainProcessInstanceId: 'root',
          }),
        );
        scanIds = ['root', 'sibling', 'child'];
        const result = await service.verifyForSubmission('child');
        expect(result.replacementCoverage).toBe('unproven');
        expect(
          result.relatedSources.some((row) => row.instanceId === 'sibling'),
        ).toBe(false);
      });
      it('completes direct successor coverage but preserves its explicit supersession for the parent gate', async () => {
        scanIds = ['child', 'successor'];
        instances.set(
          'successor',
          instance({ bizAction: 'REVOKE', mainProcessInstanceId: 'child' }),
        );
        const result = await service.verifyForSubmission('child');
        expect(result.replacementCoverage).toBe('complete');
        expect(result.relatedSources[0]).toMatchObject({
          instanceId: 'successor',
          status: 'approved',
          supersedesInstanceId: 'child',
        });
      });
      it.each([
        ['RUNNING', 'agree', 'pending'],
        ['COMPLETED', 'refuse', 'rejected'],
        ['TERMINATED', 'agree', 'withdrawn'],
      ])(
        'can complete coverage with a %s/%s related instance without treating it as a replacement',
        async (status, result, expected) => {
          scanIds = ['child', 'successor'];
          instances.set(
            'successor',
            instance({
              status,
              result,
              bizAction: 'MODIFY',
              mainProcessInstanceId: 'child',
            }),
          );
          const verification = await service.verifyForSubmission('child');
          expect(verification.replacementCoverage).toBe('complete');
          expect(verification.source.status).toBe('approved');
          expect(verification.relatedSources[0].status).toBe(expected);
          expect(
            verification.relatedSources[0].supersedesInstanceId,
          ).toBeUndefined();
        },
      );
      it('can completely read two exhausted pages totaling twenty instances', async () => {
        const ids = [
          'child',
          ...Array.from({ length: 19 }, (_, n) => `extra-${n}`),
        ];
        for (const id of ids) if (id !== 'child') instances.set(id, instance());
        scanPages = [
          { list: ids.slice(0, 10), nextToken: '20' },
          { list: ids.slice(10), nextToken: null },
        ];
        const result = await service.verifyForSubmission('child');
        expect(result.replacementCoverage).toBe('complete');
        expect(
          transport.mock.calls.filter(([, init]) => isScan(init)),
        ).toHaveLength(2);
        expect(
          transport.mock.calls.filter(([url]) =>
            new URL(url).pathname.endsWith('/processInstances'),
          ),
        ).toHaveLength(20);
      });
      it('does not complete a listing with an outstanding cursor, even when all inspected details succeed', async () => {
        instances.set('unrelated', instance());
        scanPages = [
          { list: ['child'], nextToken: '20' },
          { list: ['unrelated'], nextToken: '40' },
        ];
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
      });
      it('does not complete an empty or truncated listing that omits the selected instance', async () => {
        scanIds = [];
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
      });
      it('keeps known successors while an unreadable instance prevents complete coverage', async () => {
        scanIds = ['child', 'successor', 'unreadable'];
        instances.set(
          'successor',
          instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'child' }),
        );
        const result = await service.verifyForSubmission('child');
        expect(result.relatedSources[0].supersedesInstanceId).toBe('child');
        expect(result.replacementCoverage).toBe('unproven');
      });
      it('does not complete contradictory form evidence or an unclassifiable relationship', async () => {
        scanIds = ['child', 'other'];
        instances.set('other', instance({ processCode: 'other-form' }));
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
        instances.set('other', instance({ bizAction: 'unknown-action' }));
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
      });
      it('does not complete cyclic main-chain evidence', async () => {
        instances.set(
          'child',
          instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'root' }),
        );
        instances.set(
          'root',
          instance({ bizAction: 'MODIFY', mainProcessInstanceId: 'child' }),
        );
        scanIds = ['root', 'child'];
        expect(
          (await service.verifyForSubmission('child')).replacementCoverage,
        ).toBe('unproven');
      });
      it('cannot complete more than twenty instances and never reads a twenty-first detail', async () => {
        scanIds = [
          'child',
          ...Array.from({ length: 20 }, (_, n) => `extra-${n}`),
        ];
        for (const id of scanIds)
          if (id !== 'child') instances.set(id, instance());
        const result = await service.verifyForSubmission('child');
        expect(result.replacementCoverage).toBe('unproven');
        expect(
          transport.mock.calls.filter(([url]) =>
            new URL(url).pathname.endsWith('/processInstances'),
          ).length,
        ).toBeLessThanOrEqual(20);
      });
    });
  });
  describe('shared whole-operation budget', () => {
    it('aborts slow consecutive list pages at ten seconds and never starts a late next page', async () => {
      jest.useFakeTimers();
      const started = Date.now();
      transport.mockImplementation(async (_url, init) => {
        const cursor = JSON.parse(init.body).nextToken;
        // Deliberately ignore cancellation to prove the continuation guard also works.
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return Response.json({
          success: true,
          result: {
            list: [`instance-${cursor}`],
            nextToken: String(cursor + 20),
          },
        });
      });
      let outcome:
        | { elapsed: number; error?: Error; value?: unknown }
        | undefined;
      const done = service
        .listIds({ from: '2026-11-01', to: '2026-11-01' })
        .then(
          (value) => {
            outcome = { elapsed: Date.now() - started, value };
          },
          (error) => {
            outcome = { elapsed: Date.now() - started, error };
          },
        );
      await jest.advanceTimersByTimeAsync(10000);
      expect(outcome?.error?.message).toBe('RECRUITMENT_TIMEOUT');
      expect(outcome?.elapsed).toBe(10000);
      expect(transport).toHaveBeenCalledTimes(3);
      const signals = transport.mock.calls.map(([, init]) => init.signal);
      expect(new Set(signals).size).toBe(1);
      expect(signals[0].aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(20000);
      await done;
      expect(transport).toHaveBeenCalledTimes(3);
      expect(token).toHaveBeenCalledTimes(3);
      expect(jest.getTimerCount()).toBe(0);
    });
    it.each([3000, 4000])(
      'bounds all four relationship-verification calls with %ims latency per call',
      async (latency) => {
        jest.useFakeTimers();
        const started = Date.now();
        detail = instance({
          bizAction: 'REVOKE',
          mainProcessInstanceId: 'original',
        });
        const immediate = transport.getMockImplementation()!;
        transport.mockImplementation(async (url, init) => {
          await new Promise((resolve) => setTimeout(resolve, latency));
          if (new URL(url).searchParams.get('processInstanceId') === 'original')
            return Response.json({
              success: true,
              result: instance({ status: 'TERMINATED' }),
            });
          return immediate(url, init);
        });
        let outcome:
          | { elapsed: number; error?: Error; value?: unknown }
          | undefined;
        const done = service.readInstance('child').then(
          (value) => {
            outcome = { elapsed: Date.now() - started, value };
          },
          (error) => {
            outcome = { elapsed: Date.now() - started, error };
          },
        );
        await jest.advanceTimersByTimeAsync(10000);
        expect(outcome?.error?.message).toBe('RECRUITMENT_TIMEOUT');
        expect(outcome?.elapsed).toBe(10000);
        const count = latency === 3000 ? 4 : 3;
        expect(transport).toHaveBeenCalledTimes(count);
        expect(
          new Set(transport.mock.calls.map(([, init]) => init.signal)).size,
        ).toBe(1);
        expect(
          transport.mock.calls.every(([, init]) => init.signal.aborted),
        ).toBe(true);
        await jest.advanceTimersByTimeAsync(20000);
        await done;
        expect(transport).toHaveBeenCalledTimes(count);
        expect(token).toHaveBeenCalledTimes(count);
        expect(jest.getTimerCount()).toBe(0);
      },
    );
    it('prevents a delayed membership token from starting fetch after the outer deadline', async () => {
      jest.useFakeTimers();
      token
        .mockImplementationOnce(async () => 'fictional-token')
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('fictional-late-token'), 6000),
            ),
        );
      const immediate = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return immediate(url, init);
      });
      let error: Error | undefined;
      const done = service.readInstance('child').catch((cause) => {
        error = cause;
      });
      await jest.advanceTimersByTimeAsync(10000);
      expect(error?.message).toBe('RECRUITMENT_TIMEOUT');
      expect(token).toHaveBeenCalledTimes(2);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(token.mock.calls[0][0]).toBe(token.mock.calls[1][0]);
      expect(token.mock.calls[1][0].aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(20000);
      await done;
      expect(transport).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });
    it('includes bodies across list pages in the same deadline and stops late body continuations', async () => {
      jest.useFakeTimers();
      transport.mockImplementation(async (_url, init) => ({
        ok: true,
        status: 200,
        json: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          const cursor = JSON.parse(init.body).nextToken;
          return {
            success: true,
            result: {
              list: [`instance-${cursor}`],
              nextToken: String(cursor + 20),
            },
          };
        },
      }));
      let error: Error | undefined;
      const done = service
        .listIds({ from: '2026-11-01', to: '2026-11-01' })
        .catch((cause) => {
          error = cause;
        });
      await jest.advanceTimersByTimeAsync(10000);
      expect(error?.message).toBe('RECRUITMENT_TIMEOUT');
      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport.mock.calls[0][1].signal).toBe(
        transport.mock.calls[1][1].signal,
      );
      expect(transport.mock.calls[1][1].signal.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(20000);
      await done;
      expect(transport).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    });
    it('shares one signal with tokens and all four calls when verification finishes within budget', async () => {
      jest.useFakeTimers();
      detail = instance({
        bizAction: 'MODIFY',
        mainProcessInstanceId: 'original',
      });
      const immediate = transport.getMockImplementation()!;
      transport.mockImplementation(async (url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (new URL(url).searchParams.get('processInstanceId') === 'original')
          return Response.json({ success: true, result: instance() });
        return immediate(url, init);
      });
      const done = service.readInstance('child');
      await jest.advanceTimersByTimeAsync(4000);
      expect(await done).toMatchObject({
        status: 'approved',
        supersedesInstanceId: 'original',
      });
      expect(transport).toHaveBeenCalledTimes(4);
      const signal = transport.mock.calls[0][1].signal;
      expect(
        transport.mock.calls.every(([, init]) => init.signal === signal),
      ).toBe(true);
      expect(token.mock.calls.every(([passed]) => passed === signal)).toBe(
        true,
      );
      expect(signal.aborted).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
  it.each(['token', 'fetch', 'body'])(
    'times out stalled %s inside the shared deadline',
    async (stage) => {
      jest.useFakeTimers();
      if (stage === 'token')
        token.mockImplementation(() => new Promise(() => undefined));
      if (stage === 'fetch')
        transport.mockImplementation(() => new Promise(() => undefined));
      if (stage === 'body')
        transport.mockImplementation(async () => ({
          ok: true,
          json: () => new Promise(() => undefined),
        }));
      const assertion = expect(service.readInstance('child')).rejects.toThrow(
        'RECRUITMENT_TIMEOUT',
      );
      await jest.advanceTimersByTimeAsync(10001);
      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
