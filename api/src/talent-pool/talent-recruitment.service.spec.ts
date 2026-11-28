import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { createHash } from 'node:crypto';
import type { RecruitmentDemandSource } from './recruitment-demands.types';

const hr = { id: 'hr', name: 'Synthetic HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: [] } as AuthUser;
const participant = { ...hr, id: 'participant', sysRole: 'employee' } as AuthUser;
const applicationInput = { positionName: 'Synthetic engineer', deptId: 'dept' };
const demandSelection = { recruitmentDemandId: 'ef10a762-94bd-4ca9-803f-93fc5c426b68', expectedDemandRevision: 1 };

function setup(applicationChanges = {}, interviewChanges = {}) {
  const actors = [hr, participant, { ...hr, id: 'submitter' }].map(user => ({ ...user, status: 'active', deletedAt: null, archivedAt: null }));
  const app = { id: 'app', candidateId: 'candidate', positionName: 'Synthetic engineer', recruitmentBatch: null, deptId: 'dept', departmentNameSnapshot: null,
    ownerId: hr.id, stage: 'interviewing', revision: 1, expectedEntryDate: null, hiringReason: null, hiringRequestedById: null, hiringRequestedAt: null,
    hiringReviewedById: null, hiringReviewedAt: null, reviewReturnStage: null, createdById: hr.id, createdAt: new Date(), updatedAt: new Date(),
    events: [], onboardingRequests: [], candidate: { name: 'Synthetic candidate' }, ...applicationChanges };
  const interview = { id: 'interview', candidateId: 'candidate', applicationId: 'app', status: 'completed', version: 1,
    participants: [{ userId: participant.id, userNameSnapshot: 'Synthetic participant' }], ...interviewChanges };
  const feedbacks: any[] = [];
  const feedbackEvents: any[] = [];
  const demand = { id: demandSelection.recruitmentDemandId, revision: 1, instanceId: 'fictional-instance', sourceState: 'approved', organizationKey: 'fictional-org', processCode: 'fictional-form',
    sourceFingerprint: 'f'.repeat(64), mappedFingerprint: 'f'.repeat(64), syncIssue: null, supersededByInstanceId: null,
    deptId: 'dept', department: { id: 'dept', name: 'Synthetic department', isActive: true }, positionId: 'position',
    position: { id: 'position', name: 'Synthetic engineer', isActive: true }, approvedHeadcount: 2, approvedAt: null, sourceLink: null,
    rawDepartment: 'Synthetic department', rawPosition: 'Synthetic engineer', rawHeadcount: '2', lastSyncedAt: new Date() };
  const normalizedSource = { organizationKey: demand.organizationKey, processCode: demand.processCode, instanceId: demand.instanceId,
    sourceState: demand.sourceState, rawDepartment: demand.rawDepartment, rawPosition: demand.rawPosition, rawHeadcount: demand.rawHeadcount,
    approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null, supersedesInstanceId: null };
  demand.sourceFingerprint = demand.mappedFingerprint = createHash('sha256').update(JSON.stringify(normalizedSource)).digest('hex');
  const tx = {
    user: { findUnique: jest.fn(({ where }) => Promise.resolve(actors.find(actor => actor.id === where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue(actors), count: jest.fn().mockResolvedValue(1) },
    department: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, name: 'Synthetic department', isActive: true })) },
    recruitmentDemand: { findUnique: jest.fn(async ({ where }) => where.id === demand.id || where.organizationKey_instanceId?.instanceId === demand.instanceId ? { ...demand } : null),
      findFirst: jest.fn(async () => null), update: jest.fn(async ({ data }) => { Object.assign(demand, data); return { ...demand }; }) },
    recruitmentDemandEvent: { create: jest.fn(async () => ({})) },
    talentCandidate: { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({ id: where.id, deletedAt: null })) },
    talentApplication: { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.requestId && where.requestId !== Reflect.get(app, 'requestId')
      ? null : { ...app, events: [...app.events], onboardingRequests: [...app.onboardingRequests] })), findMany: jest.fn().mockResolvedValue([app]),
      create: jest.fn().mockImplementation(({ data }) => { Object.assign(app, data); return Promise.resolve({ ...app }); }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        if (app.revision !== where.revision || app.stage !== where.stage) return Promise.resolve({ count: 0 });
        Object.assign(app, data); return Promise.resolve({ count: 1 });
      }) },
    talentApplicationEvent: { create: jest.fn().mockImplementation(({ data }) => { (app.events as any[]).push({ id: 'event', ...data, createdAt: new Date() }); return Promise.resolve(data); }) },
    employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    talentInterview: { findUnique: jest.fn().mockResolvedValue(interview), findMany: jest.fn().mockResolvedValue([]) },
    talentInterviewFeedback: { findUnique: jest.fn(({ where }) => { const row = feedbacks.find(row => row.userId === where.interviewId_userId.userId); return Promise.resolve(row ? { ...row } : null); }),
      findMany: jest.fn(({ where }) => Promise.resolve(feedbacks.filter(row => !where.userId || row.userId === where.userId))),
      create: jest.fn(({ data }) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; feedbacks.push(row); return Promise.resolve(row); }),
      updateMany: jest.fn(({ where, data }) => { const row = feedbacks.find(row => row.userId === where.userId && row.revision === where.revision); if (!row) return Promise.resolve({ count: 0 }); Object.assign(row, data); return Promise.resolve({ count: 1 }); }) },
    talentInterviewFeedbackEvent: {
      findMany: jest.fn(({ where }) => Promise.resolve(feedbackEvents.filter(event => event.interviewId === where.interviewId && (!where.userId || event.userId === where.userId)))),
      create: jest.fn(({ data }) => { const event = { id: `feedback-event-${feedbackEvents.length + 1}`, ...data, createdAt: new Date() }; feedbackEvents.push(event); return Promise.resolve(event); }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'candidate' }]),
  };
  const prisma = { ...tx, $transaction: jest.fn().mockImplementation(fn => fn(tx)) };
  const { sourceState, ...sourceFields } = normalizedSource;
  const readInstance = jest.fn(async (_id: string): Promise<RecruitmentDemandSource> => ({ ...sourceFields, status: sourceState as RecruitmentDemandSource['status'] }));
  const gateway = { status: () => ({ configured: true, missing: [], readOnly: true as const, scope: { organizationKey: 'fictional-org', processCode: 'fictional-form' } }), listIds: jest.fn(), readInstance,
    verifyForSubmission: jest.fn(async (id: string) => ({ source: await readInstance(id), relatedSources: [], replacementCoverage: 'complete' as const, checkedAt: new Date().toISOString() })) };
  const demands = new RecruitmentDemandsService(prisma as never, gateway);
  return { sut: new TalentRecruitmentService(prisma as never, demands), demands, demand, gateway, prisma, tx, app, interview, actors, feedbacks, feedbackEvents };
}

