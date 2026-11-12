import { TalentFollowUpsService } from './talent-follow-ups.service';
import type { AuthUser } from '@/common/types/auth.types';

/** 跟进规则（T4）：同事务回写 last_follow_up_at；列表倒序附记录人姓名。 */

const HR: AuthUser = {
  id: 'hr-1', name: '姚瑶', sysRole: 'hr' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};

function setup() {
  const prisma = {
    talentFollowUp: { create: jest.fn(), findMany: jest.fn() },
    talentCandidate: { updateMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const talents = { findActive: jest.fn().mockResolvedValue({ id: 'cand-1' }) };
  const sut = new TalentFollowUpsService(prisma as never, talents as never);
  return { prisma, sut };
}

describe('TalentFollowUpsService', () => {
  it('新增跟进与 last_follow_up_at 回写在同一事务，occurredAt 缺省为今天', async () => {
    const { prisma, sut } = setup();
    const tx = {
      talentFollowUp: { create: jest.fn().mockResolvedValue({ id: 'fu-1' }) },
      talentCandidate: { updateMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    const result = await sut.create('cand-1', { channel: 'phone', summary: '电话沟通' } as never, HR);
    expect(result).toEqual({ id: 'fu-1' });
    const data = tx.talentFollowUp.create.mock.calls[0][0].data;
    expect(data.occurredAt).toEqual(new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`));
    expect(data.nextFollowUpAt).toBeNull();
    expect(tx.talentCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', deletedAt: null, OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: data.occurredAt } }] },
      data: { lastFollowUpAt: data.occurredAt, updatedById: 'hr-1' },
    });
  });

  it('显式日期与下次跟进日期按 YYYY-MM-DD 解析', async () => {
    const { prisma, sut } = setup();
    const tx = {
      talentFollowUp: { create: jest.fn().mockResolvedValue({ id: 'fu-2' }) },
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
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    }));
    expect(rows[0]).toMatchObject({ createdByName: '姚瑶' });
    expect(rows[1]).toMatchObject({ createdByName: '郑冠宇' });
  });
});
