import { test as base, expect, type APIRequestContext, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
const actorKeys = ['editor', 'reviewer', 'reentry', 'assigned'] as const;
type ActorKey = typeof actorKeys[number];
type Actor = { id: string; employeeNo: string; name: string };
type Manifest = { prefix: string; departmentId: string; positionIds: string[]; workLocationId: string;
  actors: Record<ActorKey, Actor>; today: string; arrival: string; historyFrom: string; historyTo: string };
type Fixture = { f: Manifest; tokens: Record<ActorKey, string> };
type Application = { id: string; userId: string; employeeNo: string; requestVersion: number;
  requiresArrivalConfirmation: boolean; onboardingStatus: string };
type State = {
  user: { id: string; employeeNo: string; status: string; positionId: string | null; position: string | null };
  requests: Array<Application & { profileReviewStatus: string; appliedAt: string | null;
    arrivalConfirmedAt: string | null; arrivalConfirmedById: string | null; revisionHistory: unknown[] }>;
  employment: Array<{ id: string; sourceRequestId: string | null; positionId: string | null; position: string | null }>;
  numbers: Array<{ sourceRequestId: string | null; status: string; employeeNo: string }>;
  audits: Array<{ action: string; entityId: string; userId: string }>;
};

function day(offset: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offset * 86_400_000));
}

// Credentials stay in captured pipes and test-local memory, never artifacts or transport errors.
function dockerJson<T>(label: string, source: string): T {
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      input: `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
        const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
        (async () => {
          const [database] = await prisma.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
          if (database.db !== 'hrm_preview' || database.role !== 'hrm_preview') throw new Error('Wrong database');
          if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Uninitialized preview');
          const result = await (async () => { ${source} })();
          process.stdout.write(JSON.stringify(result));
        })().finally(() => prisma.$disconnect()).catch(() => { process.exitCode = 1; });`,
    })) as T;
  } catch {
    throw new Error(`Isolated lifecycle fixture failed: ${label}; subprocess output withheld`);
  }
}

