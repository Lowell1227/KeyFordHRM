import { execFileSync } from 'node:child_process';

async function runInPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { EmployeeDataReviewsService } = require('./dist/src/employee-archives/employee-data-reviews.service');
  const { shanghaiBusinessDate } = require('./dist/src/employee-archives/employment-timeline');
  const db = new PrismaClient(), observer = new PrismaClient();
  const prefix = `APC_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const fixtures: Array<{ id: string; number: string }> = [];
  const conflicts = new Map<string, { remaining: number; cancelled: boolean; reads: number; codes: string[] }>();
  const evidence: any = { cases: [], remaining: {} };
  let actor: any, dept: any, position: any, phase = 'preflight';
  db.$use(async (params: any, next: any) => {
    const tracked = conflicts.get(params.args?.where?.id);
    try {
      const result = await next(params);
      if (tracked && params.model === 'EmployeeDataChangeRequest' && params.action === 'findUnique') {
        tracked.reads++;
        if (tracked.remaining > 0) {
          tracked.remaining--;
          // A second real connection commits after the approval's Serializable read.
          // Its next conditional write must conflict in PostgreSQL, not in a mock.
          await observer.employeeDataChangeRequest.update({ where: { id: result.id },
            data: tracked.cancelled ? { cancelledAt: new Date() } : { updatedAt: new Date() } });
        }
      }
      return result;
    } catch (error) {
      if (tracked && typeof error?.code === 'string') tracked.codes.push(error.code);
      throw error;
    }
  });
  try {
    const [identity] = await observer.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    const marker = await observer.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } });
    assert.equal(marker?.value?.fictional, true);
    dept = await observer.department.create({ data: { name: prefix, company: 'fuede' } });
    position = await observer.position.create({ data: { code: prefix, name: prefix + ' position', isActive: true } });
    actor = await observer.user.create({ data: { name: `${prefix} HR`, employeeNo: `${prefix}_HR`,
      accountType: 'service', status: 'active', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] } });
    const service = new EmployeeDataReviewsService(db);
    const today = shanghaiBusinessDate().toISOString().slice(0, 10);
    for (const [label, failures, cancelled] of [['transient', 1, false], ['exhausted', 3, false], ['cancelled', 1, true]] as const) {
      phase = label;
      const f = { id: randomUUID(), number: `${prefix}_${fixtures.length}` };
      const employee = { name: `${prefix} employee ${fixtures.length}`, employeeNo: f.number,
        company: 'fuede', deptId: dept.id, employmentType: 'full_time', employeeStatus: 'active',
        positionId: position.id, position: position.name,
        entryDate: today, effectiveFrom: today };
      await observer.employeeDataChangeRequest.create({ data: { id: f.id, employeeName: employee.name,
        employeeNo: f.number, sourceType: 'manual_employee_create', sourceSystem: prefix,
        intakeType: 'new_hire', onboardingStatus: 'submitted', requiresArrivalConfirmation: true,
        profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', recordStatus: 'submitted',
        baseValue: {}, proposedValue: { employee, profile: {}, contracts: [], performance: {} }, createdById: actor.id } });
      fixtures.push(f);
      await observer.employeeNumberAssignment.create({ data: { employeeNo: f.number,
        sourceRequestId: f.id, status: 'reserved' } });
      const tracked = { remaining: failures, cancelled, reads: 0, codes: [] as string[] };
      conflicts.set(f.id, tracked);
      const result = await service.approveBatch({ requestIds: [f.id], scopes: ['profile'] }, actor);
      const request = await observer.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: f.id } });
      const users = await observer.user.findMany({ where: { employeeNo: f.number } });
      const employments = await observer.employmentRecord.count({ where: { sourceRequestId: f.id } });
      const audits = await observer.auditLog.count({ where: { entityId: f.id, action: 'approve_employee_data_change' } });
      assert.equal(tracked.codes.length, failures);
      assert.ok(tracked.codes.every(code => code === 'P2034'));
      if (label === 'transient') {
        assert.deepEqual(result, { succeeded: [{ requestId: f.id, scopes: ['profile'] }], failed: [] });
        assert.equal(tracked.reads, 2); assert.equal(users.length, 1);
        assert.equal(users[0].status, 'pending_entry'); assert.equal(employments, 1); assert.equal(audits, 1);
        assert.equal(request.profileReviewStatus, 'approved');
        assert.equal(request.arrivalConfirmedAt, null); assert.equal(request.appliedAt, null);
      } else {
        assert.equal(result.succeeded.length, 0); assert.equal(result.failed.length, 1);
        assert.equal(tracked.reads, label === 'exhausted' ? 3 : 2);
        assert.ok(result.failed[0].reason.includes(label === 'exhausted' ? '重试' : '取消'));
        assert.ok(!/Prisma|SQL|P2034|Invocation/.test(result.failed[0].reason));
        assert.equal(request.profileReviewStatus, 'pending'); assert.equal(request.userId, null);
        assert.equal(users.length, 0); assert.equal(employments, 0); assert.equal(audits, 0);
      }
      evidence.cases.push({ label, attempts: tracked.reads, realConflicts: tracked.codes.length,
        users: users.length, employments, audits, profileStatus: request.profileReviewStatus,
        onboardingStatus: request.onboardingStatus });
    }
    return { ok: true, evidence };
  } catch (error) {
    return { ok: false, phase, kind: error?.name ?? 'unknown', evidence };
  } finally {
    try {
      if (actor && dept) {
        const ids = fixtures.map(f => f.id), numbers = fixtures.map(f => f.number);
        const users = await observer.user.findMany({ where: { employeeNo: { in: numbers } }, select: { id: true, name: true } });
        assert.ok(users.every((u: any) => u.name.startsWith(`${prefix} employee `)));
        const userIds = users.map((u: any) => u.id);
        await observer.$transaction(async (tx: any) => {
          assert.equal(await tx.employeeDataChangeRequest.count({ where: { id: { in: ids }, sourceSystem: prefix } }), ids.length);
          await tx.auditLog.deleteMany({ where: { entityId: { in: ids }, userId: actor.id } });
          await tx.employeeNumberAssignment.deleteMany({ where: { sourceRequestId: { in: ids }, employeeNo: { in: numbers } } });
          await tx.employmentRecord.deleteMany({ where: { sourceRequestId: { in: ids }, userId: { in: userIds } } });
          await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: ids }, sourceSystem: prefix } });
          await tx.user.deleteMany({ where: { id: { in: userIds }, name: { startsWith: `${prefix} employee ` } } });
          await tx.user.delete({ where: { id: actor.id, employeeNo: `${prefix}_HR` } });
          await tx.position.delete({ where: { id: position.id, code: prefix } });
          await tx.department.delete({ where: { id: dept.id, name: prefix } });
        });
        evidence.remaining = { users: await observer.user.count({ where: { id: { in: [...userIds, actor.id] } } }),
          requests: await observer.employeeDataChangeRequest.count({ where: { id: { in: ids } } }),
          employments: await observer.employmentRecord.count({ where: { sourceRequestId: { in: ids } } }),
          numbers: await observer.employeeNumberAssignment.count({ where: { sourceRequestId: { in: ids } } }),
          audits: await observer.auditLog.count({ where: { entityId: { in: ids } } }) };
        assert.ok(Object.values(evidence.remaining).every(count => count === 0));
      }
    } finally { await Promise.all([db.$disconnect(), observer.$disconnect()]); }
  }
}

describe('approval conflict: isolated real PostgreSQL', () => {
  it('retries genuine rollback, stops at the bound, and respects cancellation on reread', () => {
    expect(process.env.HRM_AUDIT_APPROVAL_INTEGRATION).toBe('1');
    const [container] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1'], { encoding: 'utf8', stdio: 'pipe' }));
    expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
    expect(container.Config.Labels['com.docker.compose.service']).toBe('api');
    expect(container.State.Running).toBe(true);
    let output: string;
    try {
      output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'], input: `(${runInPreview.toString()})().then(r=>process.stdout.write(JSON.stringify(r)))
          .catch(()=>{process.stdout.write(JSON.stringify({ok:false,phase:'setup-or-cleanup'}));process.exitCode=1;});` });
    } catch { throw Error('Isolated approval verification failed; output withheld'); }
    const result = JSON.parse(output);
    console.info('Isolated approval evidence:', JSON.stringify(result));
    expect(result).toMatchObject({ ok: true, evidence: { cases: [
      { label: 'transient', attempts: 2, realConflicts: 1, users: 1, employments: 1, audits: 1 },
      { label: 'exhausted', attempts: 3, realConflicts: 3, users: 0, employments: 0, audits: 0 },
      { label: 'cancelled', attempts: 2, realConflicts: 1, users: 0, employments: 0, audits: 0 },
    ], remaining: { users: 0, requests: 0, employments: 0, numbers: 0, audits: 0 } } });
  });
});
