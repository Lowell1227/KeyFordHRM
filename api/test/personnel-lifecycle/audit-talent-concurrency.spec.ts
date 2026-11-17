import { execFileSync } from 'node:child_process';

// Run only after the controller updates preview. No AppModule bootstrap, scheduler or external calls.
// From api: HRM_AUDIT_TALENT_INTEGRATION=1 npx jest --config test/jest-personnel-lifecycle.config.json
//   --testRegex audit-talent-concurrency.spec.ts --runInBand
async function runInPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { ConfigService } = require('@nestjs/config');
  const { TalentsService } = require('./dist/src/talent-pool/talents.service');
  const { EmployeeOnboardingService } = require('./dist/src/employee-archives/employee-onboarding.service');
  const { EmployeeEffectiveDateService } = require('./dist/src/employee-archives/employee-effective-date.service');
  const { EmployeeNumberService } = require('./dist/src/employee-archives/employee-number.service');
  const { EmployeeIdentityMatchService } = require('./dist/src/employee-archives/employee-identity-match.service');
  const { shanghaiBusinessDate } = require('./dist/src/employee-archives/employment-timeline');
  const prefix = `AT_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('connection_limit', '1');
  const client = () => new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const observer = client();
  const editorDb = client();
  const arrivalDb = client();
  const otherDb = client();
  const clients = [observer, editorDb, arrivalDb, otherDb];
  const fixtures: Array<{ talent: string; request: string; user: string; number: string }> = [];
  const pending: Promise<any>[] = [];
  const releases: Array<() => void> = [];
  let actor: any;
  let phase = 'preflight';
  const evidence = {
    prefix, database: '', role: '', lockWaits: [] as string[], http: {} as Record<string, number>,
    databaseConflicts: [] as Array<{ phase: string; action: string; code: string; sqlState?: string }>,
    cleanup: { deleted: {} as Record<string, number>, remaining: {} as Record<string, number> },
  };

  function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  }
  let holdArrival: any;
  let holdEdit: any;
  arrivalDb.$use(async (params: any, next: any) => {
    let result;
    try {
      result = await next(params);
    } catch (error) {
      evidence.databaseConflicts.push({ phase, action: params.action, code: error?.code,
        sqlState: typeof error?.meta?.code === 'string' ? error.meta.code : undefined });
      throw error;
    }
    if (holdArrival && params.model === 'TalentCandidate' && params.action === 'updateMany'
      && params.args.where.id === holdArrival.id) {
      const hold = holdArrival; holdArrival = undefined;
      hold.entered.release(); await hold.resume.promise;
    }
    return result;
  });
  editorDb.$use(async (params: any, next: any) => {
    const result = await next(params);
    if (holdEdit && params.model === 'TalentCandidate' && params.action === 'findFirst'
      && params.args.where.id === holdEdit.id) {
      const hold = holdEdit; holdEdit = undefined;
      hold.entered.release(); await hold.resume.promise;
    }
    return result;
  });
  function hold(id: string) {
    const value = { id, entered: gate(), resume: gate() };
    releases.push(value.resume.release);
    return value;
  }
  function track(promise: Promise<any>): Promise<any> {
    const settled = promise.then(value => ({ value }), error => ({ error }));
    pending.push(settled);
    return settled;
  }
  async function waitEntered(entered: Promise<void>, operation: Promise<any>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([entered, operation.then(() => { throw new Error('Operation ended before barrier'); }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Barrier timed out')), 3000); })]);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function waitForLock(name: string) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const rows = await observer.$queryRawUnsafe(
        'SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = $2', name, 'Lock');
      if (rows.length) { evidence.lockWaits.push(phase); return; }
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error('Expected database row-lock wait');
  }
  const date = shanghaiBusinessDate();
  async function createCase() {
    const f = { talent: randomUUID(), request: randomUUID(), user: randomUUID(), number: `AT${randomUUID().slice(0, 12)}` };
    await observer.$transaction(async (tx: any) => {
      await tx.user.create({ data: { id: f.user, name: `${prefix} employee`, employeeNo: f.number,
        sysRole: 'employee', accountType: 'employee', status: 'pending_entry' } });
      await tx.talentCandidate.create({ data: { id: f.talent, name: `${prefix} talent`, phone: f.number,
        sourceChannel: 'other', status: 'interviewing', note: 'Original', expectSalaryMin: 10,
        expectSalaryMax: 20, createdById: actor.id } });
      await tx.employeeDataChangeRequest.create({ data: { id: f.request, userId: f.user,
        employeeNo: f.number, employeeName: `${prefix} employee`, sourceType: 'preview_fixture', sourceSystem: prefix,
        intakeType: 'new_hire', onboardingStatus: 'pending_entry', requiresArrivalConfirmation: true,
        talentCandidateId: f.talent, profileReviewStatus: 'approved', proposedValue: {}, createdById: actor.id } });
      await tx.employmentRecord.create({ data: { userId: f.user, employeeNo: f.number,
        effectiveFrom: date, entryDate: date, company: 'fuede', employeeStatus: 'active',
        changeType: 'onboarding', sourceType: 'preview_fixture', sourceRequestId: f.request } });
      await tx.employeeNumberAssignment.create({ data: { userId: f.user, employeeNo: f.number,
        status: 'reserved', effectiveFrom: date, sourceRequestId: f.request } });
    });
    fixtures.push(f);
    return f;
  }
  try {
    const [db] = await observer.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(db.db, 'hrm_preview'); assert.equal(db.role, 'hrm_preview');
    evidence.database = db.db; evidence.role = db.role;
    assert.ok(await observer.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }));
    await editorDb.$queryRawUnsafe("SELECT set_config('application_name', $1, false)", `${prefix}_editor`);
    await arrivalDb.$queryRawUnsafe("SELECT set_config('application_name', $1, false)", `${prefix}_arrival`);
    await otherDb.$queryRawUnsafe("SELECT set_config('application_name', $1, false)", `${prefix}_other`);
    actor = await observer.user.create({ data: { name: `${prefix} HR`, employeeNo: `${prefix}_HR`,
      accountType: 'service', status: 'active', sysRole: 'hr_user',
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'] } });
    const editor = new TalentsService(editorDb);
    const other = new TalentsService(otherDb);
    const arrival = new EmployeeOnboardingService(arrivalDb, new EmployeeNumberService(),
      new EmployeeIdentityMatchService(arrivalDb, new ConfigService()), new EmployeeEffectiveDateService(arrivalDb));
    const confirm = (f: any) => arrival.confirmArrival(f.request, { requestVersion: 1, arrivalDate: date.toISOString().slice(0, 10) }, actor);
    const read = (f: any) => observer.talentCandidate.findUniqueOrThrow({ where: { id: f.talent } });

    phase = 'arrival-first';
    const first = await createCase();
    const arrivalGate = hold(first.talent); holdArrival = arrivalGate;
    const arrivalResult = track(confirm(first));
    await waitEntered(arrivalGate.entered.promise, arrivalResult);
    const stale = track(editor.update(first.talent, { status: 'contacted', note: 'Stale edit' }, actor));
    await waitForLock(`${prefix}_editor`);
    arrivalGate.resume.release();
    assert.equal((await arrivalResult).error, undefined);
    assert.equal((await stale).error?.getStatus(), 409);
    const hired = await read(first);
    assert.equal(hired.status, 'hired'); assert.equal(hired.convertedUserId, first.user);
    assert.equal(hired.note, 'Original'); assert.ok(hired.convertedAt);
    assert.equal((await observer.user.findUniqueOrThrow({ where: { id: first.user } })).status, 'active');
    await editor.update(first.talent, { status: 'hired', note: 'Reloaded edit' }, actor);
    await editor.update(first.talent, { appliedPosition: 'Synthetic position' }, actor);
    const reloaded = await read(first);
    assert.equal(reloaded.note, 'Reloaded edit'); assert.equal(reloaded.status, 'hired');
    assert.equal(reloaded.convertedUserId, first.user);
    assert.equal(reloaded.convertedAt.getTime(), hired.convertedAt.getTime());

    phase = 'http-stale-edit-reload';
    const { JwtService } = require('@nestjs/jwt');
    // The token stays inside this subprocess and is never returned or logged.
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: actor.id,
      employeeNo: actor.employeeNo, sysRole: actor.sysRole }, { expiresIn: '5m' });
    const endpoint = `http://127.0.0.1:3000/api/v1/talents/${first.talent}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const rejected = await fetch(endpoint, { method: 'PATCH', headers,
      body: JSON.stringify({ status: 'contacted', note: 'Stale HTTP edit' }), signal: AbortSignal.timeout(5000) });
    evidence.http.staleEdit = rejected.status;
    assert.equal(rejected.status, 409);
    const rejection = await rejected.json() as { message: string };
    assert.ok(rejection.message.includes('\u5237\u65b0'));
    const afterRejection = await read(first);
    assert.equal(afterRejection.note, 'Reloaded edit'); assert.equal(afterRejection.status, 'hired');
    const detail = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
    evidence.http.reload = detail.status; assert.equal(detail.status, 200);
    const current = await detail.json() as { data: { status: string } };
    assert.equal(current.data.status, 'hired');
    const saved = await fetch(endpoint, { method: 'PATCH', headers,
      body: JSON.stringify({ status: current.data.status, note: 'Reloaded HTTP edit' }), signal: AbortSignal.timeout(5000) });
    evidence.http.allowedEdit = saved.status; assert.equal(saved.status, 200);
    await saved.json();
    const afterHttp = await read(first);
    assert.equal(afterHttp.note, 'Reloaded HTTP edit'); assert.equal(afterHttp.status, 'hired');
    assert.equal(afterHttp.convertedUserId, first.user);
    assert.equal(afterHttp.convertedAt.getTime(), hired.convertedAt.getTime());

    phase = 'editor-first';
    const second = await createCase();
    const editGate = hold(second.talent); holdEdit = editGate;
    const editResult = track(editor.update(second.talent, { status: 'contacted', note: 'Earlier edit' }, actor));
    await waitEntered(editGate.entered.promise, editResult);
    const followingArrival = track(confirm(second));
    await waitForLock(`${prefix}_arrival`);
    editGate.resume.release();
    assert.equal((await editResult).error, undefined);
    const following = await followingArrival;
    if (following.error) {
      assert.equal(following.error.getStatus(), 409);
      phase = 'editor-first-retry';
      await confirm(second);
    }
    const final = await read(second);
    assert.equal(final.status, 'hired'); assert.equal(final.convertedUserId, second.user);
    assert.equal(final.note, 'Earlier edit');
    assert.equal(await observer.auditLog.count({ where: { entityId: second.request, action: 'confirm_employee_arrival' } }), 1);

    phase = 'same-talent-partial-edits';
    const third = await createCase();
    const independent = await createCase();
    const salaryGate = hold(third.talent); holdEdit = salaryGate;
    const lowerMax = track(editor.update(third.talent, { expectSalaryMax: 15 }, actor));
    await waitEntered(salaryGate.entered.promise, lowerMax);
    // A different talent remains writable while the first row is locked.
    await other.update(independent.talent, { note: 'Independent edit' }, actor);
    const raiseMin = track(other.update(third.talent, { expectSalaryMin: 18 }, actor));
    await waitForLock(`${prefix}_other`);
    salaryGate.resume.release();
    assert.equal((await lowerMax).error, undefined);
    assert.equal((await raiseMin).error?.getStatus(), 400);
    const salary = await read(third);
    assert.equal(salary.expectSalaryMin, 10); assert.equal(salary.expectSalaryMax, 15);
    return { ok: true, evidence,
      cases: ['arrival-first-reload', 'editor-first-retry', 'same-talent-partial-edits', 'independent-talent', 'http-stale-edit-reload'] };
  } catch (error) {
    return { ok: false, phase, evidence, errorKind: error instanceof Error ? error.name : 'unknown',
      businessMessage: typeof error?.getStatus === 'function' ? error.message : undefined };
  } finally {
    releases.forEach(release => release());
    await Promise.all(pending);
    try {
      if (actor) {
        const requests = fixtures.map(f => f.request);
        const talents = fixtures.map(f => f.talent);
        const users = [...fixtures.map(f => f.user), actor.id];
        await observer.$transaction(async (tx: any) => {
          const owned = await tx.user.findMany({ where: { id: { in: users } }, select: { name: true } });
          assert.equal(owned.length, users.length);
          assert.ok(owned.every((user: any) => user.name.startsWith(`${prefix} `)));
          const deleted = evidence.cleanup.deleted;
          deleted.auditLogs = (await tx.auditLog.deleteMany({ where: { userId: actor.id, entityId: { in: requests } } })).count;
          deleted.numberAssignments = (await tx.employeeNumberAssignment.deleteMany({ where: { sourceRequestId: { in: requests }, userId: { in: users } } })).count;
          deleted.employments = (await tx.employmentRecord.deleteMany({ where: { sourceRequestId: { in: requests }, userId: { in: users } } })).count;
          deleted.requests = (await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests }, sourceSystem: prefix } })).count;
          deleted.talents = (await tx.talentCandidate.deleteMany({ where: { id: { in: talents }, createdById: actor.id } })).count;
          deleted.users = (await tx.user.deleteMany({ where: { id: { in: users }, name: { startsWith: `${prefix} ` } } })).count;
          evidence.cleanup.remaining = {
            users: await tx.user.count({ where: { id: { in: users } } }),
            talents: await tx.talentCandidate.count({ where: { id: { in: talents } } }),
            requests: await tx.employeeDataChangeRequest.count({ where: { id: { in: requests } } }),
            employments: await tx.employmentRecord.count({ where: { sourceRequestId: { in: requests } } }),
            numberAssignments: await tx.employeeNumberAssignment.count({ where: { sourceRequestId: { in: requests } } }),
            auditLogs: await tx.auditLog.count({ where: { entityId: { in: requests } } }),
          };
          assert.ok(Object.values(evidence.cleanup.remaining).every(count => count === 0));
        });
      }
    } finally {
      await Promise.all(clients.map(db => db.$disconnect()));
    }
  }
}