describe('application queue interview history projection', () => {
  it('keeps completed and cancelled history distinct from scheduled interviews without N+1 reads', async () => {
    const { sut, tx, app } = setup();
    tx.talentApplication.findMany.mockResolvedValue([{ ...app, interviews: [] }] as never);
    (tx.talentApplication as any).count = jest.fn().mockResolvedValue(1);
    tx.talentInterview.findMany.mockResolvedValue([
      { id: 'last-cancelled', applicationId: app.id, status: 'cancelled', startsAt: new Date('2026-12-03'), endsAt: new Date('2026-12-03'), participants: [{ userId: 'participant' }], feedback: [] },
      { id: 'completed', applicationId: app.id, status: 'completed', startsAt: new Date('2026-12-02'), endsAt: new Date('2026-12-02'), participants: [{ userId: 'participant' }], feedback: [] },
    ] as never);
    const result = await sut.queue({ page: 1, pageSize: 20 } as never, hr);
    expect(result.items[0]).toMatchObject({ nextInterview: null, latestInterview: { id: 'last-cancelled', status: 'cancelled' },
      activitySummary: { scheduledCount: 0, completedCount: 1, cancelledCount: 1, unsubmittedFeedbackCount: 1 } });
    expect(tx.talentInterview.findMany).toHaveBeenCalledTimes(1);
  });
  it('uses the detail termination definition in the queue while keeping raw event history private', async () => {
    const { sut, tx, app } = setup({ stage: 'withdrawn', revision: 4 });
    tx.talentApplication.findMany.mockResolvedValue([{ ...app, interviews: [], events: [{ action: 'accept_offer', version: 2 }, { action: 'terminate_offer', version: 4 }] }] as never);
    (tx.talentApplication as any).count = jest.fn().mockResolvedValue(1);
    const result = await sut.queue({ page: 1, pageSize: 20 } as never, hr);
    expect(result.items[0].offerTerminated).toBe(true); expect(result.items[0]).not.toHaveProperty('events');
  });
});

describe('application creation replay', () => {
  const intent = { requestId: '69b63655-caad-431e-bb8d-e96d5ab930ba', positionName: 'Synthetic role', recruitmentBatch: 'Round 1' };

  it('replays the original creation after an edit without recording a second creation', async () => {
    const { sut, tx } = setup();
    const created = await sut.create('candidate', intent, hr);
    await sut.update(created.id, { expectedRevision: 0, positionName: 'Edited role' }, hr);
    const replay = await sut.create('candidate', intent, hr);
    expect(tx.talentApplication.create).toHaveBeenCalledTimes(1);
    expect(replay).toMatchObject({ id: created.id, positionName: 'Edited role' });
    expect(replay.events.filter(event => event.action === 'create')).toHaveLength(1);
    await expect(sut.create('candidate', { ...intent, recruitmentBatch: 'Round 2' }, hr)).rejects.toThrow(ConflictException);
    await expect(sut.create('other-candidate', intent, hr)).rejects.toThrow(ConflictException);
  });
});

describe('early application demand intent and channel', () => {
  it('does not call a later ordinary withdrawal the previous terminated offer', async () => {
    const { sut } = setup({ stage: 'withdrawn', revision: 5, events: [
      { action: 'terminate_offer', version: 3 }, { action: 'reopen', version: 4 }, { action: 'withdraw', version: 5 },
    ] });
    expect(await sut.detail('app', hr)).toMatchObject({ offerTerminated: false });
  });
  it('keeps an explicitly selected intent and channel without creating an approval snapshot or seat', async () => {
    const { sut, tx, gateway } = setup();
    const created = await sut.create('candidate', { ...applicationInput, intentDemandId: demandSelection.recruitmentDemandId, sourceChannel: 'job_site' } as never, hr);
    expect(created).toMatchObject({ intentDemandId: demandSelection.recruitmentDemandId, sourceChannel: 'job_site', recruitmentDemandId: null, recruitmentDemandSnapshot: null });
    expect(tx.talentApplication.create.mock.calls[0][0].data).toMatchObject({ intentDemandId: demandSelection.recruitmentDemandId, sourceChannel: 'job_site' });
    expect(gateway.verifyForSubmission).not.toHaveBeenCalled();
    expect(created.events.some(event => event.action === 'accept_offer')).toBe(false);
  });

  it('rejects an intent for another department before creating an application', async () => {
    const { sut, tx } = setup();
    await expect(sut.create('candidate', { ...applicationInput, deptId: 'another-dept', intentDemandId: demandSelection.recruitmentDemandId } as never, hr)).rejects.toThrow(BadRequestException);
    expect(tx.talentApplication.create).not.toHaveBeenCalled();
  });

  it('rejects an intent for another position and a withdrawn demand', async () => {
    const { sut, demand } = setup();
    await expect(sut.create('candidate', { positionName: 'Other position', deptId: 'dept', intentDemandId: demand.id } as never, hr)).rejects.toThrow(BadRequestException);
    demand.sourceState = 'withdrawn';
    await expect(sut.create('candidate', { ...applicationInput, intentDemandId: demand.id } as never, hr)).rejects.toThrow(BadRequestException);
  });

  it('does not allow a request UUID to be reused with a different channel or intent', async () => {
    const { sut } = setup();
    const input = { ...applicationInput, requestId: '69b63655-caad-431e-bb8d-e96d5ab930ba', sourceChannel: 'job_site' };
    await sut.create('candidate', input as never, hr);
    await expect(sut.create('candidate', { ...input, sourceChannel: 'referral' } as never, hr)).rejects.toThrow(ConflictException);
  });

  it('requires a reason and current version to change intent, preserving the old frozen approval', async () => {
    const frozen = { demandId: 'old-formal-demand', revision: 2 };
    const { sut, tx } = setup({ intentDemandId: 'old-intent', recruitmentDemandId: 'old-formal-demand', recruitmentDemandSnapshot: frozen });
    await expect(sut.update('app', { expectedRevision: 1, intentDemandId: demandSelection.recruitmentDemandId } as never, hr)).rejects.toThrow(BadRequestException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    const updated = await sut.update('app', { expectedRevision: 1, intentDemandId: demandSelection.recruitmentDemandId, intentChangeReason: 'Fictional corrected demand' } as never, hr);
    expect(updated).toMatchObject({ intentDemandId: demandSelection.recruitmentDemandId, recruitmentDemandId: 'old-formal-demand', recruitmentDemandSnapshot: frozen });
    expect(updated.events.at(-1)).toMatchObject({ action: 'change_intent', note: 'Fictional corrected demand' });
  });

  it('rejects edits after candidate deletion or capability revocation', async () => {
    const { sut, tx, actors } = setup();
    tx.talentCandidate.findUnique.mockResolvedValueOnce({ id: 'candidate', deletedAt: new Date() });
    await expect(sut.update('app', { expectedRevision: 1, sourceChannel: 'job_site' } as never, hr)).rejects.toThrow(NotFoundException);
    Object.assign(actors[0], { sysRole: 'employee', hrCapabilities: [] });
    await expect(sut.update('app', { expectedRevision: 1, sourceChannel: 'job_site' } as never, hr)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });
});

describe('recruitment demand submission prerequisite', () => {
  it('rejects a freshly withdrawn upstream approval even when the local demand revision was unchanged', async () => {
    const { sut, tx, gateway } = setup();
    gateway.readInstance.mockImplementation(async () => ({ ...await Promise.resolve({ organizationKey: 'fictional-org', processCode: 'fictional-form',
      instanceId: 'fictional-instance', rawDepartment: 'Synthetic department', rawPosition: 'Synthetic engineer', rawHeadcount: '2',
      approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null, sourceLink: null, mainInstanceId: null, bizAction: null, supersedesInstanceId: null }), status: 'withdrawn' }));
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, hr)).rejects.toThrow();
    expect(gateway.verifyForSubmission).toHaveBeenCalledTimes(1);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
  });

  it('waits for upstream verification outside any database transaction', async () => {
    const { sut, prisma, tx, gateway } = setup();
    let inside = false;
    prisma.$transaction.mockImplementation(async fn => { inside = true; try { return await fn(tx); } finally { inside = false; } });
    const original = gateway.verifyForSubmission.getMockImplementation()!;
    gateway.verifyForSubmission.mockImplementation(async id => { expect(inside).toBe(false); return original(id); });
    await sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, hr);
    expect(gateway.verifyForSubmission).toHaveBeenCalledTimes(1);
  });
  it.each(['original-demand', null])('does not reassign an accepted or historical seat after reopening: %s', async recruitmentDemandId => {
    const { sut, tx } = setup({ stage: 'screening', revision: 5, recruitmentDemandId, events: [
      { action: 'accept_offer', version: 3 }, { action: 'withdraw', version: 4 }, { action: 'reopen', version: 5 },
    ] });
    await expect(sut.act('app', { expectedRevision: 5, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, hr))
      .rejects.toThrow('本次录用已接受且尚未明确终止，不能更换招聘需求');
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('permits re-selection only after explicit termination, not ordinary withdrawal', async () => {
    const { sut } = setup({ stage: 'screening', recruitmentDemandId: 'original-demand', events: [
      { action: 'terminate_offer', version: 5 }, { action: 'accept_offer', version: 3 },
    ] });
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, hr))
      .resolves.toMatchObject({ stage: 'hiring_review', recruitmentDemandId: demandSelection.recruitmentDemandId });
  });

  it('keeps an occupied seat when resubmitting the same demand', async () => {
    const { sut } = setup({ stage: 'screening', recruitmentDemandId: demandSelection.recruitmentDemandId,
      events: [{ action: 'accept_offer', version: 3 }, { action: 'withdraw', version: 4 }] });
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, hr))
      .resolves.toMatchObject({ stage: 'hiring_review', recruitmentDemandId: demandSelection.recruitmentDemandId });
  });

  it('rejects a new submission without an explicit demand before changing the application', async () => {
    const { sut, tx } = setup();
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason' }, hr)).rejects.toThrow(BadRequestException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed when the source/ledger service is absent, even with a selected demand', async () => {
    const { prisma, tx } = setup();
    const sut = new TalentRecruitmentService(prisma as never);
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic reason',
      recruitmentDemandId: 'ef10a762-94bd-4ca9-803f-93fc5c426b68', expectedDemandRevision: 1 } as never, hr)).rejects.toThrow();
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });

  it('preserves an already submitted historical null-link application through independent confirmation', async () => {
    const { sut } = setup({ stage: 'hiring_review', hiringRequestedById: 'submitter', recruitmentDemandId: null, recruitmentDemandSnapshot: null });
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, hr)).resolves.toMatchObject({ stage: 'offered', recruitmentDemandId: null });
    await expect(sut.act('app', { expectedRevision: 2, action: 'accept_offer' }, hr)).resolves.toMatchObject({ stage: 'accepted', recruitmentDemandSnapshot: null });
  });
});