function assertPreview(info: TestInfo) {
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe(origin);
  expect(info.project.use.trace).toBe('off');
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable debug logging before using preview credentials');
  let containers;
  try {
    containers = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch { throw new Error('Unable to verify isolated preview containers'); }
  const [api, web] = containers;
  for (const container of containers) {
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.State.Running).toBe(true);
  }
  expect(api.Config.Labels['com.docker.compose.service']).toBe('api');
  expect(web.Config.Labels['com.docker.compose.service']).toBe('web');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(Object.values(api.NetworkSettings.Ports ?? {}).every(value => value === null)).toBe(true);
  expect(web.NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
  const webEnv = Object.fromEntries(web.Config.Env.map((line: string) => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  expect(webEnv.VITE_PREVIEW_MODE).toBe('true');
  expect(webEnv.VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  dockerJson('guard', 'return { isolated: true };');
}

function manifest(): Manifest {
  const prefix = `AUDLC_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  return { prefix, departmentId: randomUUID(), positionIds: [randomUUID(), randomUUID()], workLocationId: randomUUID(),
    today: day(0), arrival: day(-2), historyFrom: day(-120), historyTo: day(-90),
    actors: Object.fromEntries(actorKeys.map(key => [key, { id: randomUUID(),
      employeeNo: `${prefix}_${key}`, name: `${prefix} ${key}` }])) as Record<ActorKey, Actor> };
}

function createFixture(f: Manifest) {
  dockerJson('create', `
    const f = ${JSON.stringify(f)};
    await prisma.$transaction(async tx => {
      await tx.department.create({ data: { id: f.departmentId, name: f.prefix, company: 'fuede' } });
      await tx.personnelReferenceData.create({ data: { id: f.workLocationId, kind: 'work_location', name: f.prefix + ' office' } });
      for (const [index, id] of f.positionIds.entries()) {
        await tx.position.create({ data: { id, code: f.prefix + '_P' + index,
          name: f.prefix + (index ? ' next' : ' original'), jobFamily: null } });
      }
      for (const [key, actor] of Object.entries(f.actors)) {
        const status = key === 'reentry' ? 'resigned' : 'active';
        const positionId = key === 'assigned' ? f.positionIds[0] : null;
        const position = key === 'assigned' ? f.prefix + ' original' : null;
        await tx.user.create({ data: { ...actor, deptId: f.departmentId, status, positionId, position,
          entryDate: new Date('2020-01-01'), accountType: 'employee',
          sysRole: key === 'reviewer' ? 'hr' : key === 'editor' ? 'hr_user' : 'employee',
          hrCapabilities: key === 'editor' ? ['employee_archive_edit', 'organization_edit']
            : key === 'reviewer' ? ['employee_archive_review'] : [],
          employmentHistory: { create: { effectiveFrom: new Date('2020-01-01'), entryDate: new Date('2020-01-01'),
            company: 'fuede', deptId: f.departmentId, employeeNo: actor.employeeNo, employeeStatus: status,
            positionId, position, changeType: 'onboarding', sourceType: 'preview_fixture' } } } });
      }
    });
    return { created: true };
  `);
}

function ownedQuery<T>(f: Manifest, label: string, source: string): T {
  return dockerJson<T>(label, `
    const f = ${JSON.stringify(f)}; const ids = Object.values(f.actors).map(actor => actor.id);
    const dept = await prisma.department.findUnique({ where: { id: f.departmentId } });
    if (!dept || dept.name !== f.prefix) throw new Error('Foreign department');
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deptId: true } });
    if (users.length !== ids.length || users.some(user => user.deptId !== f.departmentId
      || !Object.values(f.actors).some(actor => actor.id === user.id && actor.name === user.name))) throw new Error('Foreign actor');
    ${source}
  `);
}

function tokensForCurrentNumbers(f: Manifest): Record<ActorKey, string> {
  return ownedQuery(f, 'tokens', `
    const { JwtService } = require('@nestjs/jwt'); const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const tokens = {};
    for (const [key, actor] of Object.entries(f.actors)) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
      tokens[key] = jwt.sign({ sub: user.id, employeeNo: user.employeeNo, sysRole: user.sysRole }, { expiresIn: '15m' });
    }
    return tokens;
  `);
}

function state(f: Manifest, key: 'reentry' | 'assigned'): State {
  return ownedQuery(f, 'state', `
    const userId = f.actors[${JSON.stringify(key)}].id;
    return {
      user: await prisma.user.findUniqueOrThrow({ where: { id: userId },
        select: { id: true, employeeNo: true, status: true, positionId: true, position: true } }),
      requests: await prisma.employeeDataChangeRequest.findMany({ where: { userId }, orderBy: { createdAt: 'asc' },
        select: { id: true, userId: true, employeeNo: true, requestVersion: true, requiresArrivalConfirmation: true,
          onboardingStatus: true, profileReviewStatus: true, appliedAt: true, arrivalConfirmedAt: true,
          arrivalConfirmedById: true, revisionHistory: true } }),
      employment: await prisma.employmentRecord.findMany({ where: { userId }, orderBy: { effectiveFrom: 'asc' },
        select: { id: true, sourceRequestId: true, positionId: true, position: true } }),
      numbers: await prisma.employeeNumberAssignment.findMany({ where: { userId },
        select: { sourceRequestId: true, status: true, employeeNo: true } }),
      audits: await prisma.auditLog.findMany({ where: { userId: { in: ids } },
        select: { action: true, entityId: true, userId: true } }),
    };
  `);
}

function removeFixture(f: Manifest) {
  const result = ownedQuery<{ remaining: number }>(f, 'cleanup', `
    const requests = await prisma.employeeDataChangeRequest.findMany({ where: { userId: { in: ids } }, select: { createdById: true } });
    if (requests.some(request => !ids.includes(request.createdById))) throw new Error('Foreign request on fixture');
    const positions = await prisma.position.findMany({ where: { id: { in: f.positionIds } } });
    if (positions.length !== 2 || positions.some(position => !position.code.startsWith(f.prefix + '_P'))) throw new Error('Foreign position');
    await prisma.$transaction(async tx => {
      await tx.notificationLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeNumberAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.employmentRecord.deleteMany({ where: { userId: { in: ids } } });
      await tx.employeeDataChangeRequest.deleteMany({ where: { userId: { in: ids }, createdById: { in: ids } } });
      await tx.positionChangeRequest.deleteMany({ where: { positionId: { in: f.positionIds }, createdById: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids }, deptId: f.departmentId, name: { startsWith: f.prefix + ' ' } } });
      await tx.position.deleteMany({ where: { id: { in: f.positionIds }, code: { startsWith: f.prefix + '_P' } } });
      await tx.personnelReferenceData.delete({ where: { id: f.workLocationId, kind: 'work_location', name: f.prefix + ' office' } });
      await tx.department.delete({ where: { id: f.departmentId, name: f.prefix } });
    });
    return { remaining: await prisma.user.count({ where: { id: { in: ids } } }) };
  `);
  expect(result.remaining).toBe(0);
  // Never rewind the shared preview employee-number sequence during cleanup.
}

const test = base.extend<{ lifecycle: Fixture }>({
  lifecycle: async ({}, use, info) => {
    base.skip(info.project.name !== 'desktop', 'HTTP/database integration runs once, not once per viewport');
    assertPreview(info);
    const f = manifest();
    createFixture(f);
    try { await use({ f, tokens: tokensForCurrentNumbers(f) }); }
    finally { removeFixture(f); }
  },
});
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(120_000);

async function api<T = unknown>(request: APIRequestContext, fixture: Fixture, actor: ActorKey,
  method: string, path: string, status = 200, data?: unknown): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected preview-local API path');
  let response;
  try {
    response = await request.fetch(`${origin}/api/v1${path}`, { method,
      headers: { authorization: `Bearer ${fixture.tokens[actor]}` },
      ...(data === undefined ? {} : { data }), maxRedirects: 0, timeout: 20_000 });
  } catch { throw new Error(`Lifecycle HTTP transport failed: ${method} ${path}`); }
  expect(response.status(), `${actor}: ${method} ${path}`).toBe(status);
  return (await response.json()).data as T;
}

function historicalInput(f: Manifest) {
  return { company: 'fuede', deptId: f.departmentId, effectiveDate: f.historyFrom, effectiveTo: f.historyTo,
    employeeStatus: 'active', employmentType: 'full_time' };
}

async function approve(request: APIRequestContext, fixture: Fixture, id: string) {
  const seen = await api<Application>(request, fixture, 'reviewer', 'GET', `/employee-archives/applications/${id}`, 200);
  const result = await api<{ failed: unknown[] }>(request, fixture, 'reviewer', 'POST', '/employee-archives/reviews/approve', 201,
    { requestIds: [id], requestVersions: { [id]: seen.requestVersion }, scopes: ['profile'] });
  expect(result.failed).toEqual([]);
}

test('historical reentry revised to current employment needs review and explicit HR arrival', async ({ request, lifecycle }) => {
  const { f } = lifecycle;
  const created = await api<Application>(request, lifecycle, 'editor', 'POST', `/employee-archives/${f.actors.reentry.id}/reentry`, 201, historicalInput(f));
  expect(created.requiresArrivalConfirmation).toBe(false);
  const revised = await api<Application>(request, lifecycle, 'editor', 'PATCH', `/employee-archives/reentry/${created.id}`, 200,
    { ...historicalInput(f), effectiveDate: f.arrival, effectiveTo: null });
  expect(revised).toMatchObject({ id: created.id, userId: f.actors.reentry.id, employeeNo: created.employeeNo,
    requiresArrivalConfirmation: true, requestVersion: created.requestVersion + 1 });
  await api(request, lifecycle, 'editor', 'POST', '/employee-archives/reviews/approve', 403,
    { requestIds: [created.id], scopes: ['profile'] });
  await approve(request, lifecycle, created.id);
  lifecycle.tokens = tokensForCurrentNumbers(f);
  const pending = state(f, 'reentry');
  expect(pending.user).toMatchObject({ id: f.actors.reentry.id, employeeNo: created.employeeNo, status: 'pending_entry' });
  expect(pending.requests[0]).toMatchObject({ onboardingStatus: 'pending_entry', profileReviewStatus: 'approved',
    arrivalConfirmedAt: null, appliedAt: null });
  expect(pending.requests[0].revisionHistory).toHaveLength(1);
  expect(pending.numbers).toEqual([expect.objectContaining({ sourceRequestId: created.id, status: 'reserved' })]);
  await api(request, lifecycle, 'reentry', 'GET', '/auth/me', 401);
  const arrival = { arrivalDate: f.arrival, requestVersion: revised.requestVersion };
  await api(request, lifecycle, 'editor', 'POST', `/employee-archives/applications/${created.id}/confirm-arrival`, 403, arrival);
  expect(state(f, 'reentry')).toEqual(pending);
  await api(request, lifecycle, 'reviewer', 'POST', `/employee-archives/applications/${created.id}/confirm-arrival`, 201, arrival);
  await api(request, lifecycle, 'reentry', 'GET', '/auth/me');
  const active = state(f, 'reentry');
  expect(active.user).toMatchObject({ id: f.actors.reentry.id, status: 'active' });
  expect(active.requests[0]).toMatchObject({ onboardingStatus: 'effective', arrivalConfirmedById: f.actors.reviewer.id });
  expect(active.numbers[0]).toMatchObject({ sourceRequestId: created.id, status: 'current' });
  expect(active.employment.filter(item => item.sourceRequestId === created.id)).toHaveLength(1);
  for (const action of ['confirm_employee_arrival', 'activate_employee_onboarding']) {
    expect(active.audits).toContainEqual({ action, entityId: created.id, userId: f.actors.reviewer.id });
  }
});

test('genuinely historical reentry stays exempt without activating the former employee', async ({ request, lifecycle }) => {
  const { f } = lifecycle;
  const created = await api<Application>(request, lifecycle, 'editor', 'POST', `/employee-archives/${f.actors.reentry.id}/reentry`, 201, historicalInput(f));
  const revised = await api<Application>(request, lifecycle, 'editor', 'PATCH', `/employee-archives/reentry/${created.id}`, 200, historicalInput(f));
  expect(revised.requiresArrivalConfirmation).toBe(false);
  await approve(request, lifecycle, created.id);
  const historical = state(f, 'reentry');
  expect(historical.user).toMatchObject({ id: f.actors.reentry.id, employeeNo: f.actors.reentry.employeeNo, status: 'resigned' });
  expect(historical.requests[0]).toMatchObject({ onboardingStatus: 'effective', requiresArrivalConfirmation: false, arrivalConfirmedAt: null });
  expect(historical.numbers[0].status).toBe('historical');
  await api(request, lifecycle, 'reentry', 'GET', '/auth/me', 401);
  expect(state(f, 'reentry').user.status).toBe('resigned');
});

test('catalog rename preserves assignment snapshots through auth refresh and archive edit but new assignment adopts catalog', async ({ request, lifecycle }) => {
  const { f } = lifecycle;
  const original = state(f, 'assigned').employment[0];
  const renamed = `${f.prefix} renamed`;
  const proposal = await api<{ id: string }>(request, lifecycle, 'editor', 'PATCH', `/positions/${f.positionIds[0]}`, 200, { name: renamed });
  await api(request, lifecycle, 'reviewer', 'POST', `/positions/change-requests/${proposal.id}/approve`, 201);
  await api(request, lifecycle, 'assigned', 'GET', '/auth/me');
  expect(state(f, 'assigned').user.position).toBe(`${f.prefix} original`);

  const detail = await api<{ archiveVersion: string }>(request, lifecycle, 'editor', 'GET', `/employee-archives/${f.actors.assigned.id}`);
  await api(request, lifecycle, 'editor', 'PATCH', `/employee-archives/${f.actors.assigned.id}/draft`, 200,
    { baseVersion: detail.archiveVersion, employee: { workLocation: f.prefix + ' office', workLocationId: f.workLocationId }, profile: {} });
  await api(request, lifecycle, 'assigned', 'GET', '/auth/me');
  const unchanged = state(f, 'assigned');
  expect(unchanged.user.position).toBe(`${f.prefix} original`);
  expect(unchanged.employment.every(item => item.position === `${f.prefix} original`)).toBe(true);

  const change = await api<{ id: string }>(request, lifecycle, 'editor', 'POST', `/employee-archives/${f.actors.assigned.id}/employments`, 201,
    { company: 'fuede', deptId: f.departmentId, positionId: f.positionIds[1], effectiveFrom: f.today,
      changeType: 'transfer', employeeStatus: 'active', employmentType: 'full_time' });
  await approve(request, lifecycle, change.id);
  await api(request, lifecycle, 'assigned', 'GET', '/auth/me');
  const changed = state(f, 'assigned');
  expect(changed.user).toMatchObject({ positionId: f.positionIds[1], position: `${f.prefix} next` });
  expect(changed.employment.find(item => item.sourceRequestId === change.id)).toMatchObject({ position: `${f.prefix} next` });
  expect(changed.employment.find(item => item.id === original.id)).toEqual(original);
});
