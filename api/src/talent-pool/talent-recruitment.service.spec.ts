import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentRecruitmentService } from './talent-recruitment.service';

const hr = { id: 'hr', name: 'Synthetic HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false, hrCapabilities: [] } as AuthUser;
const participant = { ...hr, id: 'participant', sysRole: 'employee' } as AuthUser;
const applicationInput = { positionName: 'Synthetic engineer' };

function setup(applicationChanges = {}, interviewChanges = {}) {
  const actors = [hr, participant, { ...hr, id: 'submitter' }].map(user => ({ ...user, status: 'active', deletedAt: null, archivedAt: null }));
  const app = { id: 'app', candidateId: 'candidate', positionName: 'Synthetic engineer', recruitmentBatch: null, deptId: null, departmentNameSnapshot: null,
    ownerId: hr.id, stage: 'interviewing', revision: 1, expectedEntryDate: null, hiringReason: null, hiringRequestedById: null, hiringRequestedAt: null,
    hiringReviewedById: null, hiringReviewedAt: null, reviewReturnStage: null, createdById: hr.id, createdAt: new Date(), updatedAt: new Date(),
    events: [], onboardingRequests: [], candidate: { name: 'Synthetic candidate' }, ...applicationChanges };
  const interview = { id: 'interview', candidateId: 'candidate', applicationId: 'app', status: 'completed', version: 1,
    participants: [{ userId: participant.id, userNameSnapshot: 'Synthetic participant' }], ...interviewChanges };
  const feedbacks: any[] = [];
  const feedbackEvents: any[] = [];
  const tx = {
    user: { findUnique: jest.fn(({ where }) => Promise.resolve(actors.find(actor => actor.id === where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue(actors), count: jest.fn().mockResolvedValue(1) },
    department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept', name: 'Synthetic department', isActive: true }) },
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
    talentInterview: { findUnique: jest.fn().mockResolvedValue(interview) },
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
  return { sut: new TalentRecruitmentService(prisma as never), prisma, tx, app, interview, actors, feedbacks, feedbackEvents };
}

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
    const view = await sut.act('app', { expectedRevision: 1, action: 'submit_hiring', note: 'Synthetic hiring reason' }, hr);
    expect(view).toMatchObject({ stage: 'hiring_review', revision: 2, reviewReturnStage: 'interviewing', ownerName: hr.name,
      events: [expect.objectContaining({ actorName: hr.name, note: 'Synthetic hiring reason' })] });
    expect(tx.talentInterviewFeedback.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('Synthetic hiring reason');
    expect(tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'),
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'),
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
    await expect(sut.act('app', { expectedRevision: 2, action: 'submit_hiring', note: 'Synthetic corrected submission' }, hr)).resolves.toMatchObject({ stage: 'hiring_review', hiringRequestedById: hr.id, hiringReviewedById: null });
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
      deletedAt: null, isAssessorOnly: false, OR: [{ sysRole: { in: ['hr', 'system_admin'] } }, { sysRole: 'hr_user', hrCapabilities: { has: 'employee_archive_edit' } }] }) }));
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
