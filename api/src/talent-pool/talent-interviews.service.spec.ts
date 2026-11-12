import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TalentInterviewsService, safeTencentMeetingUrl } from './talent-interviews.service';
import type { AuthUser } from '@/common/types/auth.types';

const hr = { id: 'hr', name: 'HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false } as AuthUser;
const employee = { ...hr, id: 'participant', sysRole: 'employee' } as AuthUser;
const reviewer = { ...hr, sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] } as AuthUser;
const draft = { candidateId: 'candidate', startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', participantIds: ['participant'], invitationText: '<b>plain invitation</b>', meetingUrl: 'https://meeting.tencent.com/dm/demo', note: 'private' };

function setup(overrides = {}) {
  const row = { id: 'invite', candidateId: 'candidate', candidateNameSnapshot: 'Synthetic Candidate', startsAt: new Date(draft.startsAt), endsAt: new Date(draft.endsAt), invitationText: draft.invitationText, meetingUrl: draft.meetingUrl, note: draft.note, status: 'scheduled', version: 1, syncStatus: 'unconfigured', calendarSyncedVersion: 0, participants: [{ userId: 'participant', userNameSnapshot: 'Synthetic Participant' }], candidate: { deletedAt: null }, ...overrides };
  const prisma = {
    talentCandidate: { findUnique: jest.fn().mockResolvedValue({ id: 'candidate', name: row.candidateNameSnapshot, deletedAt: null }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'participant', name: 'Synthetic Participant' }]) },
    talentInterview: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(
      where.version === row.version && row.participants.some((p) => p.userId === where.participants.some.userId) ? { id: row.id } : null)),
      findMany: jest.fn().mockResolvedValue([row]), create: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    talentInterviewParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
    talentInterviewSync: { create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'candidate' }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  const notifications = { create: jest.fn().mockResolvedValue('notification') };
  return { row, prisma, notifications, sut: new TalentInterviewsService(prisma as never, notifications as never) };
}

describe('talent interview safety and access', () => {
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
    const { sut, prisma, notifications } = setup();
    await sut.create(draft, hr);
    expect(prisma.talentInterview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ candidateNameSnapshot: 'Synthetic Candidate', participants: { create: [{ userId: 'participant', userNameSnapshot: 'Synthetic Participant' }] } }) }));
    expect(prisma.talentInterviewSync.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 1, status: 'unconfigured', participantIds: ['participant'], operation: 'upsert' }) }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'talent_interview', extraData: { invitationId: 'invite', version: 1 } }));
    const audit = JSON.stringify(prisma.auditLog.create.mock.calls);
    expect(audit).not.toContain(draft.invitationText);
    expect(audit).not.toContain(draft.meetingUrl);
    expect(audit).not.toContain(draft.note);
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
    const { sut, prisma, row } = setup({ createdById: 'hr' });
    await sut.create({ ...draft, requestId: 'invite' } as any, hr);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
    (row as any).createdById = 'other';
    await expect(sut.create({ ...draft, requestId: 'invite' } as any, hr)).rejects.toThrow(ConflictException);
    expect(prisma.talentInterview.create).not.toHaveBeenCalled();
  });
  it('reschedule audit keeps previous and next dates without invitation credentials', async () => {
    const { sut, prisma } = setup();
    await sut.update('invite', { version: 1, startsAt: '2026-12-02T02:00:00Z', endsAt: '2026-12-02T03:00:00Z' }, hr);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      oldValue: expect.objectContaining({ startsAt: draft.startsAt.replace('Z', '.000Z') }),
      newValue: expect.objectContaining({ startsAt: '2026-12-02T02:00:00.000Z' }),
    }) }));
  });
  it('stops obsolete notification fanout after a new version removes a participant', async () => {
    const { sut, prisma, notifications, row } = setup({ participants: [
      { userId: 'participant', userNameSnapshot: 'First' }, { userId: 'removed', userNameSnapshot: 'Second' },
    ] });
    prisma.user.findMany.mockResolvedValue([{ id: 'participant', name: 'First' }, { id: 'removed', name: 'Second' }]);
    prisma.talentInterview.create.mockResolvedValue({ ...row, participants: [...row.participants] });
    let finishFirst!: (value: string) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    notifications.create.mockImplementationOnce(() => {
      firstStarted(); return new Promise<string>((resolve) => { finishFirst = resolve; });
    });
    const pending = sut.create({ ...draft, participantIds: ['participant', 'removed'] }, hr);
    await started;
    row.version = 2;
    row.participants = [{ userId: 'participant', userNameSnapshot: 'First' }];
    finishFirst('notification');
    await pending;
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'removed' }));
  });
});