describe('explicit accepted offer termination', () => {
  const accepted = { stage: 'accepted', revision: 3, recruitmentDemandId: demandSelection.recruitmentDemandId,
    events: [{ action: 'accept_offer', version: 3 }], hiringRequestedById: 'submitter' };
  const command = { expectedRevision: 3, action: 'terminate_offer', note: 'Fictional candidate explicitly declined arrival' } as never;

  it.each(['accepted', 'withdrawn'])('allows an editor to explicitly terminate an occupied %s offer once', async stage => {
    const { sut, tx } = setup({ ...accepted, stage, events: accepted.events.map(event => ({ ...event })) });
    await expect(sut.act('app', command, hr)).resolves.toMatchObject({ stage: 'withdrawn', revision: 4, offerTerminated: true });
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'terminate_offer',
      note: 'Fictional candidate explicitly declined arrival', version: 4 }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'terminate_offer',
      newValue: expect.objectContaining({ seatReleased: true, recruitmentDemandId: demandSelection.recruitmentDemandId }) }) });
    await expect(sut.act('app', command, hr)).rejects.toThrow(ConflictException);
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledTimes(1);
  });

  it('requires a reason and actual acceptance, not just an accepted stage string', async () => {
    const f = setup(accepted);
    await expect(f.sut.act('app', { expectedRevision: 3, action: 'terminate_offer', note: ' ' } as never, hr)).rejects.toThrow(BadRequestException);
    expect(f.tx.talentApplication.updateMany).not.toHaveBeenCalled();
    const forged = setup({ ...accepted, events: [] });
    await expect(forged.sut.act('app', command, hr)).rejects.toThrow(BadRequestException);
    expect(forged.tx.talentApplicationEvent.create).not.toHaveBeenCalled();
  });

  it('does not label ordinary withdrawal or a reopened application as a terminated current offer', async () => {
    const withdrawn = setup({ ...accepted, stage: 'withdrawn', events: accepted.events.map(event => ({ ...event })) });
    await expect(withdrawn.sut.detail('app', hr)).resolves.toMatchObject({ offerTerminated: false });
    const reopened = setup({ ...accepted, stage: 'screening', events: [...accepted.events, { action: 'terminate_offer', version: 4 }] });
    await expect(reopened.sut.detail('app', hr)).resolves.toMatchObject({ offerTerminated: false });
  });

  it('blocks active onboarding, effective arrival and an already released seat', async () => {
    const active = setup(accepted); active.tx.employeeDataChangeRequest.findFirst.mockResolvedValue({ id: 'ongoing' } as never);
    await expect(active.sut.act('app', command, hr)).rejects.toThrow(/入职.*撤回/);
    const effective = setup({ ...accepted, onboardingRequests: [{ id: 'effective', onboardingStatus: 'effective', cancelledAt: null }] });
    await expect(effective.sut.act('app', command, hr)).rejects.toThrow(BadRequestException);
    const hired = setup({ ...accepted, stage: 'hired' });
    await expect(hired.sut.act('app', command, hr)).rejects.toThrow(BadRequestException);
    const ended = setup({ ...accepted, stage: 'withdrawn', events: [...accepted.events, { action: 'terminate_offer', version: 4 }] });
    await expect(ended.sut.act('app', command, hr)).rejects.toThrow(BadRequestException);
    for (const f of [active, effective, hired, ended]) expect(f.tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });

  it.each([['recruitment_view'], ['talent_hiring_confirm']])('does not grant termination to a non-editor: %j', async (...capabilities) => {
    const { sut, actors, tx } = setup(accepted);
    Object.assign(actors[1], { sysRole: 'employee', hrCapabilities: capabilities });
    await expect(sut.act('app', command, participant)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });
});

