import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TalentInterviewsService, safeTencentMeetingUrl } from './talent-interviews.service';
import type { AuthUser } from '@/common/types/auth.types';

const hr = { id: 'hr', name: 'HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false } as AuthUser;
const employee = { ...hr, id: 'participant', sysRole: 'employee' } as AuthUser;
const reviewer = { ...hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] } as AuthUser;
const draft = { candidateId: 'candidate', applicationId: 'application', startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', participantIds: ['participant'], invitationText: '<b>plain invitation</b>', meetingUrl: 'https://meeting.tencent.com/dm/demo', note: 'private' };

function setup(overrides = {}) {
  const actor = { ...hr, status: 'active', archivedAt: null, deletedAt: null };
  const row = { id: 'invite', candidateId: 'candidate', applicationId: 'application', candidateNameSnapshot: 'Synthetic Candidate', startsAt: new Date(draft.startsAt), endsAt: new Date(draft.endsAt), invitationText: draft.invitationText, meetingUrl: draft.meetingUrl, note: draft.note, status: 'scheduled', version: 1, syncStatus: 'unconfigured', calendarSyncedVersion: 0, participants: [{ userId: 'participant', userNameSnapshot: 'Synthetic Participant' }], candidate: { deletedAt: null }, ...overrides };
  const prisma = {
    talentCandidate: { findUnique: jest.fn().mockResolvedValue({ id: 'candidate', name: row.candidateNameSnapshot, deletedAt: null }) },
    talentApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'application', candidateId: 'candidate', stage: 'interviewing' }) },
    user: { findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...actor })), findMany: jest.fn().mockResolvedValue([{ id: 'participant', name: 'Synthetic Participant' }]) },
    talentInterview: { findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]), create: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    talentInterviewParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
    talentInterviewSync: { create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn() },
    notificationLog: { createMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'candidate' }]),
    $transaction: jest.fn(),
  };
  const tx = { ...prisma, notificationLog: { createMany: jest.fn().mockImplementation(({ data }) => Promise.resolve({ count: data.length })) } };
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  return { row, actor, prisma, tx, sut: new TalentInterviewsService(prisma as never) };
}

function pauseLock(prisma: ReturnType<typeof setup>['prisma'], table: string) {
  let unlock!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { unlock = resolve; });
  prisma.$queryRaw.mockImplementation(async (sql) => {
    if (sql.join('?').includes(table)) { entered(); await released; }
    return [{ id: 'candidate' }];
  });
  return { waiting, unlock };
}

