import { execFileSync } from 'node:child_process';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { TalentWorkbenchService } = require('./dist/src/talent-pool/talent-workbench.service');
  const db = new PrismaClient(), service = new TalentWorkbenchService(db);
  const prefix = `RWPG_${randomUUID().slice(0, 8)}`;
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const candidates: string[] = [], applications: string[] = [], invitations: string[] = [], requests: string[] = [];
  const proof: string[] = [], epoch = new Date('2000-01-01T00:00:00Z');
  const now = Date.now(), future = new Date(now + 3600000), past = new Date(now - 7200000);
  const actor = (id: string) => ({ id, sysRole: 'system_admin', canViewAll: true });
  const group = (result: any, key: string) => result.groups.find((row: any) => row.key === key);
  const project = (id = users[0]) => service.getWorkbench(actor(id));
  async function candidate(data: any = {}) {
    const id = randomUUID(); candidates.push(id);
    return db.talentCandidate.create({ data: { id, name: `${prefix}_${candidates.length}`, phone: `${prefix}_${candidates.length}`,
      sourceChannel: 'other', ownerId: users[1], createdById: users[0], createdAt: epoch, ...data } });
  }
  async function application(candidateId: string, data: any = {}) {
    const id = randomUUID(); applications.push(id);
    return db.talentApplication.create({ data: { id, candidateId, positionName: `${prefix}_position`,
      ownerId: users[0], createdById: users[0], stage: 'interviewing', createdAt: epoch, ...data } });
  }
  async function invitation(candidateId: string, applicationId: string | null, data: any = {}, participantId = users[2]) {
    const id = randomUUID(); invitations.push(id);
    return db.talentInterview.create({ data: { id, candidateId, applicationId, candidateNameSnapshot: `${prefix}_snapshot`,
      startsAt: past, endsAt: new Date(past.getTime() + 3600000), invitationText: 'Synthetic invitation', createdById: users[0],
      participants: { create: [{ userId: participantId, userNameSnapshot: `${prefix}_participant` }] }, ...data } });
  }
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional, true);
    for (const [index, id] of users.entries()) await db.user.create({ data: { id, name: `${prefix}_${index}`,
      employeeNo: `${prefix}_${index}`, accountType: index === 3 ? 'employee' : 'service', status: 'active',
      sysRole: index < 2 ? 'hr' : 'employee' } });
    const followUps: string[] = [];
    for (let index = 0; index < 7; index++) {
      const row = await candidate({ ownerId: index === 6 ? null : users[0] }); followUps.push(row.id);
      if (index === 0) {
        await db.talentFollowUp.create({ data: { candidateId: row.id, occurredAt: epoch, channel: 'phone', summary: 'Synthetic plan',
          planStatus: 'pending', nextFollowUpAt: new Date('2035-01-01'), createdById: users[0] } });
        await db.talentFollowUp.create({ data: { candidateId: row.id, occurredAt: new Date('2000-01-02'), channel: 'phone',
          summary: 'Synthetic supplemental record', planStatus: 'none', createdById: users[0] } });
      }
    }
    await candidate(); // Owned by someone else, despite being created by the current HR.
    const closed = await candidate({ ownerId: users[0] });
    await db.talentFollowUp.create({ data: { candidateId: closed.id, occurredAt: epoch, channel: 'phone',
      summary: 'Synthetic closed plan', planStatus: 'completed', nextFollowUpAt: new Date('2035-01-01'), createdById: users[0] } });
    const followGroup = group(await project(), 'follow_up');
    assert.equal(followGroup.total, 7); assert.equal(followGroup.items.length, 5);
    assert.deepEqual(followGroup.items.map((row: any) => row.id), [...followUps].sort().slice(0, 5));
    assert.equal(followGroup.items.every((row: any) => row.subtitle === '待跟进' && !('applicationId' in row)), true);
    proof.push('first-contact-future-plan-supplement-and-owner-fallback', 'follow-up-real-count-and-stable-cap');

    const source = await candidate(), app = await application(source.id);
    const futureInvitations: string[] = [];
    for (let index = 0; index < 7; index++) futureInvitations.push((await invitation(source.id, app.id,
      { startsAt: future, endsAt: new Date(future.getTime() + 3600000) })).id);
    const ended = await invitation(source.id, app.id);
    await db.talentInterviewFeedback.create({ data: { interviewId: ended.id, userId: users[2], status: 'draft' } });
    const completed = await invitation(source.id, app.id, { status: 'completed' });
    const completedEarly = await invitation(source.id, null, { status: 'completed', startsAt: future,
      endsAt: new Date(future.getTime() + 3600000) });
    await db.talentInterviewFeedback.create({ data: { interviewId: completedEarly.id, userId: users[1], status: 'submitted', summary: 'Synthetic other feedback' } });
    const submitted = await invitation(source.id, app.id, { status: 'completed' });
    await db.talentInterviewFeedback.create({ data: { interviewId: submitted.id, userId: users[2], status: 'submitted' } });
    await invitation(source.id, app.id, { status: 'cancelled' });
    const withdrawn = await application(source.id, { stage: 'withdrawn' });
    await invitation(source.id, withdrawn.id, { status: 'completed' });
    const removed = await invitation(source.id, app.id, { status: 'completed' });
    await db.talentInterviewParticipant.deleteMany({ where: { interviewId: removed.id } });
    await invitation(source.id, app.id, { status: 'completed' }, users[1]);
    const employee = await project(users[2]);
    assert.deepEqual(employee.groups.map((row: any) => row.key), ['interview', 'feedback']);
    assert.equal(group(employee, 'interview').total, 7);
    assert.deepEqual(group(employee, 'interview').items.map((row: any) => row.id), [...futureInvitations].sort().slice(0, 5));
    assert.equal(group(employee, 'feedback').total, 3);
    assert.deepEqual(group(employee, 'feedback').items.map((row: any) => row.id).sort(), [ended.id, completed.id, completedEarly.id].sort());
    for (const queue of employee.groups) for (const row of queue.items) {
      assert.deepEqual(Object.keys(row).sort(), ['date', 'id', 'subtitle', 'title']);
      assert.equal(row.title, `${prefix}_snapshot`);
    }
    proof.push('future-attendance-not-feedback-completed-still-feedback', 'own-submitted-withdrawn-cancelled-and-current-membership', 'interview-only-minimal-projection');
    const feedbackRows = [ended.id, completed.id, completedEarly.id];
    for (let index = 0; index < 4; index++) feedbackRows.push((await invitation(source.id, app.id, { status: 'completed' })).id);
    const feedback = group(await project(users[2]), 'feedback');
    assert.equal(feedback.total, 7); assert.equal(feedback.items.length, 5);
    assert.deepEqual(feedback.items.map((row: any) => row.id), feedbackRows.filter(id => id !== completedEarly.id).sort().slice(0, 5));
    proof.push('attendance-and-feedback-real-count-stable-cap');

    const hiringRows: string[] = [], onboardingRows: string[] = [];
    for (let index = 0; index < 7; index++) {
      hiringRows.push((await application(source.id, { stage: 'hiring_review', hiringRequestedById: users[1], hiringRequestedAt: epoch })).id);
      onboardingRows.push((await application(source.id, { stage: 'accepted', expectedEntryDate: new Date('2035-01-01') })).id);
    }
    await application(source.id, { stage: 'hiring_review', hiringRequestedById: users[0], hiringRequestedAt: epoch });
    await application(source.id, { stage: 'accepted', ownerId: users[1] });
    const deletedSource = await candidate({ deletedAt: new Date() });
    await application(deletedSource.id, { stage: 'accepted' });
    const blockedSource = await candidate();
    await application(blockedSource.id, { stage: 'accepted' });
    const otherApplication = await application(blockedSource.id, { stage: 'onboarding', ownerId: users[1] });
    const requestId = randomUUID(); requests.push(requestId);
    await db.employeeDataChangeRequest.create({ data: { id: requestId, employeeName: prefix, createdById: users[0],
      sourceType: 'onboarding_intake', talentCandidateId: blockedSource.id, talentApplicationId: otherApplication.id,
      onboardingStatus: 'draft', proposedValue: {} } });
    // Compare the shared queue and its source in one snapshot while other preview fixtures change.
    const queues = await db.$transaction(async (tx: any) => {
      const snapshotService = new TalentWorkbenchService({ $transaction: (read: any) => read(tx) });
      const result = await snapshotService.getWorkbench(actor(users[0]));
      const hiring = group(result, 'hiring_review');
      const where = { stage: 'hiring_review', hiringRequestedById: { not: users[0] } };
      const total = await tx.talentApplication.count({ where });
      const expected = await tx.talentApplication.findMany({ where, take: 5,
        orderBy: [{ hiringRequestedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      assert.equal(await tx.talentApplication.count({ where: { ...where, id: { in: hiringRows } } }), 7);
      assert.equal(hiring.total, total); assert.equal(hiring.items.length, 5);
      assert.deepEqual(hiring.items.map((row: any) => row.id), expected.map((row: any) => row.id));
      return result;
    }, { isolationLevel: 'RepeatableRead' });
    const onboarding = group(queues, 'onboarding');
    assert.equal(onboarding.total, 7); assert.equal(onboarding.items.length, 5);
    assert.deepEqual(onboarding.items.map((row: any) => row.id), [...onboardingRows].sort().slice(0, 5));
    assert.equal(onboarding.items.every((row: any) => row.applicationId === row.id && row.candidateId === source.id), true);
    proof.push('shared-hiring-excludes-self-and-caps-count', 'accepted-application-owner-not-talent-owner-exact-link', 'deleted-and-other-application-active-intake-excluded');

    const linkedSource = await candidate({ convertedUserId: users[3] });
    const linkedApplication = await application(linkedSource.id, { stage: 'accepted' });
    assert.equal(group(await project(), 'onboarding').total, 7, 'Current employee must not become an actionable onboarding reminder');
    await db.user.update({ where: { id: users[3] }, data: { status: 'resigned' } });
    assert.equal(group(await project(), 'onboarding').total, 8, 'Eligible reentry must remain visible');
    await db.user.update({ where: { id: users[3] }, data: { status: 'pending_entry', employeeNo: null } });
    assert.equal(group(await project(), 'onboarding').total, 8, 'Pending identity must not become an admission whitelist exclusion');
    await db.talentCandidate.update({ where: { id: linkedSource.id }, data: { convertedUserId: null } });
    const cancelledRequestId = randomUUID(); requests.push(cancelledRequestId);
    await db.employeeDataChangeRequest.create({ data: { id: cancelledRequestId, userId: users[3], employeeName: prefix,
      createdById: users[0], sourceType: 'manual_employee_create', talentCandidateId: linkedSource.id,
      talentApplicationId: linkedApplication.id, intakeType: 'new_hire', requiresArrivalConfirmation: true,
      profileReviewStatus: 'approved', recordStatus: 'cancelled', onboardingStatus: 'cancelled', cancelledAt: new Date(), proposedValue: {} } });
    assert.equal(group(await project(), 'onboarding').total, 8, 'Cancelled first-hire pending identity must retain its recovery reminder');
    proof.push('linked-current-excluded-pending-recovery-and-history-retained');

    await db.user.update({ where: { id: users[0] }, data: { sysRole: 'system_admin' } });
    assert.equal((await project()).groups.some((row: any) => row.key === 'hiring_review'), false);
    await db.user.update({ where: { id: users[2] }, data: { isAssessorOnly: true, sysRole: 'hr' } });
    await assert.rejects(() => project(users[2]), (error: any) => error.getStatus() === 403);
    proof.push('db-current-admin-no-implicit-confirm-assessor-hr-denied');
    return { ok: true, database: 'hrm_preview', scenarios: proof, externalCalls: 0 };
  } finally {
    try {
      await db.$transaction(async (tx: any) => {
        const owned = await tx.talentCandidate.findMany({ where: { id: { in: candidates } }, select: { name: true } });
        if (owned.some((row: any) => !row.name.startsWith(prefix))) throw Error('Fixture ownership mismatch');
        await tx.employeeDataChangeRequest.deleteMany({ where: { id: { in: requests }, createdById: users[0] } });
        await tx.talentInterviewFeedbackEvent.deleteMany({ where: { interviewId: { in: invitations } } });
        await tx.talentInterviewFeedback.deleteMany({ where: { interviewId: { in: invitations } } });
        await tx.talentInterviewParticipant.deleteMany({ where: { interviewId: { in: invitations } } });
        await tx.talentInterview.deleteMany({ where: { id: { in: invitations }, candidateId: { in: candidates } } });
        await tx.talentApplication.deleteMany({ where: { id: { in: applications }, candidateId: { in: candidates } } });
        await tx.talentFollowUp.deleteMany({ where: { candidateId: { in: candidates } } });
        await tx.talentCandidate.deleteMany({ where: { id: { in: candidates }, name: { startsWith: prefix } } });
        await tx.user.deleteMany({ where: { id: { in: users }, name: { startsWith: prefix } } });
      });
    } finally { await db.$disconnect(); }
  }
}

it('projects real recruitment queues from the guarded preview PostgreSQL and compiled service', () => {
  expect(process.env.HRM_RECRUITMENT_PREVIEW_INTEGRATION).toBe('1');
  let output: string;
  try {
    output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
      input: `(${inPreview.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({ok:false,error:e.name,code:e.code,message:e.name==='AssertionError'?e.message:undefined}));process.exitCode=1});`,
    });
  } catch (error: any) {
    throw new Error(`Workbench integration failed: ${error.stdout?.toString().slice(0, 1500) || 'subprocess'}`);
  }
  const result = JSON.parse(output);
  expect(result).toMatchObject({ ok: true, database: 'hrm_preview', externalCalls: 0 });
  expect(result.scenarios).toHaveLength(11);
  console.info('Workbench PostgreSQL evidence:', JSON.stringify(result));
});