describe('reserve reasons on application events', () => {
  it('persists optional multiple reasons on the event with the same revision and preserves independent reserve history', async () => {
    const { sut, tx } = setup();
    const first = await sut.act('app', { expectedRevision: 1, action: 'reserve', reserveReasons: ['commute_distance', 'salary_expectation'], note: 'Synthetic reserve note' } as never, hr);
    expect(first.events[0]).toMatchObject({ action: 'reserve', version: 2, reserveReasons: ['commute_distance', 'salary_expectation'], note: 'Synthetic reserve note' });
    await sut.act('app', { expectedRevision: 2, action: 'reopen' }, hr);
    const second = await sut.act('app', { expectedRevision: 3, action: 'reserve', reserveReasons: ['other'] } as never, hr);
    expect(second.events.filter(event => event.action === 'reserve')).toEqual([
      expect.objectContaining({ version: 2, reserveReasons: ['commute_distance', 'salary_expectation'], note: 'Synthetic reserve note' }),
      expect.objectContaining({ version: 4, reserveReasons: ['other'], note: null }),
    ]);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('Synthetic reserve note');
  });

  it('keeps the previous optional-reason contract when no reasons or explanation are supplied', async () => {
    const { sut } = setup();
    const result = await sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr);
    expect(result.events[0]).toMatchObject({ action: 'reserve', reserveReasons: [], note: null });
  });

  it.each([
    ['reserve', ['unknown']], ['reserve', ['other', 'other']], ['reserve', 'other'],
    ['reserve', ['other', 'other', 'other', 'other', 'other']], ['reject', ['commute_distance']],
  ])('rejects malformed or out-of-context reasons for %s before any event or stage change', async (action, reserveReasons) => {
    const { sut, tx } = setup();
    await expect(sut.act('app', { expectedRevision: 1, action, reserveReasons, note: 'Synthetic action note' } as never, hr)).rejects.toThrow(BadRequestException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
  });
});