describe('talent interview safety and access', () => {
  it('lets an explicitly granted employee maintain invitations with current database eligibility, not request status', async () => {
    const { sut, actor } = setup();
    Object.assign(actor, { sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const operator = { ...employee, hrCapabilities: ['recruitment_edit'] };
    await expect(sut.create(draft, operator)).resolves.toMatchObject({ candidateId: 'candidate' });
    await expect(sut.update('invite', { version: 1, note: 'Operator edit' }, operator)).resolves.toMatchObject({ version: 2 });
    Object.assign(actor, { hrCapabilities: ['recruitment_view'] });
    await expect(sut.cancel('invite', { version: 1 }, operator)).rejects.toThrow(ForbiddenException);
  });
  it('allows an explicit employee recruitment reader to see an unassigned invitation without writing', async () => {
    const { sut } = setup();
    const reader = { ...employee, id: 'reader', hrCapabilities: ['recruitment_view'] };
    await expect(sut.detail('invite', reader)).resolves.toMatchObject({ candidateId: 'candidate', applicationId: 'application' });
    await expect(sut.list({ scope: 'all' }, reader)).resolves.toHaveLength(1);
    await expect(sut.list({ scope: 'created' }, reader)).resolves.toHaveLength(1);
    await expect(sut.list({ scope: 'responsible' }, reader)).resolves.toHaveLength(1);
    await expect(sut.create(draft, reader)).rejects.toThrow(ForbiddenException);
  });
  it.each(['hr', 'system_admin', 'hr_user'])('does not leak IDs to an assessor-only %s participant or allow unassigned detail', async sysRole => {
    const { sut } = setup();
    const actor = { ...employee, sysRole, isAssessorOnly: true, hrCapabilities: ['employee_archive_edit', 'employee_archive_review', 'recruitment_view'] } as AuthUser;
    const own = await sut.detail('invite', actor);
    expect(own).not.toHaveProperty('candidateId');
    expect(own).not.toHaveProperty('applicationId');
    expect(own).not.toHaveProperty('participants');
    await expect(sut.detail('invite', { ...actor, id: 'unassigned' })).rejects.toThrow(NotFoundException);
    await expect(sut.list({ scope: 'all' }, actor)).rejects.toThrow(ForbiddenException);
  });
  it('displays only the linked position and batch to talent readers, including explicit unlinked invitations', async () => {
    const application = { positionName: 'Synthetic role', recruitmentBatch: 'Round 1' };
    const { sut } = setup({ applicationId: 'application', application });
    await expect(sut.detail('invite', reviewer)).resolves.toMatchObject({ application });
    expect(await sut.detail('invite', employee)).not.toHaveProperty('application');
    await expect(setup({ applicationId: null, application: null }).sut.detail('invite', hr)).resolves.toMatchObject({ application: null });
  });
  it.each([
    ['create', 'application'], ['update', null], ['update', 'application'],
    ['cancel', null], ['cancel', 'application'], ['complete', null], ['complete', 'application'],
    ['retrySync', null], ['retrySync', 'application'],
  ] as const)('%s rejects revoked maintenance permission after its last business lock, application=%s', async (action, applicationId) => {
    const { sut, prisma, tx, actor } = setup({ applicationId });
    const lastLock = action === 'create' ? applicationId ? 'talent_applications' : 'talent_candidates' : 'talent_interviews';
    const lock = pauseLock(prisma, lastLock);
    const pending = action === 'create' ? sut.create({ ...draft, applicationId }, hr) : sut[action]('invite', { version: 1 }, hr);
    try {
      await lock.waiting;
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      Object.assign(actor, { sysRole: 'hr_user', hrCapabilities: [] });
    } finally { lock.unlock(); }
    await expect(pending).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: hr.id } }));
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
    expect(prisma.talentInterview.updateMany).not.toHaveBeenCalled();
    expect(prisma.talentInterviewSync.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'resigned' }, { status: 'pending_entry' }, { archivedAt: new Date() },
    { deletedAt: new Date() }, { isAssessorOnly: true },
  ])('rechecks an actor changed during create lock wait: %j', async change => {
    const { sut, prisma, actor, tx } = setup({ applicationId: 'application' });
    const lock = pauseLock(prisma, 'talent_applications');
    const pending = sut.create({ ...draft, applicationId: 'application' }, hr);
    try { await lock.waiting; Object.assign(actor, change); } finally { lock.unlock(); }
    await expect(pending).rejects.toThrow(ForbiddenException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
    expect(tx.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it('rejects an actor removed while waiting, including a replay with an existing request ID', async () => {
    const { sut, prisma } = setup({ createdById: hr.id });
    const lock = pauseLock(prisma, 'talent_candidates');
    const pending = sut.create({ ...draft, requestId: 'invite' }, hr);
    try { await lock.waiting; prisma.user.findUnique.mockResolvedValueOnce(null as never); } finally { lock.unlock(); }
    await expect(pending).rejects.toThrow(ForbiddenException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
  });
  it.each(['create', 'update-selected', 'update-retained'] as const)('%s checks current participant eligibility after the final lock', async action => {
    const { sut, prisma, tx } = setup({ applicationId: 'application' });
    const lock = pauseLock(prisma, action === 'create' ? 'talent_applications' : 'talent_interviews');
    const pending = action === 'create' ? sut.create({ ...draft, applicationId: 'application' }, hr)
      : sut.update('invite', { version: 1, ...(action === 'update-selected' ? { participantIds: ['participant'] } : { note: 'Synthetic schedule edit' }) }, hr);
    try {
      await lock.waiting;
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      prisma.user.findMany.mockResolvedValue([]);
    } finally { lock.unlock(); }
    await expect(pending).rejects.toThrow(BadRequestException);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: { in: ['participant'] }, status: { in: ['active', 'probation'] }, archivedAt: null, deletedAt: null, accountType: 'employee', isAssessorOnly: false,
    } }));
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
    expect(prisma.talentInterview.updateMany).not.toHaveBeenCalled();
    expect(tx.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it('accepts a current probation HR editor without broadening participant rules or silently rewriting snapshots', async () => {
    const { sut, prisma, actor } = setup();
    Object.assign(actor, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'], status: 'probation' });
    prisma.user.findMany.mockResolvedValue([{ id: 'participant', name: 'Current name' }]);
    const result = await sut.update('invite', { version: 1, note: 'Synthetic edit' }, hr);
    expect(result).toMatchObject({ version: 2, participantNames: ['Synthetic Participant'] });
    expect(prisma.talentInterviewParticipant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.talentInterviewParticipant.createMany).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'complete', 'retrySync'] as const)('keeps %s available to current HR when a historical participant has departed', async action => {
    const { sut, prisma } = setup();
    if (action === 'retrySync') jest.spyOn(sut as any, 'syncStatus').mockReturnValue('pending');
    prisma.user.findMany.mockResolvedValue([]);
    await expect(sut[action]('invite', { version: 1 }, hr)).resolves.toMatchObject({ version: 2 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  it.each(['javascript:alert(1)', 'http://meeting.tencent.com/x', 'https://meeting.tencent.com.evil.test/x', 'https://evil.test/meeting.tencent.com', 'https://user:secret@meeting.tencent.com/x', 'https://meeting.tencent.com:8443/x', 'https://meeting.tencent.com\\@evil.test/x'])('rejects unsafe URL %s', (url) => {
    expect(() => safeTencentMeetingUrl(url)).toThrow(BadRequestException);
  });
  it('accepts official HTTPS link and blank link', () => {
    expect(safeTencentMeetingUrl(draft.meetingUrl)).toBe(draft.meetingUrl);
    expect(safeTencentMeetingUrl('')).toBeNull();
  });
  it('assigned user sees only minimal fields, including when candidate is deleted', async () => {
    const { sut } = setup({ candidate: { deletedAt: new Date() } });
    const view = await sut.detail('invite', employee);
    expect(Object.keys(view).sort()).toEqual(['id', 'candidateNameSnapshot', 'startsAt', 'endsAt', 'invitationText', 'meetingUrl', 'note', 'status', 'version', 'sourceDeleted', 'participantNames'].sort());
    expect(view.note).toBe(draft.note);
    expect(view.sourceDeleted).toBe(true);
    expect(view.invitationText).toBe(draft.invitationText);
  });
  it('unassigned user cannot inspect invitation', async () => {
    const { sut } = setup();
    await expect(sut.detail('invite', { ...employee, id: 'other' })).rejects.toThrow(NotFoundException);
  });
  it('links only an open application belonging to this candidate and hides its ID from ordinary participants', async () => {
    const { sut, prisma } = setup({ applicationId: 'application' });
    await sut.create({ ...draft, applicationId: 'application' }, hr);
    expect(prisma.talentInterview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ applicationId: 'application' }) }));
    expect(prisma.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'),
    ]);
    await expect(sut.detail('invite', hr)).resolves.toMatchObject({ applicationId: 'application' });
    expect(await sut.detail('invite', employee)).not.toHaveProperty('applicationId');
    expect(await sut.detail('invite', employee)).not.toHaveProperty('candidateId');
  });
  it('rejects mismatched or closed application sources before creating an invitation', async () => {
    const { sut, prisma } = setup();
    prisma.talentApplication.findUnique.mockResolvedValue({ id: 'application', candidateId: 'other', stage: 'interviewing' });
    await expect(sut.create({ ...draft, applicationId: 'application' }, hr)).rejects.toThrow(BadRequestException);
    prisma.talentApplication.findUnique.mockResolvedValue({ id: 'application', candidateId: 'candidate', stage: 'accepted' });
    await expect(sut.create({ ...draft, applicationId: 'application' }, hr)).rejects.toThrow(BadRequestException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
  });
  it('application source is immutable and participates in replay identity', async () => {
    const { sut, prisma } = setup({ applicationId: 'application', createdById: hr.id });
    await expect(sut.update('invite', { version: 1, applicationId: 'other' } as any, hr)).rejects.toThrow(BadRequestException);
    await expect(sut.create({ ...draft, applicationId: 'other', requestId: 'invite' }, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterview.updateMany).not.toHaveBeenCalled();
  });
  it('locks application between candidate and invitation on linked mutations', async () => {
    const { sut, prisma } = setup({ applicationId: 'application' });
    await sut.complete('invite', { version: 1 }, hr);
    expect(prisma.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'), expect.stringContaining('talent_interviews'),
    ]);
  });
  it('ordinary mine list filters by participation and cannot filter candidate library', async () => {
    const { sut, prisma } = setup();
    await sut.list({ scope: 'mine' }, employee);
    expect(prisma.talentInterview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { participants: { some: { userId: employee.id } } } }));
    await expect(sut.list({ candidateId: 'candidate' }, employee)).rejects.toThrow(ForbiddenException);
  });
  it('review-only users cannot mutate', async () => {
    const { sut, prisma } = setup();
    await expect(sut.create(draft, reviewer)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('HR can find their own created invitations after source deletion without listing everyone else', async () => {
    const { sut, prisma } = setup({ candidate: { deletedAt: new Date() } });
    await sut.list({ scope: 'created' } as any, hr);
    expect(prisma.talentInterview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdById: hr.id } }));
    await expect(sut.list({ scope: 'created' } as any, employee)).rejects.toThrow(ForbiddenException);
  });
  it('create persists participants and unconfigured sync intent, with safe audit and notification IDs', async () => {
    const { sut, prisma, tx } = setup();
    await sut.create(draft, hr);
    expect(prisma.talentInterview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ candidateNameSnapshot: 'Synthetic Candidate', participants: { create: [{ userId: 'participant', userNameSnapshot: 'Synthetic Participant' }] } }) }));
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, status: 'unconfigured', participantIds: ['participant'], operation: 'upsert' }) }));
    expect(tx.notificationLog.createMany).toHaveBeenCalledWith({ data: [{
      userId: 'participant', senderId: hr.id, type: 'talent_interview',
      dedupeKey: 'talent_interview:invite:1:participant', title: '面试邀约已更新',
      content: '请查看面试邀约的最新安排。', extraData: { invitationId: 'invite', version: 1 },
      status: 'sent', channel: 'system', isRead: false, readAt: null, sentAt: expect.any(Date),
    }] });
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
    const audit = JSON.stringify(prisma.auditLog.create.mock.calls);
    expect(audit).not.toContain(draft.invitationText);
    expect(audit).not.toContain(draft.meetingUrl);
    expect(audit).not.toContain(draft.note);
    const notification = JSON.stringify(tx.notificationLog.createMany.mock.calls);
    expect(notification).not.toContain(draft.invitationText);
    expect(notification).not.toContain(draft.meetingUrl);
    expect(notification).not.toContain(draft.note);
  });
  it.each(['create', 'update', 'cancel', 'complete'] as const)('%s rejects the whole transaction if system notification insertion fails', async (action) => {
    const { sut, prisma, tx } = setup();
    const failure = new Error('Synthetic notification insert failure');
    tx.notificationLog.createMany.mockRejectedValueOnce(failure);
    const saving = action === 'create' ? sut.create(draft, hr) : sut[action]('invite', { version: 1 }, hr);
    await expect(saving).rejects.toBe(failure);
    await expect(prisma.$transaction.mock.results[0].value).rejects.toBe(failure);
    expect(tx.notificationLog.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it.each([
    ['update', 'scheduled', '面试邀约已更新'],
    ['cancel', 'cancelled', '面试邀约已取消'],
    ['complete', 'completed', '面试已完成'],
  ] as const)('%s persists the new version notification with the business change', async (action, status, title) => {
    const { sut, prisma, tx } = setup();
    await expect(sut[action]('invite', { version: 1 }, hr)).resolves.toMatchObject({ version: 2, status });
    expect(tx.notificationLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      userId: 'participant', dedupeKey: 'talent_interview:invite:2:participant', title,
      extraData: { invitationId: 'invite', version: 2 }, status: 'sent', channel: 'system',
    })] });
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }));
  });
  it('retry only persists the new calendar intent without another business notification', async () => {
    const { sut, prisma, tx } = setup();
    jest.spyOn(sut as any, 'syncStatus').mockReturnValue('pending');
    await expect(sut.retrySync('invite', { version: 1 }, hr)).resolves.toMatchObject({ version: 2 });
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }));
    expect(tx.notificationLog.createMany).not.toHaveBeenCalled();
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it('does not create versions or intents by retrying while calendar is disabled', async () => {
    const { sut, prisma } = setup();
    await expect(sut.retrySync('invite', { version: 1 }, hr)).rejects.toThrow('钉钉日程未开通');
    expect(prisma.talentInterview.updateMany).not.toHaveBeenCalled();expect(prisma.talentInterviewSync.create).not.toHaveBeenCalled();
  });
  it('rejects deleted candidate, duplicate participants, and reversed dates', async () => {
    const { sut, prisma } = setup();
    await expect(sut.create({ ...draft, endsAt: draft.startsAt }, hr)).rejects.toThrow(BadRequestException);
    await expect(sut.create({ ...draft, participantIds: ['participant', 'participant'] }, hr)).rejects.toThrow(BadRequestException);
    prisma.talentCandidate.findUnique.mockResolvedValue({ deletedAt: new Date() });
    await expect(sut.create(draft, hr)).rejects.toThrow(NotFoundException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
  });
  it('participant validation includes probation workers', async () => {
    const { sut, prisma } = setup();
    await sut.create(draft, hr);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ['active', 'probation'] } }) }));
  });
  it('rejects ambiguous API times without an explicit timezone', async () => {
    const { sut } = setup();
    await expect(sut.create({ ...draft, startsAt: '2026-12-01T10:00:00', endsAt: '2026-12-01T11:00:00' }, hr)).rejects.toThrow(BadRequestException);
  });
  it('rejects stale version and terminal edits', async () => {
    const { sut, row } = setup();
    await expect(sut.update('invite', { version: 0, note: 'change' }, hr)).rejects.toThrow(ConflictException);
    row.status = 'cancelled';
    await expect(sut.update('invite', { version: 1, note: 'change' }, hr)).rejects.toThrow(BadRequestException);
  });
  it('cancel creates a cancel intent without deleting invitation or participants', async () => {
    const { sut, prisma } = setup();
    await sut.cancel('invite', { version: 1 }, hr);
    expect(prisma.talentInterview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'invite', version: 1 }, data: expect.objectContaining({ status: 'cancelled', version: 2 }) }));
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operation: 'cancel', version: 2 }) }));
    expect(prisma.talentInterviewParticipant.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses retry while outcome is uncertain', async () => {
    const { sut, prisma } = setup();
    prisma.talentInterviewSync.findFirst.mockResolvedValue({ status: 'uncertain' });
    await expect(sut.retrySync('invite', { version: 1 }, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterviewSync.create).not.toHaveBeenCalled();
  });
  it.each(['processing', 'uncertain'])('refuses all business changes while sync is %s', async (status) => {
    const { sut, prisma } = setup();
    prisma.talentInterviewSync.findFirst.mockResolvedValue({ status });
    await expect(sut.update('invite', { version: 1, note: 'change' }, hr)).rejects.toThrow(ConflictException);
    await expect(sut.cancel('invite', { version: 1 }, hr)).rejects.toThrow(ConflictException);
    await expect(sut.complete('invite', { version: 1 }, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterview.updateMany).not.toHaveBeenCalled();
  });
  it('CAS loss rejects mutation before creating intent', async () => {
    const { sut, prisma } = setup();
    prisma.talentInterview.updateMany.mockResolvedValue({ count: 0 });
    await expect(sut.complete('invite', { version: 1 }, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterviewSync.create).not.toHaveBeenCalled();
  });
  it('same create request ID is idempotent and cannot overwrite another creator', async () => {
    const { sut, prisma, tx, row } = setup({ createdById: 'hr' });
    await sut.create({ ...draft, requestId: 'invite' } as any, hr);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
    expect(tx.notificationLog.createMany).not.toHaveBeenCalled();
    expect(prisma.talentInterviewSync.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    (row as any).createdById = 'other';
    await expect(sut.create({ ...draft, requestId: 'invite' } as any, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
  });
  it('a successful create followed by request replay writes one stable notification only', async () => {
    const { sut, prisma, tx } = setup({ createdById: 'hr' });
    prisma.talentInterview.findUnique.mockResolvedValueOnce(null as never);
    const input = { ...draft, requestId: 'invite' };
    await sut.create(input, hr);
    await sut.create(input, hr);
    expect(prisma.talentInterview.create).toHaveBeenCalledTimes(1);
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.notificationLog.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notificationLog.createMany.mock.calls[0][0].data[0].dedupeKey).toBe('talent_interview:invite:1:participant');
  });
  it('reschedule audit keeps previous and next dates without invitation credentials', async () => {
    const { sut, prisma } = setup();
    await sut.update('invite', { version: 1, startsAt: '2026-12-02T02:00:00Z', endsAt: '2026-12-02T03:00:00Z' }, hr);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      oldValue: expect.objectContaining({ startsAt: draft.startsAt.replace('Z', '.000Z') }),
      newValue: expect.objectContaining({ startsAt: '2026-12-02T02:00:00.000Z' }),
    }) }));
  });
  it.each([
    [['participant'], ['participant', 'added'], ['participant', 'added'], []],
    [['participant', 'retained'], ['retained', 'participant'], ['retained', 'participant'], []],
    [['participant', 'removed'], ['participant'], ['participant'], ['removed']],
    [['removed', 'participant', 'removed-too'], ['added', 'participant'], ['added', 'participant'], ['removed', 'removed-too']],
  ])('notifies current and removed participants exactly once when changing %j to %j', async (oldIds, newIds, currentIds, removedIds) => {
    const { sut, prisma, tx } = setup({ participants: oldIds.map(userId => ({ userId, userNameSnapshot: `Synthetic ${userId}` })) });
    prisma.user.findMany.mockResolvedValue(newIds.map(id => ({ id, name: `Synthetic ${id}` })));
    await sut.update('invite', { version: 1, participantIds: newIds }, hr);
    const notifications = tx.notificationLog.createMany.mock.calls[0][0].data;
    expect(notifications.map(log => [log.userId, log.title])).toEqual([
      ...currentIds.map(id => [id, '面试邀约已更新']),
      ...removedIds.map(id => [id, '面试参与已取消']),
    ]);
    expect(notifications.map(log => log.dedupeKey)).toEqual([...currentIds, ...removedIds].map(id => `talent_interview:invite:2:${id}`));
    expect(new Set(notifications.map(log => log.dedupeKey)).size).toBe(notifications.length);
    for (const id of removedIds) {
      expect(notifications.find(log => log.userId === id)).toMatchObject({
        senderId: hr.id, type: 'talent_interview', content: '你已不再参与此面试，无需参加或填写反馈。',
        extraData: { invitationId: 'invite', version: 2, action: 'participant_removed' },
        status: 'sent', channel: 'system', isRead: false, readAt: null, sentAt: expect.any(Date),
      });
    }
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      oldValue: expect.objectContaining({ participantIds: oldIds }),
      newValue: expect.objectContaining({ participantIds: newIds }),
    }) }));
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ participantIds: newIds }) }));
    const serialized = JSON.stringify(notifications);
    for (const privateValue of [draft.invitationText, draft.meetingUrl, draft.note, 'Synthetic Candidate']) expect(serialized).not.toContain(privateValue);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it('aborts the transaction on a removal-notification failure and retries with the same dedupe keys', async () => {
    const { sut, prisma, tx, row } = setup({ participants: [
      { userId: 'participant', userNameSnapshot: 'First' }, { userId: 'removed', userNameSnapshot: 'Second' },
    ] });
    const failure = new Error('Synthetic removed-participant inbox failure');
    let commits = 0;
    prisma.$transaction.mockImplementation(async fn => {
      const result = await fn(tx);
      commits++;
      return result;
    });
    tx.notificationLog.createMany.mockImplementationOnce(async ({ data }) => {
      expect(data).toHaveLength(2);
      expect(data[1]).toMatchObject({ userId: 'removed', extraData: { action: 'participant_removed' } });
      throw failure;
    });
    const input = { version: 1, participantIds: ['participant'] };
    await expect(sut.update('invite', input, hr)).rejects.toBe(failure);
    await expect(prisma.$transaction.mock.results[0].value).rejects.toBe(failure);
    expect(commits).toBe(0);
    const result = await sut.update('invite', input, hr);
    expect(commits).toBe(1);
    expect(tx.notificationLog.createMany.mock.calls.map(([{ data }]) => data.map(log => log.dedupeKey))).toEqual([
      ['talent_interview:invite:2:participant', 'talent_interview:invite:2:removed'],
      ['talent_interview:invite:2:participant', 'talent_interview:invite:2:removed'],
    ]);
    Object.assign(row, { version: result.version, participants: [{ userId: 'participant', userNameSnapshot: 'First' }] });
    await expect(sut.update('invite', input, hr)).rejects.toThrow(ConflictException);
    expect(tx.notificationLog.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
  });
  it.each(['update', 'cancel', 'retrySync'] as const)('%s after removal does not notify the removed participant again', async action => {
    const { sut, tx, row } = setup({ participants: [
      { userId: 'participant', userNameSnapshot: 'First' }, { userId: 'removed', userNameSnapshot: 'Second' },
    ] });
    if (action === 'retrySync') jest.spyOn(sut as any, 'syncStatus').mockReturnValue('pending');
    const updated = await sut.update('invite', { version: 1, participantIds: ['participant'] }, hr);
    Object.assign(row, { version: updated.version, participants: [{ userId: 'participant', userNameSnapshot: 'First' }] });
    const result = await sut[action]('invite', { version: 2 }, hr);
    expect(result).toMatchObject({ version: 3, status: action === 'cancel' ? 'cancelled' : 'scheduled' });
    const notifications = tx.notificationLog.createMany.mock.calls.flatMap(([{ data }]) => data);
    expect(notifications.filter(log => log.userId === 'removed')).toEqual([expect.objectContaining({
      dedupeKey: 'talent_interview:invite:2:removed', title: '面试参与已取消',
    })]);
    expect(tx.notificationLog.createMany).toHaveBeenCalledTimes(action === 'retrySync' ? 1 : 2);
    if (action !== 'retrySync') expect(notifications[2]).toMatchObject({
      userId: 'participant', dedupeKey: 'talent_interview:invite:3:participant',
      title: action === 'cancel' ? '面试邀约已取消' : '面试邀约已更新',
      extraData: { invitationId: 'invite', version: 3 },
    });
  });
  it('removing HR participation does not revoke independent talent-reader access', async () => {
    const { sut, tx, row } = setup({ participants: [
      { userId: hr.id, userNameSnapshot: 'HR' }, { userId: 'participant', userNameSnapshot: 'First' },
    ] });
    const updated = await sut.update('invite', { version: 1, participantIds: ['participant'] }, hr);
    Object.assign(row, { version: updated.version, participants: [{ userId: 'participant', userNameSnapshot: 'First' }] });
    expect(tx.notificationLog.createMany.mock.calls[0][0].data).toContainEqual(expect.objectContaining({
      userId: hr.id, extraData: { invitationId: 'invite', version: 2, action: 'participant_removed' },
    }));
    await expect(sut.detail('invite', hr)).resolves.toMatchObject({ candidateId: 'candidate', version: 2 });
    await expect(sut.detail('invite', reviewer)).resolves.toMatchObject({ candidateId: 'candidate', version: 2 });
  });
  it('commits the entire recipient set before returning, then cancels removed participation and reauthorizes old links', async () => {
    const { sut, prisma, tx, row } = setup({ participants: [
      { userId: 'participant', userNameSnapshot: 'First' }, { userId: 'removed', userNameSnapshot: 'Second' },
    ] });
    prisma.user.findMany.mockResolvedValue([{ id: 'participant', name: 'First' }, { id: 'removed', name: 'Second' }]);
    prisma.talentInterview.create.mockResolvedValue({ ...row, participants: [...row.participants] });
    let finishInsert!: () => void;
    let insertStarted!: () => void;
    const inserting = new Promise<void>((resolve) => { insertStarted = resolve; });
    const resume = new Promise<void>((resolve) => { finishInsert = resolve; });
    let commits = 0;
    prisma.$transaction.mockImplementation(async (fn) => {
      const result = await fn(tx);
      commits++;
      return result;
    });
    tx.notificationLog.createMany.mockImplementationOnce(async ({ data }) => {
      insertStarted();
      await resume;
      return { count: data.length };
    });
    const pending = sut.create({ ...draft, participantIds: ['participant', 'removed'] }, hr);
    try {
      await Promise.race([inserting, pending.then(() => { throw new Error('Saved without transactional notifications'); })]);
      expect(commits).toBe(0);
      expect(tx.notificationLog.createMany.mock.calls[0][0].data.map((log) => [log.userId, log.extraData.version])).toEqual([
        ['participant', 1], ['removed', 1],
      ]);
      expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('talent_candidates');
      expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    } finally {
      finishInsert();
      await pending;
    }
    expect(commits).toBe(1);
    prisma.user.findMany.mockResolvedValue([{ id: 'participant', name: 'First' }]);
    const updated = await sut.update('invite', { version: 1, participantIds: ['participant'] }, hr);
    expect(commits).toBe(2);
    expect(prisma.$queryRaw.mock.calls.slice(-3).map(([sql]) => sql.join('?'))).toEqual([
      expect.stringContaining('talent_candidates'), expect.stringContaining('talent_applications'), expect.stringContaining('talent_interviews'),
    ]);
    expect(tx.notificationLog.createMany).toHaveBeenCalledTimes(2);
    expect(tx.notificationLog.createMany.mock.calls[1][0].data.map((log) => [log.userId, log.extraData.version])).toEqual([['participant', 2], ['removed', 2]]);
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
    row.version = updated.version;
    row.participants = [{ userId: 'participant', userNameSnapshot: 'First' }];
    const removedUser = { ...employee, id: 'removed' };
    const removedNotice = tx.notificationLog.createMany.mock.calls[1][0].data.find(log => log.userId === 'removed')!;
    await expect(sut.detail(removedNotice.extraData.invitationId, removedUser)).rejects.toThrow(NotFoundException);
    prisma.talentInterview.findMany.mockImplementation(async ({ where }) => row.participants.some(participant => participant.userId === where.participants.some.userId) ? [row] : []);
    await expect(sut.list({ scope: 'mine' }, removedUser)).resolves.toEqual([]);
    expect(prisma.talentInterview.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { participants: { some: { userId: 'removed' } } } }));
    await expect(sut.list({ candidateId: 'candidate' }, removedUser)).rejects.toThrow(ForbiddenException);
    await expect(sut.list({ scope: 'created' }, removedUser)).rejects.toThrow(ForbiddenException);
    await expect(sut.detail('invite', employee)).resolves.toMatchObject({ version: 2 });
  });
});