describe('Audit #13: real preview database concurrency', () => {
  it('preserves arrival linkage and serializes same-talent validation with isolated fictional fixtures', () => {
    expect(process.env.HRM_AUDIT_TALENT_INTEGRATION).toBe('1');
    const [container] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.Config.Labels['com.docker.compose.service']).toBe('api');
    expect(container.State.Running).toBe(true);
    let output: string;
    try {
      output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
        encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'],
        input: `(${runInPreview.toString()})().then(result => process.stdout.write(JSON.stringify(result)))
          .catch(() => { process.stdout.write(JSON.stringify({ ok: false, phase: 'setup-or-cleanup' })); process.exitCode = 1; });`,
      });
    } catch {
      throw new Error('Preview concurrency subprocess failed; output withheld to protect environment credentials');
    }
    const result = JSON.parse(output);
    console.info('Audit talent concurrency evidence:', JSON.stringify(result));
    expect(result).toMatchObject({ ok: true,
      cases: ['arrival-first-reload', 'editor-first-retry', 'same-talent-partial-edits', 'independent-talent', 'http-stale-edit-reload'],
      evidence: { database: 'hrm_preview', role: 'hrm_preview',
        lockWaits: ['arrival-first', 'editor-first', 'same-talent-partial-edits'],
        http: { staleEdit: 409, reload: 200, allowedEdit: 200 },
        cleanup: { deleted: { users: 5, talents: 4, requests: 4, employments: 4, numberAssignments: 4, auditLogs: 4 },
          remaining: { users: 0, talents: 0, requests: 0, employments: 0, numberAssignments: 0, auditLogs: 0 } } },
    });
  });
});
