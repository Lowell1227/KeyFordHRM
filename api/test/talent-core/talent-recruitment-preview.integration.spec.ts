import { execFileSync } from 'node:child_process';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { TalentRecruitmentService } = require('./dist/src/talent-pool/talent-recruitment.service');
  const { resolveTalentApplicationSource, syncTalentApplicationOnboarding } = require('./dist/src/employee-archives/employee-talent-source');
  const db = new PrismaClient(), other = new PrismaClient();
  const prefix = `RCPG_${randomUUID().slice(0, 8)}`, candidateId = randomUUID(), interviewId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const actor = (id: string) => ({ id });
  const service = new TalentRecruitmentService(db), parallel = new TalentRecruitmentService(other);
  const proof: string[] = [];
  let applicationId: string | undefined, inject = false;
  const failure = new Error('Synthetic event insert failure');
  db.$use((params: any, next: any) => {
    if (inject && params.model === 'TalentApplicationEvent' && params.action === 'create') throw failure;
    return next(params);
  });
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional, true);
    for (const [index, id] of ids.entries()) await db.user.create({ data: { id, name: `${prefix}_${index}`,
      employeeNo: `${prefix}_${index}`, accountType: 'service', status: 'active',
      sysRole: index === 0 ? 'hr' : index === 1 ? 'hr_user' : 'employee', hrCapabilities: index === 1 ? ['talent_hiring_confirm'] : [] } });
    await db.talentCandidate.create({ data: { id: candidateId, name: prefix, phone: prefix, sourceChannel: 'other', createdById: ids[0] } });
    let application = await service.create(candidateId, { positionName: prefix }, actor(ids[0]));
    applicationId = application.id;
    inject = true;
    await assert.rejects(() => service.act(applicationId, { expectedRevision: 0, action: 'start_interview' }, actor(ids[0])), e => e === failure);
    inject = false;
    assert.equal((await db.talentApplication.findUnique({ where: { id: applicationId } })).revision, 0);
    assert.equal(await db.talentApplicationEvent.count({ where: { applicationId } }), 1);
    proof.push('event-failure-rolls-back-application');
    const raced = await Promise.allSettled([
      service.act(applicationId, { expectedRevision: 0, action: 'start_interview' }, actor(ids[0])),
      parallel.act(applicationId, { expectedRevision: 0, action: 'reserve' }, actor(ids[0])),
    ]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(raced.find(r => r.status === 'rejected')!.reason.getStatus(), 409);
    application = await service.detail(applicationId, actor(ids[0]));
    assert.equal(application.revision, 1);
    if (application.stage === 'reserve') application = await service.act(applicationId, { expectedRevision: 1, action: 'start_interview' }, actor(ids[0]));
    proof.push('application-version-concurrency');
    await db.talentInterview.create({ data: { id: interviewId, candidateId, applicationId, candidateNameSnapshot: prefix,
      startsAt: new Date('2035-01-01'), endsAt: new Date('2035-01-01T01:00:00Z'), invitationText: 'Fictional invitation', createdById: ids[0],
      participants: { create: [{ userId: ids[2], userNameSnapshot: prefix }] } } });
    const feedbackRace = await Promise.allSettled([
      service.saveFeedback(interviewId, { interviewVersion: 1, expectedRevision: 0, summary: 'Synthetic A', submit: false }, actor(ids[2])),
      parallel.saveFeedback(interviewId, { interviewVersion: 1, expectedRevision: 0, summary: 'Synthetic B', submit: false }, actor(ids[2])),
    ]);
    assert.equal(feedbackRace.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(feedbackRace.find(r => r.status === 'rejected')!.reason.getStatus(), 409);
    const first = await service.saveFeedback(interviewId, { interviewVersion: 1, expectedRevision: 1, outcome: 'pass', summary: 'Synthetic first submission', submit: true }, actor(ids[2]));
    const returned = await service.returnFeedback(interviewId, ids[2], { interviewVersion: 1, expectedRevision: first.own.revision, note: 'Synthetic return reason' }, actor(ids[0]));
    const final = await service.saveFeedback(interviewId, { interviewVersion: 1, expectedRevision: returned.items[0].revision, outcome: 'pass', summary: 'Synthetic corrected submission', submit: true }, actor(ids[2]));
    assert.equal(final.own.history.length, 3);
    assert.equal(final.own.history[0].summary, 'Synthetic first submission');
    assert.equal(final.own.history[1].note, 'Synthetic return reason');
    await assert.rejects(() => service.feedback(interviewId, actor(ids[3])), e => e.getStatus() === 404);
    assert.equal((await service.feedback(interviewId, actor(ids[2]))).items.length, 1);
    proof.push('feedback-concurrency-and-immutable-history', 'outsider-and-own-feedback-isolation');
    application = await service.act(applicationId, { expectedRevision: application.revision, action: 'submit_hiring', note: 'Synthetic hiring request' }, actor(ids[0]));
    await assert.rejects(() => service.act(applicationId, { expectedRevision: application.revision, action: 'approve_hiring' }, actor(ids[0])), e => e.getStatus() === 403);
    assert.equal((await service.hiringReviews(actor(ids[1]))).some(r => r.id === applicationId), true);
    await assert.rejects(() => service.list(candidateId, actor(ids[1])), e => e.getStatus() === 403);
    await assert.rejects(() => service.feedback(interviewId, actor(ids[1])), e => e.getStatus() === 404);
    await assert.rejects(() => service.saveFeedback(interviewId, { interviewVersion: 1, expectedRevision: final.own.revision, outcome: 'pass', summary: 'Must lock', submit: false }, actor(ids[2])), e => e.getStatus() === 400);
    application = await service.act(applicationId, { expectedRevision: application.revision, action: 'approve_hiring' }, actor(ids[1]));
    application = await service.act(applicationId, { expectedRevision: application.revision, action: 'accept_offer' }, actor(ids[0]));
    proof.push('self-confirm-denied', 'narrow-hiring-permission', 'feedback-lock-after-hiring');
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
      assert.equal(await resolveTalentApplicationSource(tx, candidateId, applicationId), applicationId);
      const request = { id: randomUUID(), talentApplicationId: applicationId };
      for (const stage of ['onboarding', 'accepted', 'onboarding', 'hired']) await syncTalentApplicationOnboarding(tx, request, stage, ids[0]);
    });
    assert.equal((await db.talentApplication.findUnique({ where: { id: applicationId } })).stage, 'hired');
    proof.push('real-pg-onboarding-cancel-restore-arrival-transitions');
    return { ok: true, database: 'hrm_preview', scenarios: proof, externalCalls: 0 };
  } finally {
    inject = false;
    try {
      await db.$transaction(async tx => {
        const candidate = await tx.talentCandidate.findUnique({ where: { id: candidateId } });
        if (candidate && candidate.name !== prefix) throw Error('Fixture ownership mismatch');
        await tx.talentInterviewFeedbackEvent.deleteMany({ where: { interviewId } });
        await tx.talentInterviewFeedback.deleteMany({ where: { interviewId } });
        await tx.talentInterviewParticipant.deleteMany({ where: { interviewId } });
        await tx.talentInterview.deleteMany({ where: { id: interviewId, candidateId } });
        if (applicationId) await tx.talentApplicationEvent.deleteMany({ where: { applicationId } });
        if (applicationId) await tx.talentApplication.deleteMany({ where: { id: applicationId, candidateId } });
        await tx.talentCandidate.deleteMany({ where: { id: candidateId, name: prefix } });
        await tx.auditLog.deleteMany({ where: { userId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids }, name: { startsWith: prefix } } });
      });
    } finally { await db.$disconnect(); await other.$disconnect(); }
  }
}

it('verifies recruitment permissions, concurrency and rollback with real isolated PostgreSQL', () => {
  expect(process.env.HRM_RECRUITMENT_PREVIEW_INTEGRATION).toBe('1');
  let output: string;
  try { output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
    input: `(${inPreview.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({ok:false,error:e.name,code:e.code,message:e.name==='AssertionError'?e.message:undefined}));process.exitCode=1});`,
  }); } catch (error: any) { throw new Error(`Recruitment integration failed: ${error.stdout?.toString().slice(0, 1000) || 'subprocess'}`); }
  const result = JSON.parse(output);
  expect(result).toMatchObject({ ok: true, database: 'hrm_preview', externalCalls: 0 });
  expect(result.scenarios).toHaveLength(8);
  console.info('Recruitment PostgreSQL evidence:', JSON.stringify(result));
});
