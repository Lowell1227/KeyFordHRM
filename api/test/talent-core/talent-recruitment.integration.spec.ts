import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { TalentInterviewsService } from '@/talent-pool/talent-interviews.service';
import { TalentRecruitmentService } from '@/talent-pool/talent-recruitment.service';

const rollbackCases = [true, false].flatMap(linked => (['submit', 'return'] as const).flatMap(action =>
  ['talent_interview_feedback_events', ...(linked ? ['talent_application_events'] : []), 'audit_logs']
    .map(table => ({ linked, action, table }))));

describe('talent recruitment: disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let recruitment: TalentRecruitmentService;
  let interviews: TalentInterviewsService;
  let hr: AuthUser;
  let participant: AuthUser;
  let otherParticipant: AuthUser;
  let confirmer: AuthUser;
  let candidateSequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_talent_recruitment_test').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri();
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/hrm_talent_recruitment_test') {
      throw new Error('Disposable recruitment database must be loopback and test-owned');
    }
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60000,
      });
    } catch { throw new Error('Disposable recruitment schema initialization failed'); }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    recruitment = new TalentRecruitmentService(prisma);
    interviews = new TalentInterviewsService(prisma);
    const users = await Promise.all([
      { name: 'Synthetic recruitment HR', sysRole: 'hr' as const, status: 'active' as const },
      { name: 'Synthetic interviewer A', sysRole: 'employee' as const, status: 'probation' as const },
      { name: 'Synthetic interviewer B', sysRole: 'employee' as const, status: 'active' as const },
      { name: 'Synthetic hiring confirmer', sysRole: 'employee' as const, status: 'active' as const, hrCapabilities: ['talent_hiring_confirm'] },
    ].map(data => prisma.user.create({ data })));
    [hr, participant, otherParticipant, confirmer] = users.map(user => ({ id: user.id, name: user.name,
      sysRole: user.sysRole, deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: user.hrCapabilities }));
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function fixture(linked = true) {
    const candidate = await prisma.talentCandidate.create({ data: { name: 'Synthetic recruitment candidate',
      phone: String(17000000000 + ++candidateSequence), sourceChannel: 'referral', createdById: hr.id } });
    const application = linked ? await recruitment.create(candidate.id, { positionName: 'Synthetic role' }, hr) : null;
    const interview = await interviews.create({ candidateId: candidate.id, ...(application ? { applicationId: application.id } : {}),
      startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', invitationText: 'Synthetic interview',
      participantIds: [participant.id, otherParticipant.id] }, hr);
    return { candidate, application, interview };
  }

  const submission = { interviewVersion: 1, expectedRevision: 0, submit: true,
    outcome: 'pass' as const, summary: 'Synthetic first submitted feedback' };
  const returnInput = { interviewVersion: 1, expectedRevision: 1, note: 'Synthetic HR correction request' };

  it('serializes identical application creation intents, preserving events, legacy and independent applications', async () => {
    const { candidate } = await fixture(false);
    const intent = { requestId: randomUUID(), positionName: 'Synthetic repeatable position' };
    const rows = await Promise.all(Array.from({ length: 4 }, () => recruitment.create(candidate.id, intent, hr)));
    const id = rows[0].id;
    expect(rows.map(row => row.id)).toEqual([id, id, id, id]);
    expect(rows[0]).not.toHaveProperty('creationFingerprint');
    expect(rows[0]).not.toHaveProperty('requestId');
    expect(await prisma.talentApplicationEvent.count({ where: { applicationId: id, action: 'create' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'create_application' } })).toBe(1);
    await recruitment.update(id, { expectedRevision: 0, positionName: 'Updated position' }, hr);
    await expect(recruitment.create(candidate.id, intent, hr)).resolves.toMatchObject({ id, positionName: 'Updated position' });
    await expect(recruitment.create(candidate.id, { ...intent, recruitmentBatch: 'Other' }, hr)).rejects.toThrow(ConflictException);
    for (const input of [{ ...intent, requestId: randomUUID() }, { positionName: intent.positionName }, { positionName: intent.positionName }]) {
      await recruitment.create(candidate.id, input, hr);
    }
    expect(await prisma.talentApplication.count({ where: { candidateId: candidate.id } })).toBe(4);
    expect(await prisma.talentApplication.count({ where: { candidateId: candidate.id, requestId: null, creationFingerprint: null } })).toBe(2);
  });

  it('rejects a global application creation key raced between different candidates', async () => {
    const fixtures = [await fixture(false), await fixture(false)];
    const intent = { requestId: randomUUID(), positionName: 'Synthetic position' };
    const attempts = await Promise.allSettled(fixtures.map(({ candidate }) => recruitment.create(candidate.id, intent, hr)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    expect(await prisma.talentApplication.count({ where: { requestId: intent.requestId } })).toBe(1);
  });

  async function snapshot(interviewId: string, applicationId?: string) {
    return {
      feedback: await prisma.talentInterviewFeedback.findMany({ where: { interviewId }, orderBy: { userId: 'asc' } }),
      history: await prisma.talentInterviewFeedbackEvent.findMany({ where: { interviewId }, orderBy: { id: 'asc' } }),
      application: applicationId ? await prisma.talentApplication.findUnique({ where: { id: applicationId } }) : null,
      events: applicationId ? await prisma.talentApplicationEvent.findMany({ where: { applicationId }, orderBy: { id: 'asc' } }) : [],
      audits: await prisma.auditLog.findMany({ where: { entityType: 'talent_interview_feedback', entityId: interviewId }, orderBy: { id: 'asc' } }),
    };
  }

  it('serializes competing application transitions and commits exactly one event and audit', async () => {
    const { application } = await fixture();
    const id = application!.id;
    const baseline = await prisma.auditLog.count({ where: { entityId: id } });
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => recruitment.act(id,
      { expectedRevision: 0, action: 'start_interview' }, hr)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.talentApplication.findUnique({ where: { id } })).toMatchObject({ stage: 'interviewing', revision: 1 });
    expect(await prisma.talentApplicationEvent.count({ where: { applicationId: id, action: 'start_interview' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(baseline + 1);
  });

  it.each([true, false])('serializes simultaneous first feedback submissions (linked=%s)', async linked => {
    const { interview, application } = await fixture(linked);
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => recruitment.saveFeedback(interview.id, submission, participant)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    const state = await snapshot(interview.id, application?.id);
    expect(state.feedback).toEqual([expect.objectContaining({ userId: participant.id, status: 'submitted', revision: 1 })]);
    expect(state.history).toEqual([expect.objectContaining({ userId: participant.id, action: 'submit_feedback', revision: 1 })]);
    expect(state.events.filter(event => event.action === 'submit_feedback')).toHaveLength(linked ? 1 : 0);
    expect(state.audits).toHaveLength(1);
  });

  it.each(rollbackCases)('rolls back $action when $table fails (linked=$linked), then retries safely', async ({ linked, action, table }) => {
    const { interview, application } = await fixture(linked);
    if (action === 'return') await recruitment.saveFeedback(interview.id, submission, participant);
    const baseline = await snapshot(interview.id, application?.id);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION talent_recruitment_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic recruitment transaction failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER talent_recruitment_test_failure BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION talent_recruitment_test_fail()`);
    const change = () => action === 'submit' ? recruitment.saveFeedback(interview.id, submission, participant)
      : recruitment.returnFeedback(interview.id, participant.id, returnInput, hr);
    try {
      await expect(change()).rejects.toThrow();
      expect(await snapshot(interview.id, application?.id)).toEqual(baseline);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER talent_recruitment_test_failure ON ${table}`);
    }
    const response = await change();
    const state = await snapshot(interview.id, application?.id);
    const revision = action === 'submit' ? 1 : 2;
    expect(state.feedback).toEqual([expect.objectContaining({ userId: participant.id, revision,
      status: action === 'submit' ? 'submitted' : 'draft', summary: submission.summary })]);
    expect(state.history).toHaveLength(baseline.history.length + 1);
    expect(state.history).toContainEqual(expect.objectContaining({ revision, summary: submission.summary,
      action: action === 'submit' ? 'submit_feedback' : 'return_feedback',
      actorId: action === 'submit' ? participant.id : hr.id, note: action === 'submit' ? null : returnInput.note }));
    expect(state.events).toHaveLength(baseline.events.length + (linked ? 1 : 0));
    expect(state.audits).toHaveLength(baseline.audits.length + 1);
    expect(JSON.stringify(state.audits)).not.toContain(submission.summary);
    expect(JSON.stringify(state.audits)).not.toContain(returnInput.note);
    if (action === 'return') expect(response.own).toBeNull();
    else expect(response.own).toMatchObject({ userId: participant.id, revision: 1 });
  });

  it.each([true, false])('keeps earlier submitted bodies and isolates each participant history (linked=%s)', async linked => {
    const { candidate, interview } = await fixture(linked);
    await recruitment.saveFeedback(interview.id, submission, participant);
    await recruitment.saveFeedback(interview.id, { ...submission, summary: 'Synthetic other participant feedback' }, otherParticipant);
    await recruitment.returnFeedback(interview.id, participant.id, returnInput, hr);
    await recruitment.saveFeedback(interview.id, { ...submission, expectedRevision: 2, submit: false,
      summary: 'Synthetic revised draft' }, participant);
    await recruitment.saveFeedback(interview.id, { ...submission, expectedRevision: 3,
      summary: 'Synthetic revised submission' }, participant);
    if (!linked) await prisma.talentCandidate.update({ where: { id: candidate.id }, data: { deletedAt: new Date() } });
    const own = await recruitment.feedback(interview.id, participant);
    expect(own.items).toHaveLength(1);
    expect(own.own).toMatchObject({ userId: participant.id, summary: 'Synthetic revised submission', revision: 4 });
    expect(own.own!.history.map(event => event.summary)).toEqual([
      submission.summary, submission.summary, 'Synthetic revised submission',
    ]);
    expect(own.own!.history.map(event => event.action)).toEqual(['submit_feedback', 'return_feedback', 'submit_feedback']);
    expect((await recruitment.feedback(interview.id, otherParticipant)).items.map(item => item.userId)).toEqual([otherParticipant.id]);
    const all = await recruitment.feedback(interview.id, hr);
    expect(all.items).toHaveLength(2);
    expect(all.own).toBeNull();
    await expect(recruitment.feedback(interview.id, confirmer)).rejects.toThrow();
  });

  it('serializes hiring submission against feedback and locks feedback once hiring review wins', async () => {
    const { application, interview } = await fixture();
    const [hiring, feedback] = await Promise.allSettled([
      recruitment.act(application!.id, { expectedRevision: 0, action: 'submit_hiring', note: 'Synthetic hiring reason' }, hr),
      recruitment.saveFeedback(interview.id, submission, participant),
    ]);
    expect(hiring.status).toBe('fulfilled');
    if (feedback.status === 'rejected') expect(feedback.reason).toBeInstanceOf(BadRequestException);
    expect(await prisma.talentApplication.findUnique({ where: { id: application!.id } })).toMatchObject({ stage: 'hiring_review', revision: 1 });
    expect(await prisma.talentInterviewFeedbackEvent.count({ where: { interviewId: interview.id } })).toBe(feedback.status === 'fulfilled' ? 1 : 0);
    await expect(recruitment.saveFeedback(interview.id, { ...submission, expectedRevision: feedback.status === 'fulfilled' ? 1 : 0 }, participant))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(recruitment.act(application!.id, { expectedRevision: 1, action: 'approve_hiring' }, hr))
      .rejects.toBeInstanceOf(ForbiddenException);
    const queue = await recruitment.hiringReviews(confirmer);
    expect(queue).toContainEqual(expect.objectContaining({ id: application!.id, allowedActions: ['approve_hiring', 'return_hiring'] }));
    expect(queue.find(row => row.id === application!.id)!.events.some(event => event.action.endsWith('_feedback'))).toBe(false);
    await expect(recruitment.list(application!.candidateId, confirmer)).rejects.toBeInstanceOf(ForbiddenException);
    await recruitment.act(application!.id, { expectedRevision: 1, action: 'approve_hiring' }, confirmer);
    await expect(recruitment.detail(application!.id, confirmer)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
