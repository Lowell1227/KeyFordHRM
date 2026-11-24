import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentWorkbenchService } from './talent-workbench.service';

const now = new Date('2026-11-22T02:00:00.000Z');
const user = { id: 'actor', sysRole: 'system_admin', canViewAll: true } as AuthUser;

function setup(actorOverrides: Record<string, unknown> = {}) {
  const actor = { id: user.id, sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'],
    status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false, ...actorOverrides };
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue(actor), findMany: jest.fn().mockResolvedValue([]) },
    talentCandidate: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    talentInterview: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    talentApplication: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = { $transaction: jest.fn().mockImplementation(fn => fn(tx)) };
  return { sut: new TalentWorkbenchService(prisma as never), tx, prisma, actor };
}

describe('recruitment workbench read projection', () => {
  it('gives explicit operators their follow-ups but no onboarding or hiring-confirmation queue', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const result = await sut.getWorkbench(user);
    expect(result.groups.map(group => group.key)).toEqual(['follow_up', 'interview', 'feedback']);
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
  });
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it.each([
    { status: 'resigned' }, { status: 'pending_entry' }, { status: 'disabled' },
    { archivedAt: now }, { deletedAt: now }, { isAssessorOnly: true, sysRole: 'hr' },
  ])('rejects ineligible current DB actor %j before reading domain data', async overrides => {
    const { sut, tx } = setup(overrides);
    await expect(sut.getWorkbench(user)).rejects.toThrow(ForbiddenException);
    expect(tx.talentCandidate.count).not.toHaveBeenCalled();
    expect(tx.talentInterview.count).not.toHaveBeenCalled();
    expect(tx.talentApplication.count).not.toHaveBeenCalled();
  });

  it('rejects a missing DB actor despite a privileged request identity', async () => {
    const { sut, tx } = setup();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(sut.getWorkbench(user)).rejects.toThrow(ForbiddenException);
    expect(tx.talentInterview.findMany).not.toHaveBeenCalled();
  });

  it('returns only eligible groups using DB capabilities rather than stale JWT grants', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: [] });
    expect(await sut.getWorkbench(user)).toEqual({ groups: [
      { key: 'interview', total: 0, items: [] }, { key: 'feedback', total: 0, items: [] },
    ] });
    expect(tx.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
    expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: user.id } }));
  });

  it.each(['hr', 'system_admin'])('does not turn %s personal queues into all-user queues', async sysRole => {
    const { sut, tx } = setup({ sysRole, hrCapabilities: [] });
    await sut.getWorkbench(user);
    expect(tx.talentCandidate.count).toHaveBeenCalledWith({ where: {
      deletedAt: null, AND: [
        { OR: [{ ownerId: user.id }, { ownerId: null, createdById: user.id }] },
        { OR: [{ followUps: { none: {} } }, { followUps: { some: { planStatus: 'pending' } } }] },
      ],
    } });
    for (const [query] of tx.talentInterview.count.mock.calls as any[]) {
      expect(query.where.participants).toEqual({ some: { userId: user.id } });
    }
    expect(tx.talentApplication.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stage: 'accepted', ownerId: user.id }),
    }));
  });

  it('preserves never-contacted and future-pending follow-up semantics without inventing an application', async () => {
    const { sut, tx } = setup();
    tx.talentCandidate.count.mockResolvedValue(2);
    tx.talentCandidate.findMany.mockImplementation(async ({ select }: any) => select.convertedUserId ? [] : [
      { id: 'first', name: 'First contact', followUps: [] },
      { id: 'planned', name: 'Future plan', followUps: [{ nextFollowUpAt: new Date('2026-12-01') }] },
    ]);
    const result = await sut.getWorkbench(user);
    expect(result.groups[0]).toEqual({ key: 'follow_up', total: 2, items: [
      { id: 'first', candidateId: 'first', title: 'First contact', subtitle: '待跟进', date: null },
      { id: 'planned', candidateId: 'planned', title: 'Future plan', subtitle: '待跟进', date: '2026-12-01' },
    ] });
    const query = (tx.talentCandidate.findMany.mock.calls as any[])[0][0];
    expect(query.where).toEqual((tx.talentCandidate.count.mock.calls as any[])[0][0].where);
    expect(query.select.followUps).toEqual({ where: { planStatus: 'pending' },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 1, select: { nextFollowUpAt: true } });
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('uses current participation, scheduled status and inclusive end time for attendance', async () => {
    const { sut, tx } = setup();
    await sut.getWorkbench(user);
    const attendance = (tx.talentInterview.count.mock.calls as any[])[0][0];
    expect(attendance).toEqual({ where: {
      participants: { some: { userId: user.id } }, status: 'scheduled', endsAt: { gte: now },
    } });
    const query = (tx.talentInterview.findMany.mock.calls as any[])[0][0];
    expect(query.where).toEqual(attendance.where);
    expect(query.orderBy).toEqual([{ startsAt: 'asc' }, { id: 'asc' }]);
  });

  it('keeps completed or ended interviews open for own feedback without reminding future scheduled interviews', async () => {
    const { sut, tx } = setup();
    await sut.getWorkbench(user);
    const feedback = (tx.talentInterview.count.mock.calls as any[])[1][0];
    expect(feedback).toEqual({ where: {
      participants: { some: { userId: user.id } }, status: { not: 'cancelled' },
      OR: [{ application: null }, { application: { stage: { in: ['screening', 'interviewing', 'reserve'] } } }],
      AND: [{ OR: [{ status: 'completed' }, { endsAt: { lte: now } }] }],
      feedback: { none: { userId: user.id, status: 'submitted' } },
    } });
    const query = (tx.talentInterview.findMany.mock.calls as any[])[1][0];
    expect(query.where).toEqual(feedback.where);
    expect(query.orderBy).toEqual([{ startsAt: 'asc' }, { id: 'asc' }]);
  });

  it('returns only interview ID, name snapshot and time to an interview-only employee', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: [] });
    tx.talentInterview.count.mockResolvedValue(1);
    tx.talentInterview.findMany.mockResolvedValue([{ id: 'invitation', candidateId: 'secret-candidate',
      applicationId: 'secret-app', candidateNameSnapshot: 'Interview snapshot', startsAt: now,
      application: { positionName: 'Secret position' }, feedback: [{ summary: 'Secret opinion' }] }]);
    const result = await sut.getWorkbench(user);
    expect(result.groups).toEqual([
      { key: 'interview', total: 1, items: [{ id: 'invitation', title: 'Interview snapshot', subtitle: '待参加面试', date: now.toISOString() }] },
      { key: 'feedback', total: 1, items: [{ id: 'invitation', title: 'Interview snapshot', subtitle: '待本人反馈', date: now.toISOString() }] },
    ]);
    for (const [query] of tx.talentInterview.findMany.mock.calls as any[]) {
      expect(query.select).toEqual({ id: true, candidateNameSnapshot: true, startsAt: true });
    }
  });

  it('retains exact interview application identity only for recruitment readers', async () => {
    const { sut, tx } = setup({ hrCapabilities: ['employee_archive_review'] });
    tx.talentInterview.count.mockResolvedValue(1);
    tx.talentInterview.findMany.mockResolvedValue([{ id: 'invitation', candidateId: 'candidate', applicationId: 'position-two',
      candidateNameSnapshot: 'Snapshot', startsAt: now, application: { positionName: 'Position two' } }]);
    const result = await sut.getWorkbench(user);
    expect(result.groups.map(group => group.key)).toEqual(['interview', 'feedback']);
    expect(result.groups[0].items[0]).toEqual({ id: 'invitation', title: 'Snapshot', subtitle: 'Position two',
      candidateId: 'candidate', applicationId: 'position-two', date: now.toISOString() });
    expect(tx.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['hr', [], true], ['system_admin', [], false],
    ['employee', ['talent_hiring_confirm'], true], ['hr_user', ['employee_archive_review'], false],
  ])('keeps narrow hiring confirmation authority for %s with %j', async (sysRole, hrCapabilities, expected) => {
    const { sut, tx } = setup({ sysRole, hrCapabilities });
    const result = await sut.getWorkbench(user);
    expect(result.groups.some(group => group.key === 'hiring_review')).toBe(expected);
    const queries = (tx.talentApplication.count.mock.calls as any[]).filter(([query]) => query.where.stage === 'hiring_review');
    expect(queries).toHaveLength(expected ? 1 : 0);
    if (expected) expect(queries[0][0].where).toEqual({ stage: 'hiring_review', hiringRequestedById: { not: user.id } });
  });

  it('links hiring and onboarding to the exact application, not a different position on the candidate', async () => {
    const { sut, tx } = setup({ sysRole: 'hr' });
    tx.talentApplication.count.mockResolvedValue(1);
    tx.talentApplication.findMany.mockResolvedValue([{ id: 'position-two', candidateId: 'candidate',
      candidate: { name: 'Candidate' }, positionName: 'Position two', hiringRequestedAt: now, expectedEntryDate: new Date('2026-12-02') }]);
    const result = await sut.getWorkbench(user);
    expect(result.groups.find(group => group.key === 'hiring_review')?.items[0]).toEqual({ id: 'position-two',
      applicationId: 'position-two', candidateId: 'candidate', title: 'Candidate', subtitle: 'Position two', date: now.toISOString() });
    expect(result.groups.find(group => group.key === 'onboarding')?.items[0]).toEqual({ id: 'position-two',
      applicationId: 'position-two', candidateId: 'candidate', title: 'Candidate', subtitle: 'Position two', date: '2026-12-02' });
  });

  it('excludes accepted applications with any active candidate intake, including legacy and other-position intakes', async () => {
    const { sut, tx } = setup();
    await sut.getWorkbench(user);
    const where = { stage: 'accepted', ownerId: user.id, candidate: { deletedAt: null,
      OR: [{ convertedUserId: null }, { convertedUserId: { notIn: [] } }],
      onboardingRequests: { none: { archivedAt: null, cancelledAt: null, onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] } } } } };
    expect(tx.talentApplication.count).toHaveBeenCalledWith({ where });
    expect(tx.talentApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({ where,
      orderBy: [{ expectedEntryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }] }));
  });

  it('blocks only missing, deleted, disabled, current workers or approved current employment and retains pending recovery', async () => {
    const { sut, tx } = setup();
    const ids = ['missing', 'deleted', 'disabled', 'active', 'probation', 'approved-current', 'pending-recovery', 'resigned'];
    tx.talentCandidate.findMany.mockImplementation(async ({ select }: any) => select.convertedUserId
      ? ids.map(convertedUserId => ({ convertedUserId })) : []);
    tx.user.findMany.mockResolvedValue([
      ...['deleted', 'disabled', 'active', 'probation', 'pending-recovery', 'resigned'].map(id => ({
        id, status: id === 'pending-recovery' ? 'pending_entry' : ['disabled', 'active', 'probation'].includes(id) ? id : 'resigned',
        deletedAt: id === 'deleted' ? now : null, employmentHistory: [],
      })),
      { id: 'approved-current', status: 'resigned', deletedAt: null, employmentHistory: [
        { id: 'employment', effectiveFrom: new Date('2026-01-01'), effectiveTo: null, createdAt: now, employeeStatus: 'active' },
      ] },
    ]);
    await sut.getWorkbench(user);
    const query = (tx.user.findMany.mock.calls as any[])[0][0];
    expect(query.where).toEqual({ id: { in: ids } });
    expect(query.select.employmentHistory.where.AND[0].OR).toContainEqual({ sourceRequestId: null });
    expect(query.select.employmentHistory.where.AND[1]).toEqual({ effectiveFrom: { lte: new Date('2026-11-22') },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date('2026-11-22') } }] });
    expect(tx.talentApplication.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      stage: 'accepted', candidate: expect.objectContaining({ OR: [{ convertedUserId: null }, { convertedUserId: {
        notIn: ['missing', 'deleted', 'disabled', 'active', 'probation', 'approved-current'],
      } }] }),
    }) });
  });

  it('counts all matching rows independently of the stable first-five selection in every group', async () => {
    const { sut, tx, prisma } = setup({ sysRole: 'hr' });
    for (const delegate of [tx.talentCandidate, tx.talentInterview, tx.talentApplication]) {
      delegate.count.mockResolvedValue(9);
    }
    tx.talentCandidate.findMany.mockImplementation(async ({ select }: any) => select.convertedUserId ? []
      : Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, name: 'Candidate', followUps: [] })));
    tx.talentInterview.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `i${index}`, candidateNameSnapshot: 'Snapshot', startsAt: now })));
    tx.talentApplication.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, candidateId: 'candidate', candidate: { name: 'Candidate' }, positionName: 'Position' })));
    const result = await sut.getWorkbench(user);
    expect(result.groups.map(group => group.key)).toEqual(['follow_up', 'interview', 'feedback', 'hiring_review', 'onboarding']);
    for (const group of result.groups) {
      expect(group.total).toBe(9);
      expect(group.items).toHaveLength(5);
    }
    for (const delegate of [tx.talentCandidate, tx.talentInterview, tx.talentApplication]) {
      for (const [query] of delegate.findMany.mock.calls as any[]) if (!query.select.convertedUserId) expect(query.take).toBe(5);
      for (const [query] of delegate.count.mock.calls as any[]) expect(Object.keys(query)).toEqual(['where']);
    }
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    const hiring = (tx.talentApplication.findMany.mock.calls as any[]).find(([query]) => query.where.stage === 'hiring_review')[0];
    expect(hiring.orderBy).toEqual([{ hiringRequestedAt: 'asc' }, { id: 'asc' }]);
  });

  it('propagates source read failures instead of returning a misleading empty queue', async () => {
    const { sut, tx } = setup();
    tx.talentInterview.count.mockRejectedValue(new Error('source unavailable'));
    await expect(sut.getWorkbench(user)).rejects.toThrow('source unavailable');
  });
});