describe('talent recruitment transactions and boundaries', () => {
  it('lets a recruitment-only operator create, edit, submit and record the answer after independent HR approval', async () => {
    const { sut, actors, tx } = setup();
    actors[1].hrCapabilities = ['recruitment_edit'];
    const created = await sut.create('candidate', applicationInput, participant);
    expect(created).toMatchObject({ ownerId: participant.id, stage: 'screening' });
    const edited = await sut.update(created.id, { expectedRevision: created.revision, recruitmentBatch: 'Synthetic operator batch' }, participant);
    const submitted = await sut.act(created.id, { expectedRevision: edited.revision, action: 'submit_hiring', note: 'Synthetic reason', ...demandSelection }, participant);
    expect(submitted).toMatchObject({ stage: 'hiring_review', hiringRequestedById: participant.id });
    await expect(sut.act(created.id, { expectedRevision: submitted.revision, action: 'approve_hiring' }, participant)).rejects.toThrow(ForbiddenException);
    const approved = await sut.act(created.id, { expectedRevision: submitted.revision, action: 'approve_hiring' }, hr);
    const accepted = await sut.act(created.id, { expectedRevision: approved.revision, action: 'accept_offer' }, participant);
    expect(accepted).toMatchObject({ stage: 'accepted', hiringRequestedById: participant.id, hiringReviewedById: hr.id });
    expect(tx.talentApplication.create).toHaveBeenCalledTimes(1);
  });
  it('does not let the operator return someone else\'s submitted interview feedback', async () => {
    const { sut, actors, feedbacks } = setup();
    actors[1].hrCapabilities = ['recruitment_edit'];
    feedbacks.push({ interviewId: 'interview', userId: 'other', status: 'submitted', revision: 1 });
    await expect(sut.returnFeedback('interview', 'other', { interviewVersion: 1, expectedRevision: 1, note: 'Denied' }, participant)).rejects.toThrow(ForbiddenException);
    expect((await sut.feedback('interview', participant)).canReturn).toBe(false);
  });
  it('gives a current explicit employee reader shared applications and feedback, never maintenance or confirmation', async () => {
    const { sut, actors, feedbacks, tx } = setup();
    Object.assign(actors[1], { hrCapabilities: ['recruitment_view'] });
    feedbacks.push({ interviewId: 'interview', userId: 'other', status: 'submitted', revision: 1, summary: 'Synthetic shared feedback' });
    await expect(sut.list('candidate', participant)).resolves.toEqual([expect.objectContaining({ id: 'app', allowedActions: [] })]);
    await expect(sut.detail('app', participant)).resolves.toMatchObject({ id: 'app', allowedActions: [] });
    await expect(sut.feedback('interview', participant)).resolves.toMatchObject({ items: [expect.objectContaining({ userId: 'other' })], canReturn: false });
    await expect(sut.create('candidate', applicationInput, participant)).rejects.toThrow(ForbiddenException);
    await expect(sut.update('app', { expectedRevision: 1, positionName: 'Other role' }, participant)).rejects.toThrow(ForbiddenException);
    await expect(sut.hiringReviews(participant)).rejects.toThrow(ForbiddenException);
    await expect(sut.returnFeedback('interview', 'other', { interviewVersion: 1, expectedRevision: 1, note: 'Unused' }, participant)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.create).not.toHaveBeenCalled();
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.talentInterviewFeedback.updateMany).not.toHaveBeenCalled();
  });
  it.each(['hr', 'system_admin', 'hr_user', 'employee'])('denies mixed assessor-only %s application and feedback reads', async sysRole => {
    const { sut, actors, tx } = setup();
    Object.assign(actors[0], { sysRole, isAssessorOnly: true, hrCapabilities: ['employee_archive_edit', 'employee_archive_review', 'recruitment_view'] });
    await expect(sut.list('candidate', hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.detail('app', hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.feedback('interview', hr)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
    expect(tx.talentInterviewFeedback.findMany).not.toHaveBeenCalled();
  });
  it.each(['create', 'update', 'act', 'saveFeedback', 'returnFeedback'] as const)('%s rechecks qualification after its last business lock', async action => {
    const { sut, actors, tx, interview, feedbacks } = setup();
    interview.participants.push({ userId: hr.id, userNameSnapshot: 'Synthetic HR participant' });
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', revision: 1 });
    let unlock!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const released = new Promise<void>(resolve => { unlock = resolve; });
    const lastTable = action === 'create' ? 'talent_candidates' : ['saveFeedback', 'returnFeedback'].includes(action) ? 'talent_interview_feedback' : 'talent_applications';
    tx.$queryRaw.mockImplementation(async sql => {
      if (sql.join('?').includes(`FROM ${lastTable} WHERE`)) { entered(); await released; }
      return [{ id: 'candidate' }];
    });
    const pending = action === 'create' ? sut.create('candidate', applicationInput, hr)
      : action === 'update' ? sut.update('app', { expectedRevision: 1, positionName: 'Unused' }, hr)
      : action === 'act' ? sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr)
      : action === 'saveFeedback' ? sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 0, submit: false }, hr)
      : sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 1, note: 'Unused' }, hr);
    try {
      await waiting;
      expect(tx.user.findUnique).not.toHaveBeenCalled();
      Object.assign(actors[0], { isAssessorOnly: true });
    } finally { unlock(); }
    await expect(pending).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.create).not.toHaveBeenCalled();
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.talentInterviewFeedback.create).not.toHaveBeenCalled();
    expect(tx.talentInterviewFeedback.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('requires fresh independent approval and does not infer system-admin approval', async () => {
    const { sut, app, actors, tx } = setup({ stage: 'hiring_review', hiringRequestedById: hr.id });
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, hr)).rejects.toThrow(ForbiddenException);
    Object.assign(app, { hiringRequestedById: 'submitter' });
    actors[0].sysRole = 'system_admin';
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, { ...hr, canViewAll: true })).rejects.toThrow(ForbiddenException);
    actors[0].hrCapabilities = ['talent_hiring_confirm'];
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, hr)).resolves.toMatchObject({ stage: 'offered', hiringReviewedById: hr.id });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rechecks status and grants inside the transaction, not a stale JWT', async () => {
    const { sut, actors, tx } = setup({ stage: 'hiring_review', hiringRequestedById: 'submitter' });
    actors[0].status = 'resigned';
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, hr)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });
  it('submission needs a reason but not feedback from every coordinator; event and audit stay in the transaction', async () => {
    const { sut, tx } = setup();
    await expect(sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: '  ' }, hr)).rejects.toThrow(BadRequestException);
    const view = await sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic hiring reason', ...demandSelection }, hr);
    expect(view).toMatchObject({ stage: 'hiring_review', revision: 2, reviewReturnStage: 'interviewing', ownerName: hr.name,
      events: [expect.objectContaining({ actorName: hr.name, note: 'Synthetic hiring reason' })] });
    expect(tx.talentInterviewFeedback.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('Synthetic hiring reason');
    expect(tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'), expect.stringContaining('users'),
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'),
      expect.stringContaining('pg_advisory_xact_lock'), expect.stringContaining('users'), expect.stringContaining('departments'), expect.stringContaining('positions'),
    ]);
  });
  it('rejects stale revision and CAS loss before writing events or audit', async () => {
    const { sut, tx } = setup();
    await expect(sut.act('app', { expectedRevision: 0, action: 'reserve' }, hr)).rejects.toThrow(ConflictException);
    tx.talentApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr)).rejects.toThrow(ConflictException);
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('forbids withdrawal during any active candidate onboarding, including legacy requests', async () => {
    const { sut, tx } = setup({ stage: 'accepted' });
    tx.employeeDataChangeRequest.findFirst.mockResolvedValue({ id: 'legacy-request' } as never);
    await expect(sut.act('app', { expectedRevision: 1, action: 'withdraw' }, hr)).rejects.toThrow(BadRequestException);
    expect(tx.employeeDataChangeRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ talentCandidateId: 'candidate', cancelledAt: null }) }));
  });
  it('does not create from deleted candidates but keeps existing applications available', async () => {
    const { sut, tx } = setup();
    tx.talentCandidate.findUnique.mockResolvedValue({ id: 'candidate', deletedAt: new Date() } as never);
    await expect(sut.create('candidate', applicationInput, hr)).rejects.toThrow(NotFoundException);
    await expect(sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr)).resolves.toMatchObject({ stage: 'reserve' });
  });
  it('does not grant application access to interview participants or confirmation-only employees', async () => {
    const { sut } = setup();
    await expect(sut.detail('app', participant)).rejects.toThrow(ForbiddenException);
    await expect(sut.list('candidate', { ...participant, hrCapabilities: ['talent_hiring_confirm'] })).rejects.toThrow(ForbiddenException);
  });
  it('uses a minimal onboarding summary and legal actions in application views', async () => {
    const { sut } = setup({ stage: 'onboarding', onboardingRequests: [{ id: 'request', onboardingStatus: 'pending_entry', recordStatus: 'submitted', cancelledAt: null }] });
    const view = await sut.detail('app', hr);
    expect(view.onboardingRequest).toEqual({ id: 'request', onboardingStatus: 'pending_entry', recordStatus: 'submitted', cancelledAt: null });
    expect(view).not.toHaveProperty('onboardingRequests');
  });
  it('creates a zero-revision application and records its history without any employee identity allocation', async () => {
    const { sut, tx } = setup();
    const result = await sut.create('candidate', { ...applicationInput, recruitmentBatch: 'Synthetic batch', deptId: 'dept', expectedEntryDate: '2026-12-01' }, hr);
    expect(result).toMatchObject({ stage: 'screening', revision: 0, ownerId: hr.id, ownerName: hr.name, departmentNameSnapshot: 'Synthetic department',
      expectedEntryDate: new Date('2026-12-01T00:00:00Z'), events: [expect.objectContaining({ action: 'create', version: 0 })] });
    expect(tx.talentApplication.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeDataChangeRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
  });
  it.each([
    ['screening', 'start_interview', 'interviewing'], ['reserve', 'start_interview', 'interviewing'],
    ['screening', 'reject', 'rejected'], ['interviewing', 'reserve', 'reserve'],
    ['offered', 'accept_offer', 'accepted'], ['offered', 'decline_offer', 'declined'],
    ['accepted', 'withdraw', 'withdrawn'], ['rejected', 'reopen', 'screening'], ['reserve', 'reopen', 'screening'],
    ['declined', 'reopen', 'screening'], ['withdrawn', 'reopen', 'screening'],
  ] as const)('retains history for %s -> %s -> %s', async (stage, action, destination) => {
    const { sut } = setup({ stage, events: [{ id: 'old', actorId: hr.id, action: 'historical', version: 0, toStage: stage }] });
    const result = await sut.act('app', { expectedRevision: 1, action, note: 'Synthetic action note' }, hr);
    expect(result).toMatchObject({ stage: destination, revision: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.events[1]).toMatchObject({ action, fromStage: stage, toStage: destination, version: 2 });
  });
  it('returns hiring to the frozen submitting stage, without rejecting the candidate, and allows resubmission', async () => {
    const { sut } = setup({ stage: 'hiring_review', reviewReturnStage: 'screening', hiringRequestedById: 'submitter' });
    await expect(sut.act('app', { expectedRevision: 1, action: 'return_hiring', note: 'Synthetic correction' }, hr)).resolves.toMatchObject({ stage: 'screening', hiringReviewedById: hr.id });
    await expect(sut.act('app', { expectedRevision: 2, action: 'submit_hiring', note: 'Synthetic corrected submission', ...demandSelection }, hr)).resolves.toMatchObject({ stage: 'hiring_review', hiringRequestedById: hr.id, hiringReviewedById: null });
    await expect(sut.act('app', { expectedRevision: 3, action: 'approve_hiring' }, hr)).rejects.toThrow(ForbiddenException);
  });
  it.each(['onboarding', 'hired', 'unknown'])('does not accept manual action %s', async action => {
    const { sut, tx } = setup();
    await expect(sut.act('app', { expectedRevision: 1, action } as any, hr)).rejects.toThrow(BadRequestException);
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
  });
  it('does not change application data after hiring submission, and validates owner eligibility and real date values', async () => {
    const { sut, app, actors, tx } = setup({ stage: 'hiring_review' });
    await expect(sut.update('app', { expectedRevision: 1, positionName: 'New position' }, hr)).rejects.toThrow(BadRequestException);
    app.stage = 'screening';
    await expect(sut.update('app', { expectedRevision: 1, ownerId: participant.id }, hr)).rejects.toThrow(BadRequestException);
    actors[1].sysRole = 'hr_user';
    actors[1].hrCapabilities = ['employee_archive_edit'];
    actors[1].status = 'probation';
    await expect(sut.update('app', { expectedRevision: 1, ownerId: participant.id, expectedEntryDate: '2026-02-30' }, hr)).rejects.toThrow(BadRequestException);
    const result = await sut.update('app', { expectedRevision: 1, ownerId: participant.id, recruitmentBatch: null }, hr);
    expect(result).toMatchObject({ ownerId: participant.id, revision: 2, recruitmentBatch: null });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('permits exactly one winner for simultaneous updates from the same revision', async () => {
    const { sut, tx } = setup();
    const results = await Promise.allSettled([
      sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr),
      sut.act('app', { expectedRevision: 1, action: 'reject', note: 'Synthetic competing decision' }, hr),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.any(ConflictException) })]);
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('paginates owner lookup with the same current HR-editor boundary used by owner validation', async () => {
    const { sut, tx, actors } = setup();
    tx.user.findMany.mockResolvedValueOnce([{ ...actors[0], employeeNo: 'SYNTHETIC-HR', dept: { name: 'Synthetic department' } }] as never);
    const result = await sut.owners({ keyword: ' Synthetic ', page: 2, pageSize: 10 } as any, hr);
    expect(result).toEqual({ items: [{ id: hr.id, name: hr.name, employeeNo: 'SYNTHETIC-HR', deptName: 'Synthetic department' }], total: 1, page: 2, pageSize: 10 });
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ status: { in: ['active', 'probation'] }, archivedAt: null,
      deletedAt: null, isAssessorOnly: false, OR: [{ sysRole: { in: ['hr', 'system_admin'] } }, { sysRole: 'hr_user', hrCapabilities: { has: 'employee_archive_edit' } }, { hrCapabilities: { has: 'recruitment_edit' } }] }) }));
    await expect(sut.owners({ page: 1, pageSize: 10 } as any, participant)).rejects.toThrow(ForbiddenException);
  });
  it.each(['event', 'audit'])('does not swallow transactional %s write failures', async part => {
    const { sut, tx, prisma } = setup();
    const failure = new Error('Synthetic persistence failure');
    if (part === 'event') tx.talentApplicationEvent.create.mockRejectedValueOnce(failure);
    else tx.auditLog.create.mockRejectedValueOnce(failure as never);
    await expect(sut.act('app', { expectedRevision: 1, action: 'reserve' }, hr)).rejects.toBe(failure);
    await expect(prisma.$transaction.mock.results[0].value).rejects.toBe(failure);
  });
  it('explicit current employee confirmer can review a pending application without archive or feedback access', async () => {
    const { sut, actors, app, tx } = setup({ stage: 'hiring_review', hiringRequestedById: 'submitter', events: [
      { id: 'submission', actorId: 'submitter', action: 'submit_hiring', note: 'Synthetic hiring reason' },
      { id: 'feedback', actorId: 'participant', action: 'submit_feedback', note: 'Synthetic private feedback' },
    ] });
    Object.assign(actors[0], { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] });
    const view = await sut.detail('app', hr);
    expect(view).toMatchObject({ candidateName: 'Synthetic candidate', allowedActions: ['approve_hiring', 'return_hiring'] });
    expect(view).not.toHaveProperty('candidate');
    expect(view).not.toHaveProperty('phone');
    expect(view).not.toHaveProperty('expectSalaryMin');
    expect(JSON.stringify(view)).not.toContain('Synthetic private feedback');
    await expect(sut.list('candidate', hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.owners({ page: 1, pageSize: 20 } as any, hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.feedback('interview', hr)).rejects.toThrow(NotFoundException);
    await expect(sut.update('app', { expectedRevision: 1, positionName: 'Other position' }, hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.create('candidate', applicationInput, hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.act('app', { expectedRevision: 1, action: 'withdraw' }, hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.act('app', { expectedRevision: 1, action: 'approve_hiring' }, hr)).resolves.toMatchObject({ stage: 'offered', allowedActions: [] });
    await expect(sut.detail('app', hr)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.updateMany).toHaveBeenCalledTimes(1);
    app.stage = 'hiring_review';
    Object.assign(app, { hiringRequestedById: hr.id });
    await expect(sut.detail('app', hr)).rejects.toThrow(ForbiddenException);
    await expect(sut.act('app', { expectedRevision: 2, action: 'approve_hiring' }, hr)).rejects.toThrow(ForbiddenException);
  });
  it('capability-only independent confirmers can return hiring without gaining maintenance rights', async () => {
    const { sut, actors } = setup({ stage: 'hiring_review', hiringRequestedById: 'submitter', reviewReturnStage: 'interviewing' });
    Object.assign(actors[0], { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'] });
    await expect(sut.act('app', { expectedRevision: 1, action: 'return_hiring', note: 'Synthetic correction required' }, hr)).resolves.toMatchObject({ stage: 'interviewing', allowedActions: [] });
    await expect(sut.detail('app', hr)).rejects.toThrow(ForbiddenException);
  });
  it.each(['employee', 'hr'] as const)('offers the narrow pending hiring queue to %s confirmers only, excluding their submissions', async sysRole => {
    const { sut, actors, tx } = setup({ stage: 'hiring_review', hiringRequestedById: 'submitter' });
    Object.assign(actors[0], { sysRole, hrCapabilities: sysRole === 'employee' ? ['talent_hiring_confirm'] : [] });
    const result = await sut.hiringReviews(hr);
    expect(result).toEqual([expect.objectContaining({ candidateName: 'Synthetic candidate', stage: 'hiring_review', allowedActions: expect.arrayContaining(['approve_hiring', 'return_hiring']) })]);
    expect(result[0]).not.toHaveProperty('candidate');
    expect(tx.talentApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { stage: 'hiring_review', hiringRequestedById: { not: hr.id } },
      include: expect.objectContaining({ candidate: { select: { name: true } } }),
    }));
    expect(tx.talentCandidate.findUnique).not.toHaveBeenCalled();
  });
  it('denies the review queue to default administrators, expired grants, noncurrent and assessor-only actors', async () => {
    const { sut, actors, tx } = setup();
    for (const change of [
      { sysRole: 'system_admin', hrCapabilities: [] },
      { sysRole: 'employee', hrCapabilities: [] },
      { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'], status: 'resigned' },
      { sysRole: 'employee', hrCapabilities: ['talent_hiring_confirm'], status: 'active', isAssessorOnly: true },
    ]) {
      Object.assign(actors[0], change);
      await expect(sut.hiringReviews(hr)).rejects.toThrow(ForbiddenException);
    }
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
  });
});

describe('talent interview feedback', () => {
  it('returns the current interview version to the participant and HR after rescheduling', async () => {
    const { sut, interview } = setup();
    interview.version++;
    await expect(sut.feedback('interview', participant)).resolves.toMatchObject({ interviewVersion: 2, canEdit: true });
    await expect(sut.feedback('interview', hr)).resolves.toMatchObject({ interviewVersion: 2 });
  });
  it.each([null, 'app'])('preserves every submitted body and HR return note across draft edits and resubmission, application=%s', async applicationId => {
    const { sut, tx, feedbackEvents } = setup({}, { applicationId });
    await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 0, submit: false, summary: 'Synthetic first draft' }, participant);
    expect(tx.talentInterviewFeedbackEvent.create).not.toHaveBeenCalled();
    const submitted = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 1, submit: true, outcome: 'pass', summary: 'Synthetic original submitted body' }, participant);
    expect(submitted.own).toMatchObject({ history: [{ interviewId: 'interview', userId: participant.id, actorId: participant.id,
      action: 'submit_feedback', revision: 2, status: 'submitted', outcome: 'pass', summary: 'Synthetic original submitted body', note: null }] });
    const returned = await sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 2, note: 'Synthetic HR correction note' }, hr);
    expect(returned.items[0].history).toHaveLength(2);
    expect(returned.items[0].history[1]).toMatchObject({ actorId: hr.id, userId: participant.id, action: 'return_feedback', revision: 3,
      status: 'draft', outcome: 'pass', summary: 'Synthetic original submitted body', note: 'Synthetic HR correction note' });
    const draft = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 3, submit: false, outcome: 'pending', summary: 'Synthetic replacement draft' }, participant);
    expect(draft.own?.history).toHaveLength(2);
    const resubmitted = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 4, submit: true, outcome: 'reject', summary: 'Synthetic resubmitted body' }, participant);
    expect(resubmitted.own).toMatchObject({ status: 'submitted', revision: 5, summary: 'Synthetic resubmitted body' });
    expect(resubmitted.own?.history).toHaveLength(3);
    expect(feedbackEvents.map(event => [event.action, event.revision, event.outcome, event.summary, event.note])).toEqual([
      ['submit_feedback', 2, 'pass', 'Synthetic original submitted body', null],
      ['return_feedback', 3, 'pass', 'Synthetic original submitted body', 'Synthetic HR correction note'],
      ['submit_feedback', 5, 'reject', 'Synthetic resubmitted body', null],
    ]);
    const reloaded = await sut.feedback('interview', participant);
    expect(reloaded.own?.history).toEqual(resubmitted.own?.history);
    const audit = JSON.stringify(tx.auditLog.create.mock.calls);
    for (const sensitive of ['Synthetic original submitted body', 'Synthetic HR correction note', 'Synthetic resubmitted body', 'Synthetic replacement draft']) expect(audit).not.toContain(sensitive);
    if (applicationId === null) expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
  });
  it('snapshots pre-history legacy submissions on return before the original body can be replaced', async () => {
    const { sut, feedbacks, feedbackEvents } = setup({}, { applicationId: null });
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', outcome: 'pending', summary: 'Synthetic pre-history submission', revision: 7 });
    await sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 7, note: 'Synthetic legacy correction' }, hr);
    await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 8, submit: false, summary: 'Synthetic replacement text' }, participant);
    expect(feedbacks[0].summary).toBe('Synthetic replacement text');
    expect(feedbackEvents).toEqual([expect.objectContaining({ action: 'return_feedback', userId: participant.id, actorId: hr.id,
      revision: 8, outcome: 'pending', summary: 'Synthetic pre-history submission', note: 'Synthetic legacy correction' })]);
    const result = await sut.feedback('interview', participant);
    expect(result.own?.history[0].summary).toBe('Synthetic pre-history submission');
  });
  it('filters feedback history in the database and response by the same participant/HR boundary as current feedback', async () => {
    const { sut, tx, feedbacks, feedbackEvents, interview } = setup();
    feedbacks.push(
      { interviewId: 'interview', userId: participant.id, status: 'draft', revision: 2 },
      { interviewId: 'interview', userId: 'other', status: 'submitted', revision: 1 },
    );
    feedbackEvents.push(
      { id: 'own-event', interviewId: 'interview', userId: participant.id, actorId: hr.id, action: 'return_feedback', summary: 'Synthetic own old body', note: 'Synthetic own correction' },
      { id: 'other-event', interviewId: 'interview', userId: 'other', actorId: 'other', action: 'submit_feedback', summary: 'Synthetic other old body' },
      { id: 'other-interview', interviewId: 'other-interview', userId: participant.id, summary: 'Synthetic unrelated interview body' },
    );
    const own = await sut.feedback('interview', participant);
    expect(own.items).toHaveLength(1);
    expect(own.own?.history).toEqual([expect.objectContaining({ id: 'own-event' })]);
    expect(JSON.stringify(own)).not.toContain('Synthetic other old body');
    expect(JSON.stringify(own)).not.toContain('Synthetic unrelated interview body');
    expect(tx.talentInterviewFeedbackEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { interviewId: 'interview', userId: participant.id } }));
    const all = await sut.feedback('interview', hr);
    expect(all.items.map(item => [item.userId, item.history.map(event => event.id)])).toEqual([[participant.id, ['own-event']], ['other', ['other-event']]]);
    expect(tx.talentInterviewFeedbackEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { interviewId: 'interview' } }));
    interview.participants = [];
    const queriesBefore = tx.talentInterviewFeedbackEvent.findMany.mock.calls.length;
    await expect(sut.feedback('interview', participant)).rejects.toThrow(NotFoundException);
    expect(tx.talentInterviewFeedbackEvent.findMany).toHaveBeenCalledTimes(queriesBefore);
    await expect(sut.feedback('interview', hr)).resolves.toMatchObject({ items: [expect.objectContaining({ userId: participant.id, history: [expect.objectContaining({ id: 'own-event' })] }), expect.any(Object)] });
  });
  it.each(['submit', 'return'])('keeps a failed %s snapshot insert in the failing business transaction', async action => {
    const { sut, tx, feedbacks, prisma } = setup({}, { applicationId: null });
    const failure = new Error('Synthetic history persistence failure');
    tx.talentInterviewFeedbackEvent.create.mockRejectedValueOnce(failure as never);
    if (action === 'return') feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', outcome: 'pass', summary: 'Synthetic old submitted body', revision: 1 });
    const pending = action === 'submit'
      ? sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 0, submit: true, outcome: 'pass', summary: 'Synthetic new submitted body' }, participant)
      : sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 1, note: 'Synthetic return reason' }, hr);
    await expect(pending).rejects.toBe(failure);
    await expect(prisma.$transaction.mock.results[0].value).rejects.toBe(failure);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('lets actual current participants draft and submit only their own feedback; hides others in SQL and view', async () => {
    const { sut, feedbacks, tx } = setup();
    feedbacks.push({ interviewId: 'interview', userId: 'other', status: 'submitted', summary: 'Synthetic other private feedback', outcome: 'pass', revision: 1 });
    const draft = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 0, submit: false, summary: 'My draft' }, participant);
    expect(draft.items).toHaveLength(1);
    expect(draft.own).toMatchObject({ userId: participant.id, status: 'draft', revision: 1 });
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 1, submit: true }, participant)).rejects.toThrow(BadRequestException);
    const submitted = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 1, submit: true, outcome: 'pass', summary: 'Synthetic own feedback' }, participant);
    expect(submitted.own).toMatchObject({ status: 'submitted', revision: 2 });
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 2, submit: false }, participant)).rejects.toThrow(BadRequestException);
    expect(tx.talentInterviewFeedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { interviewId: 'interview', userId: participant.id } }));
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('Synthetic own feedback');
  });
  it('HR cannot impersonate participants; departed and removed participants cannot write', async () => {
    const { sut, actors, interview } = setup();
    const input = { interviewVersion: 1, expectedRevision: 0, submit: false };
    await expect(sut.saveFeedback('interview', input, hr)).rejects.toThrow(ForbiddenException);
    actors[1].status = 'resigned';
    await expect(sut.saveFeedback('interview', input, participant)).rejects.toThrow(ForbiddenException);
    actors[1].status = 'active';
    interview.participants = [];
    await expect(sut.saveFeedback('interview', input, participant)).rejects.toThrow(NotFoundException);
  });
  it('allows old unlinked invitations to receive feedback after candidate soft deletion', async () => {
    const { sut, tx } = setup({}, { applicationId: null });
    tx.talentCandidate.findUnique.mockResolvedValue({ id: 'candidate', deletedAt: new Date() } as never);
    const result = await sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 0, submit: true, outcome: 'pending', summary: 'Synthetic legacy feedback' }, participant);
    expect(result.own).toMatchObject({ status: 'submitted', revision: 1 });
    expect(tx.talentApplication.findUnique).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_interviews'), expect.stringContaining('talent_interview_feedback'),
    ]);
  });
  it('checks interview and feedback revisions and locks candidate before application before interview/feedback', async () => {
    const { sut, tx } = setup();
    await expect(sut.saveFeedback('interview', { interviewVersion: 2, expectedRevision: 0, submit: false }, participant)).rejects.toThrow(ConflictException);
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 2, submit: false }, participant)).rejects.toThrow(ConflictException);
    expect(tx.$queryRaw.mock.calls.slice(0, 4).map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'), expect.stringContaining('talent_interviews'), expect.stringContaining('talent_interview_feedback'),
    ]);
  });
  it('only HR editors return submitted feedback before hiring submission; business events keep history', async () => {
    const { sut, app, feedbacks, tx } = setup();
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', summary: 'Synthetic retained summary', outcome: 'pass', revision: 1, submittedAt: new Date() });
    const input = { interviewVersion: 1, expectedRevision: 1, note: 'Synthetic return note' };
    await expect(sut.returnFeedback('interview', participant.id, input, participant)).rejects.toThrow(ForbiddenException);
    await expect(sut.returnFeedback('interview', participant.id, input, hr)).resolves.toMatchObject({ items: [expect.objectContaining({ status: 'draft', revision: 2, summary: 'Synthetic retained summary' })] });
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'return_feedback', note: 'Synthetic return note' }) }));
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('Synthetic return note');
    feedbacks[0].status = 'submitted';
    app.stage = 'hiring_review';
    await expect(sut.returnFeedback('interview', participant.id, { ...input, expectedRevision: 2 }, hr)).rejects.toThrow(BadRequestException);
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 2, submit: false }, participant)).rejects.toThrow(BadRequestException);
  });
  it('CAS losers do not record feedback events', async () => {
    const { sut, feedbacks, tx } = setup();
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'draft', revision: 1, outcome: null, summary: null });
    tx.talentInterviewFeedback.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 1, submit: false }, participant)).rejects.toThrow(ConflictException);
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
    expect(tx.talentInterviewFeedbackEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not append a snapshot for a losing submission or return CAS', async () => {
    const { sut, tx, feedbacks } = setup({}, { applicationId: null });
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'draft', revision: 1, outcome: 'pass', summary: 'Synthetic unchanged draft' });
    tx.talentInterviewFeedback.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(sut.saveFeedback('interview', { interviewVersion: 1, expectedRevision: 1, submit: true }, participant)).rejects.toThrow(ConflictException);
    Object.assign(feedbacks[0], { status: 'submitted' });
    tx.talentInterviewFeedback.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 1, note: 'Synthetic unused return note' }, hr)).rejects.toThrow(ConflictException);
    expect(tx.talentInterviewFeedbackEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('removed participants cannot read retained feedback, but HR can still read it', async () => {
    const { sut, feedbacks, interview } = setup();
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', revision: 1, summary: 'Synthetic retained history' });
    interview.participants = [];
    await expect(sut.feedback('interview', participant)).rejects.toThrow(NotFoundException);
    await expect(sut.feedback('interview', hr)).resolves.toMatchObject({ own: null, items: [expect.objectContaining({ userId: participant.id })], canEdit: false });
  });
  it('HR reviewers can read all feedback but cannot return it or edit uninvited', async () => {
    const { sut, actors, feedbacks } = setup();
    actors[0].sysRole = 'hr_user';
    actors[0].hrCapabilities = ['employee_archive_review'];
    feedbacks.push({ interviewId: 'interview', userId: participant.id, status: 'submitted', revision: 1 });
    await expect(sut.feedback('interview', hr)).resolves.toMatchObject({ canEdit: false, canReturn: false, items: [expect.objectContaining({ userId: participant.id })] });
    await expect(sut.returnFeedback('interview', participant.id, { interviewVersion: 1, expectedRevision: 1, note: 'Synthetic return' }, hr)).rejects.toThrow(ForbiddenException);
  });
});
