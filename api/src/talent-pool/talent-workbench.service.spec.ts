import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentWorkbenchService } from './talent-workbench.service';
import { PaginationDto } from '@/common/dto/pagination.dto';

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
    recruitmentIntake: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    recruitmentDemand: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = { $transaction: jest.fn().mockImplementation(fn => fn(tx)) };
  return { sut: new TalentWorkbenchService(prisma as never), tx, prisma, actor };
}

describe('recruitment workbench read projection', () => {
  it('hands accepted applications to personnel editors regardless of recruitment ownership', async () => {
    const { sut, tx } = setup();
    tx.talentApplication.count.mockResolvedValue(8);
    tx.talentApplication.findMany.mockImplementation(async ({ where }: any) => where.stage === 'accepted' ? [{
      id: 'accepted-other-owner', candidateId: 'candidate', positionName: 'Synthetic position',
      candidate: { name: 'Synthetic candidate' }, expectedEntryDate: new Date('2026-11-25'),
    }] : []);
    const handoff = (await sut.getWorkbench(user)).groups.find(group => group.key as string === 'onboarding_handoff');
    expect(handoff).toMatchObject({ total: 8, items: [{ id: 'accepted-other-owner', applicationId: 'accepted-other-owner',
      candidateId: 'candidate', title: 'Synthetic candidate', subtitle: 'Synthetic position', date: '2026-11-25' }] });
    const query = (tx.talentApplication.findMany.mock.calls as any[]).find(([q]) => q.where.stage === 'accepted')[0];
    expect(query.where).not.toHaveProperty('ownerId');
    expect(query.where.candidate.onboardingRequests.none).toEqual({ archivedAt: null, cancelledAt: null,
      onboardingStatus: { in: ['draft', 'submitted', 'pending_entry'] } });
    expect(query.select).not.toHaveProperty('events');
    expect(query.select.candidate.select).toEqual({ name: true });
  });

  it('paginates the same handoff scope and removes an accepted source as soon as active onboarding exists', async () => {
    const { sut, tx } = setup();
    let active = false;
    tx.talentApplication.count.mockImplementation(async ({ where }: any) => where.candidate.onboardingRequests.none && active ? 0 : 1);
    tx.talentApplication.findMany.mockImplementation(async ({ where }: any) => where.candidate.onboardingRequests.none && active ? [] : [{
      id: 'source', candidateId: 'candidate', candidate: { name: 'Synthetic' }, positionName: 'Position', expectedEntryDate: null,
    }]);
    const query = Object.assign(new PaginationDto(), { page: 2, pageSize: 10 });
    expect(await sut.listOnboardingHandoff(query, user)).toMatchObject({ total: 1, page: 2, pageSize: 10,
      items: [{ applicationId: 'source', candidateId: 'candidate' }] });
    expect(tx.talentApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    active = true;
    expect(await sut.listOnboardingHandoff(query, user)).toMatchObject({ total: 0, items: [] });
  });

  it.each(['recruitment_edit', 'recruitment_demand_review', 'employee_archive_review'])('rejects direct handoff-list reads by %s', async capability => {
    const { sut, tx } = setup({ sysRole: 'hr_user', hrCapabilities: [capability] });
    await expect(sut.listOnboardingHandoff(new PaginationDto(), user)).rejects.toThrow(ForbiddenException);
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
    expect(tx.talentCandidate.findMany).not.toHaveBeenCalled();
  });

  it.each([['recruitment_edit'], ['recruitment_demand_review'], ['talent_hiring_confirm'], ['employee_archive_review']])(
    'does not grant an onboarding handoff to narrow capability %j', async capability => {
      const { sut, tx } = setup({ sysRole: 'hr_user', hrCapabilities: [capability] });
      const { groups } = await sut.getWorkbench(user);
      expect(groups.some(group => group.key === 'onboarding_handoff')).toBe(false);
      expect((tx.talentApplication.count.mock.calls as any[]).some(([q]) => q.where.stage === 'accepted')).toBe(false);
    });

  it('projects local independent demand reviews without candidate or resume access', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_demand_review'] });
    tx.recruitmentDemand.count.mockResolvedValue(7);
    tx.recruitmentDemand.findMany.mockResolvedValue([{ id: 'demand', rawPosition: 'Synthetic position', rawDepartment: 'Synthetic department', updatedAt: now }]);
    const { groups } = await sut.getWorkbench(user);
    expect(groups.find(group => group.key as string === 'demand_review')).toMatchObject({ total: 7,
      items: [{ id: 'demand', demandId: 'demand', title: 'Synthetic position', subtitle: 'Synthetic department', date: now.toISOString() }] });
    expect(tx.recruitmentDemand.count).toHaveBeenCalledWith({ where: {
      sourceKind: 'local', sourceState: 'pending', submittedById: { not: user.id },
    } });
    expect(tx.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(tx.talentApplication.findMany).not.toHaveBeenCalled();
    expect(tx.recruitmentDemand.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5,
      select: { id: true, rawPosition: true, rawDepartment: true, updatedAt: true } }));
    expect(groups.some(group => group.key as string === 'demand_returned')).toBe(false);
  });

  it('returns rejected local demands only to their current submitting editor, never an implied approver', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    tx.recruitmentDemand.count.mockResolvedValue(2);
    tx.recruitmentDemand.findMany.mockResolvedValue([{ id: 'returned', rawPosition: 'Position', rawDepartment: 'Department', updatedAt: now }]);
    const { groups } = await sut.getWorkbench(user);
    expect(groups.find(group => group.key as string === 'demand_returned')?.total).toBe(2);
    expect(groups.some(group => group.key as string === 'demand_review')).toBe(false);
    expect(tx.recruitmentDemand.count).toHaveBeenCalledWith({ where: {
      sourceKind: 'local', sourceState: 'rejected', submittedById: user.id,
    } });
    expect((tx.recruitmentDemand.findMany.mock.calls as any[])[0][0].where)
      .toEqual((tx.recruitmentDemand.count.mock.calls as any[])[0][0].where);
  });

  it('samples overdue and Shanghai-today follow-ups before future plans across bounded pages', async () => {
    jest.setSystemTime(new Date('2026-11-21T16:01:00Z'));
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const candidate = (id: string, date: string | null) => ({ id, name: id,
      followUps: date ? [{ nextFollowUpAt: new Date(date) }] : [] });
    const rows = [...Array.from({ length: 100 }, (_, index) => candidate(`future-${index}`, '2026-12-01')),
      candidate('today', '2026-11-22'), candidate('yesterday', '2026-11-21'),
      candidate('oldest', '2026-11-20'), candidate('first-contact', null), candidate('tomorrow', '2026-11-23')];
    tx.talentCandidate.count.mockResolvedValue(105);
    tx.talentCandidate.findMany.mockImplementation(async ({ skip = 0, take }: any) => rows.slice(skip, skip + take));
    const group = (await sut.getWorkbench(user)).groups.find(item => item.key === 'follow_up');
    expect(group?.total).toBe(105);
    expect(group?.items.map(item => item.id)).toEqual(['oldest', 'yesterday', 'today', 'first-contact', 'tomorrow']);
    expect(tx.talentCandidate.findMany).toHaveBeenCalledTimes(2);
    for (const [query] of tx.talentCandidate.findMany.mock.calls as any[]) {
      expect(query.take).toBeLessThanOrEqual(100);
      expect(query.take).toBeGreaterThan(5);
      expect(query.where).toEqual((tx.talentCandidate.count.mock.calls as any[])[0][0].where);
    }
  });

  it('gives explicit operators their follow-ups but no onboarding or hiring-confirmation queue', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const result = await sut.getWorkbench(user);
    expect(result.groups.map(group => group.key)).toEqual(['follow_up', 'intake_assignment', 'intake_review', 'interview', 'feedback', 'entry_overdue', 'demand_returned']);
    expect(tx.talentApplication.count).not.toHaveBeenCalled();
    expect(tx.talentApplication.findMany).toHaveBeenCalledTimes(1);
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

  it.each(['hr', 'system_admin'])('keeps %s follow-ups and interviews personal while onboarding follows handling authority', async sysRole => {
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
      where: expect.objectContaining({ stage: 'accepted' }),
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
    const query = (tx.talentCandidate.findMany.mock.calls as any[]).find(([q]) => q.select.followUps)[0];
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
    expect(result.groups.map(group => group.key)).toEqual(['interview', 'feedback', 'entry_overdue']);
    expect(result.groups[0].items[0]).toEqual({ id: 'invitation', title: 'Snapshot', subtitle: 'Position two',
      candidateId: 'candidate', applicationId: 'position-two', date: now.toISOString() });
    expect(tx.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(tx.talentApplication.findMany).toHaveBeenCalledTimes(1);
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
    expect(result.groups.find(group => group.key === 'onboarding_handoff')?.items[0]).toEqual({ id: 'position-two',
      applicationId: 'position-two', candidateId: 'candidate', title: 'Candidate', subtitle: 'Position two', date: '2026-12-02' });
  });

  it('excludes accepted applications with any active candidate intake, including legacy and other-position intakes', async () => {
    const { sut, tx } = setup();
    await sut.getWorkbench(user);
    const where = { stage: 'accepted', candidate: { deletedAt: null,
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
    for (const delegate of [tx.talentCandidate, tx.talentInterview, tx.talentApplication, tx.recruitmentIntake, tx.recruitmentDemand]) {
      delegate.count.mockResolvedValue(9);
    }
    tx.talentCandidate.findMany.mockImplementation(async ({ select }: any) => select.convertedUserId ? []
      : Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, name: 'Candidate', followUps: [] })));
    tx.talentInterview.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `i${index}`, candidateNameSnapshot: 'Snapshot', startsAt: now })));
    tx.talentApplication.findMany.mockImplementation(async ({ where }: any) => Array.from({ length: where.stage?.in ? 9 : 5 }, (_, index) => ({
      id: `a${index}`, candidateId: 'candidate', ownerId: user.id, candidate: { name: 'Candidate', deletedAt: null }, positionName: 'Position',
      stage: 'accepted', expectedEntryDate: new Date('2026-11-20'), onboardingRequests: [],
    })));
    tx.recruitmentIntake.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, positionName: 'Position', state: 'pending_review' })));
    tx.recruitmentDemand.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `d${index}`, rawPosition: 'Position', rawDepartment: 'Department', updatedAt: now })));
    const result = await sut.getWorkbench(user);
    expect(result.groups.map(group => group.key)).toEqual(['follow_up', 'intake_assignment', 'intake_review', 'interview', 'feedback', 'hiring_review', 'onboarding_handoff', 'entry_overdue', 'demand_returned']);
    for (const group of result.groups) {
      expect(group.total).toBe(9);
      expect(group.items).toHaveLength(5);
    }
    for (const delegate of [tx.talentCandidate, tx.talentInterview, tx.talentApplication, tx.recruitmentIntake]) {
      for (const [query] of delegate.findMany.mock.calls as any[]) if (!query.select.convertedUserId && !query.where.stage?.in) expect(query.take).toBe(delegate === tx.talentCandidate ? 100 : 5);
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

  it('projects disjoint personal open intake queues without selecting original materials', async () => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'], name: 'Operator' });
    tx.recruitmentIntake.count.mockResolvedValue(7);
    tx.recruitmentIntake.findMany.mockResolvedValue([{ id: 'intake', positionName: null, state: 'needs_material', nextFollowUpAt: null }]);
    const { groups } = await sut.getWorkbench(user);
    for (const key of ['intake_assignment', 'intake_review']) {
      const group = groups.find(item => item.key as string === key);
      expect(group?.total).toBe(7);
      expect(group?.items[0]).toMatchObject({ id: 'intake', intakeId: 'intake', ownerName: 'Operator' });
    }
    const calls = tx.recruitmentIntake.findMany.mock.calls as any[];
    expect(calls).toHaveLength(2);
    for (const [index, [query]] of calls.entries()) {
      expect(query.where).toEqual({ ownerId: user.id, associatedToId: null,
        state: { in: index === 0 ? ['awaiting_resume', 'pending_review', 'needs_material'] : ['pending_review', 'needs_material'] },
        demandId: index === 0 ? null : { not: null },
      });
      expect(query.select).toEqual({ id: true, positionName: true, state: true, nextFollowUpAt: true });
      expect(query.take).toBe(5);
      expect(query.where).toEqual((tx.recruitmentIntake.count.mock.calls as any[])[index][0].where);
    }
  });

  it.each([
    ['employee', []], ['employee', ['talent_hiring_confirm']], ['hr_user', ['recruitment_view']],
    ['hr_user', ['employee_archive_review']],
  ])('does not expose intake queues to %s with %j', async (sysRole, hrCapabilities) => {
    const { sut, tx } = setup({ sysRole, hrCapabilities });
    const { groups } = await sut.getWorkbench(user);
    expect(groups.some(group => group.key.startsWith('intake_'))).toBe(false);
    expect(tx.recruitmentIntake.findMany).not.toHaveBeenCalled();
  });

  it('keeps admin intake reminders owner-only and fails visibly if intake reads fail', async () => {
    const { sut, tx } = setup({ sysRole: 'system_admin', hrCapabilities: [] });
    tx.recruitmentIntake.count.mockRejectedValue(new Error('intake source unavailable'));
    await expect(sut.getWorkbench(user)).rejects.toThrow('intake source unavailable');
    for (const [query] of tx.recruitmentIntake.count.mock.calls as any[]) expect(query.where.ownerId).toBe(user.id);
  });

  it('uses Shanghai business day and current onboarding dates, excluding finished, invalid and rescheduled arrivals', async () => {
    jest.setSystemTime(new Date('2026-11-21T16:01:00Z'));
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const application = (id: string, overrides: any = {}) => ({ id, candidateId: `c-${id}`, ownerId: user.id, stage: 'accepted',
      candidate: { name: 'Synthetic', deletedAt: null }, positionName: 'Position', expectedEntryDate: new Date('2026-11-21'), onboardingRequests: [], ...overrides });
    const request = (date: string, overrides: any = {}) => ({ id: 'request', intakeType: 'new_hire', onboardingStatus: 'pending_entry', recordStatus: 'submitted',
      cancelledAt: null, archivedAt: null, arrivalConfirmedAt: null, proposedValue: { employee: { effectiveFrom: date } }, ...overrides });
    tx.talentApplication.findMany.mockImplementation(async ({ where }: any) => where.stage?.in ? [
      application('late'), application('today', { expectedEntryDate: new Date('2026-11-22') }),
      application('missing', { expectedEntryDate: null }), application('invalid', { expectedEntryDate: new Date('invalid') }),
      application('deleted', { candidate: { name: 'Synthetic', deletedAt: now } }),
      application('hired', { stage: 'hired' }), application('terminated', { stage: 'withdrawn' }),
      application('rescheduled', { stage: 'onboarding', onboardingRequests: [request('2026-12-01')] }),
      application('arrived', { stage: 'onboarding', onboardingRequests: [request('2026-11-20', { arrivalConfirmedAt: now })] }),
      application('effective', { stage: 'onboarding', onboardingRequests: [request('2026-11-20', { onboardingStatus: 'effective' })] }),
      application('bad-intake-date', { stage: 'onboarding', onboardingRequests: [request('2026-02-30')] }),
      application('onboarding-late', { stage: 'onboarding', expectedEntryDate: new Date('2026-12-01'), onboardingRequests: [request('2026-11-20')] }),
    ] : []);
    const group = (await sut.getWorkbench(user)).groups.find(group => group.key as string === 'entry_overdue');
    expect(group?.total).toBe(2);
    expect(group?.items.map(row => row.applicationId)).toEqual(['onboarding-late', 'late']);
    expect(group?.items[0]).toMatchObject({ candidateId: 'c-onboarding-late', date: '2026-11-20' });
    expect(group?.items[0]).not.toHaveProperty('onboardingRequestId');
    const query = (tx.talentApplication.findMany.mock.calls as any[]).find(([q]) => q.where.stage?.in)[0];
    expect(query.where).toMatchObject({ stage: { in: ['accepted', 'onboarding'] }, candidate: { deletedAt: null }, AND: [{ ownerId: user.id }] });
  });

  it('lets personnel reviewers locate the original active intake without giving narrow roles an arrival queue', async () => {
    const { sut, tx } = setup({ hrCapabilities: ['employee_archive_review'] });
    tx.talentApplication.findMany.mockResolvedValue([{ id: 'app', candidateId: 'candidate', ownerId: 'other', stage: 'onboarding',
      candidate: { name: 'Synthetic', deletedAt: null }, positionName: 'Position', expectedEntryDate: now,
      onboardingRequests: [{ id: 'original-intake', intakeType: 'new_hire', onboardingStatus: 'pending_entry', recordStatus: 'submitted',
        cancelledAt: null, archivedAt: null, arrivalConfirmedAt: null, proposedValue: { employee: { effectiveFrom: '2026-11-20' } } }] }]);
    const group = (await sut.getWorkbench(user)).groups.find(group => group.key as string === 'entry_overdue');
    expect(group?.items[0]).toMatchObject({ applicationId: 'app', onboardingRequestId: 'original-intake' });
    const scope = (tx.talentApplication.findMany.mock.calls as any[])[0][0].where.AND[0];
    expect(scope.onboardingRequests.some.AND).toContainEqual({ OR: [
      { sourceSystem: null }, { sourceSystem: { not: 'archive_assistant_pilot' } }, { createdById: user.id },
    ] });
    for (const capabilities of [[], ['recruitment_view'], ['talent_hiring_confirm']]) {
      const narrow = setup({ sysRole: 'employee', hrCapabilities: capabilities });
      expect((await narrow.sut.getWorkbench(user)).groups.some(g => g.key as string === 'entry_overdue')).toBe(false);
    }
  });

  it('does not deep-link another authors restricted archive pilot intake even on an owned application', async () => {
    const { sut, tx } = setup();
    tx.talentApplication.findMany.mockImplementation(async ({ where }: any) => where.stage?.in ? [{
      id: 'app', ownerId: user.id, candidateId: 'candidate', stage: 'onboarding', candidate: { name: 'Synthetic', deletedAt: null },
      positionName: 'Position', expectedEntryDate: new Date('2026-11-20'), onboardingRequests: [{
        id: 'private-pilot', sourceSystem: 'archive_assistant_pilot', createdById: 'another-author', intakeType: 'new_hire',
        onboardingStatus: 'submitted', recordStatus: 'submitted', archivedAt: null, cancelledAt: null, arrivalConfirmedAt: null,
        proposedValue: { employee: { effectiveFrom: '2026-11-20' } },
      }],
    }] : []);
    const group = (await sut.getWorkbench(user)).groups.find(group => group.key === 'entry_overdue');
    expect(group?.items[0]).toMatchObject({ applicationId: 'app' });
    expect(group?.items[0]).not.toHaveProperty('onboardingRequestId');
  });

  it.each(['new_hire', 'reentry'])('reads the actual serialized %s intake date and respects subsequent rescheduling', async intakeType => {
    const { sut, tx } = setup({ sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    const dateField = intakeType === 'reentry' ? 'effectiveDate' : 'effectiveFrom';
    let planned = new Date('2026-11-20').toISOString();
    tx.talentApplication.findMany.mockImplementation(async () => [{ id: 'app', candidateId: 'candidate', ownerId: user.id,
      stage: 'onboarding', candidate: { name: 'Synthetic', deletedAt: null }, positionName: 'Position', expectedEntryDate: new Date('2026-12-01'),
      onboardingRequests: [{ id: 'request', intakeType, onboardingStatus: 'submitted', recordStatus: 'submitted',
        archivedAt: null, cancelledAt: null, arrivalConfirmedAt: null, proposedValue: { employee: { [dateField]: planned } } }],
    }]);
    const read = async () => (await sut.getWorkbench(user)).groups.find(group => group.key === 'entry_overdue');
    expect((await read())?.items[0]?.date).toBe('2026-11-20');
    planned = new Date('2026-12-03').toISOString();
    expect((await read())?.total).toBe(0);
  });
});
