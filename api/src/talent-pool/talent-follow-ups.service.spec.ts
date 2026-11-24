import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import type { AuthUser } from '@/common/types/auth.types';

/** 跟进规则（T4）：同事务回写 last_follow_up_at；列表倒序附记录人姓名。 */

const HR: AuthUser = {
  id: 'hr-1', name: 'Synthetic HR', sysRole: 'hr' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};

function setup() {
  const prisma = {
    talentFollowUp: { create: jest.fn(), findMany: jest.fn() },
    talentCandidate: { updateMany: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...HR, status: 'active' }) },
    $transaction: jest.fn(),
  };
  const talents = { findActive: jest.fn().mockResolvedValue({ id: 'cand-1' }) };
  const sut = new TalentFollowUpsService(prisma as never, talents as never);
  return { prisma, sut };
}

describe('TalentFollowUpsService', () => {
  afterEach(() => jest.useRealTimers());

  function pendingPlan() {
    const { prisma, sut } = setup();
    const old = { id: 'prior', occurredAt: new Date('2026-11-10'), planStatus: 'pending' };
    const tx = {
      user: prisma.user,
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'cand-1' }]),
      talentFollowUp: { findFirst: jest.fn().mockResolvedValue(old),
        create: jest.fn(async ({ data }) => ({ id: 'saved', ...data })),
        update: jest.fn(async ({ data }) => ({ ...old, ...data })) },
      auditLog: { create: jest.fn() }, talentCandidate: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation(fn => fn(tx));
    const input = { channel: 'phone', summary: 'Synthetic communication', occurredAt: '2026-11-11', expectedPlanId: old.id };
    return { tx, sut, old, input };
  }

  it('retains a pending plan when recording an ordinary note or an older dated communication', async () => {
    const { sut, tx, input } = pendingPlan();
    await expect(sut.create('cand-1', input, HR)).resolves.toMatchObject({ planStatus: 'none' });
    await expect(sut.create('cand-1', { ...input, occurredAt: '2026-11-09', nextFollowUpAt: '2026-12-01' }, HR))
      .resolves.toMatchObject({ planStatus: 'superseded', planClosedAt: expect.any(Date), planClosedById: HR.id });
    expect(tx.talentFollowUp.update).not.toHaveBeenCalled();
  });

  it.each(['completed', 'superseded'])('closes the prior plan as %s and creates the new pending plan', async status => {
    const { sut, tx, old, input } = pendingPlan();
    const change = { ...input, ...(status === 'completed' ? { completePlanId: old.id } : {}), nextFollowUpAt: '2027-01-01' };
    await expect(sut.create('cand-1', change, HR)).resolves.toMatchObject({ planStatus: 'pending' });
    expect(tx.talentFollowUp.update).toHaveBeenCalledWith({ where: { id: old.id }, data: {
      planStatus: status, planClosedAt: expect.any(Date), planClosedById: HR.id } });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('rejects stale expected IDs including null and outdated completion attempts without writes', async () => {
    const { sut, tx, input } = pendingPlan();
    for (const changed of [{ expectedPlanId: null }, { expectedPlanId: 'other' }, { completePlanId: 'wrong' }]) {
      await expect(sut.create('cand-1', { ...input, ...changed }, HR)).rejects.toBeInstanceOf(ConflictException);
    }
    await expect(sut.create('cand-1', { ...input, completePlanId: input.expectedPlanId, occurredAt: '2026-11-09' }, HR))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.talentFollowUp.create).not.toHaveBeenCalled();
    expect(tx.talentFollowUp.update).not.toHaveBeenCalled();
  });

  it('cancels only the identified pending plan on an active candidate, without adding communication', async () => {
    const { sut, tx, old } = pendingPlan();
    await expect(sut.cancel('cand-1', 'wrong', HR)).rejects.toBeInstanceOf(ConflictException);
    await expect(sut.cancel('cand-1', old.id, HR)).resolves.toMatchObject({ id: old.id, planStatus: 'cancelled' });
    tx.$queryRaw.mockResolvedValue([]);
    await expect(sut.create('cand-1', { channel: 'phone', summary: 'note' }, HR)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.talentFollowUp.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('新增跟进与 last_follow_up_at 回写在同一事务，occurredAt 缺省为今天', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T17:00:00.000Z'));
    const { prisma, sut } = setup();
    const tx = {
      user: prisma.user,
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'cand-1' }]),
      talentFollowUp: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'fu-1' }) },
      talentCandidate: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    const result = await sut.create('cand-1', { channel: 'phone', summary: '电话沟通' } as never, HR);
    expect(result).toEqual({ id: 'fu-1' });
    const data = tx.talentFollowUp.create.mock.calls[0][0].data;
    expect(data.occurredAt).toEqual(new Date('2026-11-13T00:00:00.000Z'));
    expect(data.nextFollowUpAt).toBeNull();
    expect(tx.talentCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', deletedAt: null, OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: data.occurredAt } }] },
      data: { lastFollowUpAt: data.occurredAt, updatedById: 'hr-1' },
    });
  });

  it('显式日期与下次跟进日期按 YYYY-MM-DD 解析', async () => {
    const { prisma, sut } = setup();
    const tx = {
      user: prisma.user,
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'cand-1' }]), auditLog: { create: jest.fn() },
      talentFollowUp: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'fu-2' }) },
      talentCandidate: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    await sut.create('cand-1', {
      channel: 'wechat', summary: '微信聊了到岗时间',
      occurredAt: '2026-11-08', nextFollowUpAt: '2026-11-20',
    } as never, HR);
    const data = tx.talentFollowUp.create.mock.calls[0][0].data;
    expect(data.occurredAt).toEqual(new Date('2026-11-08T00:00:00.000Z'));
    expect(data.nextFollowUpAt).toEqual(new Date('2026-11-20T00:00:00.000Z'));
    expect(tx.talentCandidate.updateMany.mock.calls[0][0].data.lastFollowUpAt)
      .toEqual(new Date('2026-11-08T00:00:00.000Z'));
  });

  it('列表倒序并关联记录人姓名', async () => {
    const { prisma, sut } = setup();
    prisma.talentFollowUp.findMany.mockResolvedValue([
      { id: 'fu-1', createdById: 'hr-1', summary: '第一次' },
      { id: 'fu-2', createdById: 'mgr-1', summary: '第二次' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'hr-1', name: '姚瑶' },
      { id: 'mgr-1', name: '郑冠宇' },
    ]);
    const rows = await sut.list('cand-1');
    expect(prisma.talentFollowUp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { candidateId: 'cand-1' },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(rows[0]).toMatchObject({ createdByName: '姚瑶' });
    expect(rows[1]).toMatchObject({ createdByName: '郑冠宇' });
  });
});
