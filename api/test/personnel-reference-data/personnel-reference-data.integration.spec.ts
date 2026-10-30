import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuthService } from '@/auth/auth.service';
import type { AuthUser } from '@/common/types/auth.types';
import { PersonnelReferenceDataService } from '@/personnel-reference-data/personnel-reference-data.service';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Personnel reference data real HTTP and PostgreSQL', () => {
  let app: TestApp;
  let deptId: string;
  let adminId: string;
  let adminToken: string;
  let editorToken: string;
  let reviewerToken: string;
  let organizerToken: string;
  let employeeToken: string;
  let unprivilegedHrToken: string;
  const runId = randomUUID().slice(0, 8);
  const root = '/api/v1/personnel-reference-data';
  const authorization = (token = adminToken) => ({
    Authorization: `Bearer ${token}`,
  });
  function setClock() {
    jest.useFakeTimers({
      now: new Date('2035-03-20T04:00:00.000Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
  }

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    const redisUrl = new URL(process.env.REDIS_URL ?? '');
    const loopback = ['localhost', '127.0.0.1', '[::1]'];
    if (
      !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
      !loopback.includes(databaseUrl.hostname) ||
      databaseUrl.pathname !== '/hrm_basic_data_test' ||
      !redisUrl.protocol.startsWith('redis') ||
      !loopback.includes(redisUrl.hostname)
    ) {
      throw new Error(
        'Requires explicitly configured disposable loopback hrm_basic_data_test and Redis',
      );
    }
    process.env.JWT_SECRET = randomUUID();
    process.env.EMPLOYEE_ARCHIVE_ENCRYPTION_KEY = randomUUID();
    process.env.ENABLE_TEST_QUICK_LOGIN = 'false';
    process.env.DINGTALK_NOTIFICATION_ENABLED = 'false';
    process.env.DINGTALK_BOT_STREAM_ENABLED = 'false';
    process.env.DINGTALK_BOT_PREFLIGHT_CONFIRMED = 'false';
    setClock();
    app = await buildTestApp();
    app.app
      .get(SchedulerRegistry)
      .getCronJobs()
      .forEach((job) => job.stop());
    deptId = (
      await app.prisma.department.create({
        data: { name: `虚拟基础资料部门-${runId}` },
      })
    ).id;
    async function actor(
      sysRole: 'hr' | 'hr_user' | 'employee',
      hrCapabilities: string[] = [],
    ) {
      const user = await app.prisma.user.create({
        data: {
          name: `虚拟基础资料账号-${randomUUID().slice(0, 8)}`,
          deptId,
          employeeNo: `BASIC-${randomUUID().slice(0, 8)}`,
          accountType: 'service',
          sysRole,
          status: 'active',
          hrCapabilities: hrCapabilities as any,
        },
      });
      return {
        user,
        token: (await app.app.get(AuthService).issueToken(user)).token,
      };
    }
    const admin = await actor('hr');
    adminId = admin.user.id;
    adminToken = admin.token;
    editorToken = (await actor('hr_user', ['employee_archive_edit'])).token;
    reviewerToken = (await actor('hr_user', ['employee_archive_review'])).token;
    organizerToken = (await actor('hr_user', ['organization_edit'])).token;
    unprivilegedHrToken = (await actor('hr_user')).token;
    employeeToken = (
      await actor('employee', [
        'employee_archive_edit',
        'employee_archive_review',
        'organization_edit',
      ])
    ).token;
  });
  beforeEach(setClock);
  afterEach(() => jest.useRealTimers());
  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  async function entry(kind: 'work_location' | 'job_family', suffix: string) {
    const result = await app.http
      .post(`${root}/${kind}`)
      .set(authorization())
      .send({ name: `虚拟资料-${runId}-${suffix}` })
      .expect(201);
    return result.body.data as { id: string; name: string; isActive: boolean };
  }
  async function approve(requestId: string) {
    const result = await app.http
      .post('/api/v1/employee-archives/reviews/approve')
      .set(authorization())
      .send({ requestIds: [requestId], scopes: ['profile', 'performance'] })
      .expect(201);
    expect(result.body.data.failed).toEqual([]);
  }

  it('starts with empty directories without importing history or seed', async () => {
    for (const kind of ['work_location', 'job_family']) {
      const result = await app.http
        .get(`${root}/${kind}?includeInactive=true`)
        .set(authorization())
        .expect(200);
      expect(result.body.data).toEqual([]);
    }
  });

  it('enforces real session and capability boundaries for both kinds', async () => {
    const current = await entry('work_location', '权限');
    for (const kind of ['work_location', 'job_family']) {
      await app.http.get(`${root}/${kind}`).expect(401);
      for (const token of [unprivilegedHrToken, employeeToken]) {
        await app.http
          .get(`${root}/${kind}`)
          .set(authorization(token))
          .expect(403);
        await app.http
          .post(`${root}/${kind}`)
          .set(authorization(token))
          .send({ name: '不可越权新增' })
          .expect(403);
        await app.http
          .patch(`${root}/${kind}/${current.id}`)
          .set(authorization(token))
          .send({ isActive: false })
          .expect(403);
      }
      for (const token of [editorToken, reviewerToken])
        await app.http
          .get(`${root}/${kind}`)
          .set(authorization(token))
          .expect(200);
      await app.http
        .get(`${root}/${kind}`)
        .set(authorization(organizerToken))
        .expect(kind === 'job_family' ? 200 : 403);
      for (const token of [reviewerToken, organizerToken]) {
        await app.http
          .post(`${root}/${kind}`)
          .set(authorization(token))
          .send({ name: '不可越权新增' })
          .expect(403);
        await app.http
          .patch(`${root}/${kind}/${current.id}`)
          .set(authorization(token))
          .send({ isActive: false })
          .expect(403);
      }
    }
    const created = await app.http
      .post(`${root}/job_family`)
      .set(authorization(editorToken))
      .send({ name: `虚拟编辑职系-${runId}` })
      .expect(201);
    await app.http
      .patch(`${root}/job_family/${created.body.data.id}`)
      .set(authorization(editorToken))
      .send({ name: `虚拟编辑职系改名-${runId}`, isActive: false })
      .expect(200);
  });

  it('rejects invalid kinds, IDs, names, query booleans and JSON status types', async () => {
    const current = await entry('work_location', '校验');
    for (const method of ['get', 'post', 'patch'] as const) {
      const endpoint =
        method === 'patch'
          ? `${root}/unknown/${current.id}`
          : `${root}/unknown`;
      await app.http[method](endpoint)
        .set(authorization())
        .send({ name: '无效类型' })
        .expect(400);
    }
    await app.http
      .patch(`${root}/work_location/bad-id`)
      .set(authorization())
      .send({ name: '无效ID' })
      .expect(400);
    await app.http
      .patch(`${root}/work_location/${randomUUID()}`)
      .set(authorization())
      .send({ name: '未知ID' })
      .expect(404);
    await app.http
      .patch(`${root}/job_family/${current.id}`)
      .set(authorization())
      .send({ name: '跨类ID' })
      .expect(404);
    for (const name of ['', '   ', '甲'.repeat(101), null, 12, true]) {
      await app.http
        .post(`${root}/work_location`)
        .set(authorization())
        .send({ name })
        .expect(400);
      await app.http
        .patch(`${root}/work_location/${current.id}`)
        .set(authorization())
        .send({ name })
        .expect(400);
    }
    for (const isActive of ['false', 'true', 0, 1, null]) {
      await app.http
        .patch(`${root}/work_location/${current.id}`)
        .set(authorization())
        .send({ isActive })
        .expect(400);
    }
    for (const query of ['invalid', '1', '0', '', 'True']) {
      await app.http
        .get(`${root}/work_location?includeInactive=${query}`)
        .set(authorization())
        .expect(400);
    }
    await app.http
      .get(`${root}/work_location?includeInactive=true&includeInactive=false`)
      .set(authorization())
      .expect(400);
    await app.http
      .patch(`${root}/work_location/${current.id}`)
      .set(authorization())
      .send({})
      .expect(400);
    await app.http
      .delete(`${root}/work_location/${current.id}`)
      .set(authorization())
      .expect(404);
  });

  it('allows organization editors to list positions while rejecting employee-forged capabilities', async () => {
    const result = await app.http
      .get('/api/v1/positions')
      .set(authorization(organizerToken))
      .expect(200);
    expect(Array.isArray(result.body.data)).toBe(true);
    await app.http
      .get('/api/v1/positions')
      .set(authorization(employeeToken))
      .expect(403);
  });

  it('keeps kinds independent and enforces normalized uniqueness including concurrent creates', async () => {
    const name = `同名资料-${runId}`;
    const created = await app.http
      .post(`${root}/work_location`)
      .set(authorization())
      .send({ name: `  ${name}  ` })
      .expect(201);
    expect(created.body.data.name).toBe(name);
    await app.http
      .post(`${root}/job_family`)
      .set(authorization())
      .send({ name })
      .expect(201);
    await app.http
      .post(`${root}/work_location`)
      .set(authorization())
      .send({ name })
      .expect(409);
    const other = await entry('work_location', '冲突');
    await app.http
      .patch(`${root}/work_location/${other.id}`)
      .set(authorization())
      .send({ name })
      .expect(409);
    const concurrentName = `并发名称-${runId}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        app.http
          .post(`${root}/job_family`)
          .set(authorization())
          .send({ name: concurrentName }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await app.prisma.personnelReferenceData.count({
        where: { kind: 'job_family', name: concurrentName },
      }),
    ).toBe(1);
    const oneHundred = `  ${'甲'.repeat(100)}  `;
    const boundary = await app.http
      .post(`${root}/work_location`)
      .set(authorization())
      .send({ name: oneHundred })
      .expect(201);
    expect(boundary.body.data.name).toHaveLength(100);
  });

  it('filters inactive options, supports reactivation, and persists complete audits', async () => {
    const current = await entry('job_family', '启停');
    await app.http
      .patch(`${root}/job_family/${current.id}`)
      .set(authorization())
      .send({ name: `  ${current.name}更正  `, isActive: false })
      .expect(200);
    for (const query of ['', '?includeInactive=false']) {
      const result = await app.http
        .get(`${root}/job_family${query}`)
        .set(authorization())
        .expect(200);
      expect(result.body.data.some((row: any) => row.id === current.id)).toBe(
        false,
      );
    }
    const all = await app.http
      .get(`${root}/job_family?includeInactive=true`)
      .set(authorization())
      .expect(200);
    expect(all.body.data).toContainEqual(
      expect.objectContaining({
        id: current.id,
        name: `${current.name}更正`,
        isActive: false,
      }),
    );
    await app.http
      .patch(`${root}/job_family/${current.id}`)
      .set(authorization())
      .send({ isActive: true })
      .expect(200);
    const audits = await app.prisma.auditLog.findMany({
      where: { userId: adminId, entityId: current.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(3);
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: 'update_personnel_reference_data',
        oldValue: { kind: 'job_family', name: current.name, isActive: true },
        newValue: {
          kind: 'job_family',
          name: `${current.name}更正`,
          isActive: false,
        },
      }),
    );
  });

  it('rolls back actual database creates and updates when the audit foreign key fails', async () => {
    const service = app.app.get(PersonnelReferenceDataService);
    const absentOperator = { id: randomUUID(), sysRole: 'hr' } as AuthUser;
    const name = `回滚资料-${runId}`;
    await expect(
      service.create('work_location', { name }, absentOperator),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await app.prisma.personnelReferenceData.count({ where: { name } }),
    ).toBe(0);
    const current = await entry('work_location', '回滚更新');
    await expect(
      service.update(
        'work_location',
        current.id,
        { name, isActive: false },
        absentOperator,
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await app.prisma.personnelReferenceData.findUniqueOrThrow({
        where: { id: current.id },
      }),
    ).toMatchObject({ name: current.name, isActive: true });
    expect(
      await app.prisma.auditLog.count({ where: { entityId: current.id } }),
    ).toBe(1);
  });

  it('keeps a continuous audit chain for concurrent rename and status PATCH requests', async () => {
    const current = await entry('work_location', '并发审计');
    const renamed = `${current.name}更正`;
    let release!: () => void;
    let acquired!: () => void;
    const rowLocked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const unblock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = app.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "personnel_reference_data" WHERE "id" = ${current.id}::uuid FOR UPDATE`;
        acquired();
        await unblock;
      },
      { timeout: 15000 },
    );
    await rowLocked;
    const updates = Promise.all([
      app.http
        .patch(`${root}/work_location/${current.id}`)
        .set(authorization())
        .send({ name: renamed })
        .expect(200),
      app.http
        .patch(`${root}/work_location/${current.id}`)
        .set(authorization())
        .send({ isActive: false })
        .expect(200),
    ]);
    try {
      let bothWaiting = false;
      // Hold the row until both real HTTP transactions have reached a blocking row operation.
      // The old implementation reads both stale snapshots before this barrier is released.
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await app.prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%personnel_reference_data%' AND pid <> pg_backend_pid()`;
        if (waiting[0].count >= 2) {
          bothWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(bothWaiting).toBe(true);
    } finally {
      release();
      await blocker;
      await updates;
    }
    const audits = await app.prisma.auditLog.findMany({
      where: {
        entityId: current.id,
        action: 'update_personnel_reference_data',
      },
    });
    expect(audits).toHaveLength(2);
    const initial = {
      kind: 'work_location',
      name: current.name,
      isActive: true,
    };
    const first = audits.find((audit) => {
      const oldValue = audit.oldValue as Record<string, unknown>;
      return oldValue.name === current.name && oldValue.isActive === true;
    });
    expect(first).toBeDefined();
    expect(first!.oldValue).toEqual(initial);
    const second = audits.find((audit) => audit.id !== first!.id);
    expect(second!.oldValue).toEqual(first!.newValue);
    expect(second!.newValue).toEqual({
      kind: 'work_location',
      name: renamed,
      isActive: false,
    });
  });

  it('keeps archive and position name snapshots through directory renames and deactivation', async () => {
    const location = await entry('work_location', '档案地点');
    const family = await entry('job_family', '档案职系');
    const submitted = await app.http
      .post('/api/v1/employee-archives')
      .set(authorization())
      .send({
        name: `虚拟快照员工-${runId}`,
        company: 'fuede',
        deptId,
        entryDate: '2035-03-01',
        effectiveFrom: '2035-03-01',
        employmentType: 'full_time',
        employeeStatus: 'active',
        employee: { workLocation: location.name, jobFamily: family.name },
        profile: {},
        contracts: [],
      })
      .expect(201);
    const positionChange = await app.http
      .post('/api/v1/positions')
      .set(authorization(organizerToken))
      .send({ name: `虚拟快照岗位-${runId}`, jobFamily: family.name })
      .expect(201);
    // These directories supply choices; the original approval pipelines still own effective records.
    await app.http
      .patch(`${root}/work_location/${location.id}`)
      .set(authorization())
      .send({ name: `${location.name}新名`, isActive: false })
      .expect(200);
    await app.http
      .patch(`${root}/job_family/${family.id}`)
      .set(authorization())
      .send({ name: `${family.name}新名`, isActive: false })
      .expect(200);
    await approve(submitted.body.data.id);
    const request =
      await app.prisma.employeeDataChangeRequest.findUniqueOrThrow({
        where: { id: submitted.body.data.id },
      });
    const employment = await app.prisma.employmentRecord.findFirstOrThrow({
      where: { userId: request.userId! },
    });
    expect(employment).toMatchObject({
      workLocation: location.name,
      jobFamily: family.name,
    });
    const pendingPosition =
      await app.prisma.positionChangeRequest.findUniqueOrThrow({
        where: { id: positionChange.body.data.id },
      });
    expect(pendingPosition.proposedValue).toMatchObject({
      jobFamily: family.name,
    });
    expect(
      await app.prisma.position.count({
        where: { name: `虚拟快照岗位-${runId}` },
      }),
    ).toBe(0);
    const changed = await app.http
      .patch(`/api/v1/employee-archives/${request.userId}/draft`)
      .set(authorization())
      .send({
        employee: { workLocation: location.name, jobFamily: family.name },
        profile: { education: '本科' },
      })
      .expect(200);
    await approve(changed.body.data.id);
    const records = await app.prisma.employmentRecord.findMany({
      where: { userId: request.userId! },
    });
    expect(
      records.every(
        (row) =>
          row.workLocation === location.name && row.jobFamily === family.name,
      ),
    ).toBe(true);
  });
});
