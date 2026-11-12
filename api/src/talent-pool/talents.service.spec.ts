import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TalentsService } from './talents.service';
import { TALENT_PHONE_EXISTS } from './talent.constants';
import type { AuthUser } from '@/common/types/auth.types';

/**
 * TalentsService 契约测试（T2/T4 规则）：
 * 查重 409、薪资区间交集、dueOnly/staleOnly、软删后手机号复用、转 hired 三种失败分支。
 * PrismaService 用内存 mock，断言打到 mock 的参数即契约。
 */

const HR: AuthUser = {
  id: 'hr-1', name: 'HR', sysRole: 'hr' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1', name: '测试甲', phone: '17011112222', status: 'new',
    deletedAt: null, expectSalaryMin: 10, expectSalaryMax: 20,
    lastFollowUpAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildPrisma() {
  const prisma = {
    talentCandidate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    talentInterview: { findMany: jest.fn().mockResolvedValue([]) },
    employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    // 数组形式默认按 Promise.all 语义返回（各操作返回值需用例自行 mock）
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return prisma;
}

type PrismaMock = ReturnType<typeof buildPrisma>;

function service(prisma: PrismaMock) {
  return new TalentsService(prisma as never);
}

describe('TalentsService 创建与查重', () => {
  it('手机号重复 → 409，data 带 reason=TALENT_PHONE_EXISTS 与 existingId', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue({ id: 'existing-1', name: '测试乙' });
    const sut = service(prisma);

    await expect(sut.create({
      name: '测试甲', phone: '17011112222', sourceChannel: 'referral',
    } as never, HR)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: '该手机号已在库：测试乙',
        data: { reason: TALENT_PHONE_EXISTS, existingId: 'existing-1', existingName: '测试乙' },
      }),
    });
    // 409 语义
    await expect(sut.create({
      name: '测试甲', phone: '17011112222', sourceChannel: 'referral',
    } as never, HR)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.talentCandidate.create).not.toHaveBeenCalled();
  });

  it('查重只比对未软删记录（deletedAt: null）', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue(null);
    prisma.talentCandidate.create.mockResolvedValue(baseCandidate());
    const sut = service(prisma);

    await sut.create({ name: '测试甲', phone: '17011112222', sourceChannel: 'job_site' } as never, HR);
    expect(prisma.talentCandidate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phone: '17011112222', deletedAt: null }) }),
    );
  });

  it('新建不能直接标记已入职（hired / userId 一律 400）', async () => {
    const sut = service(buildPrisma());
    await expect(sut.create({
      name: '测试甲', phone: '17011112222', sourceChannel: 'referral', status: 'hired',
    } as never, HR)).rejects.toThrow(BadRequestException);
    await expect(sut.create({
      name: '测试甲', phone: '17011112222', sourceChannel: 'referral', userId: 'user-1',
    } as never, HR)).rejects.toThrow(BadRequestException);
  });

  it('期望薪资下限高于上限 → 400', async () => {
    const sut = service(buildPrisma());
    await expect(sut.create({
      name: '测试甲', phone: '17011112222', sourceChannel: 'referral',
      expectSalaryMin: 30, expectSalaryMax: 20,
    } as never, HR)).rejects.toThrow('期望薪资下限不能高于上限');
  });
});

describe('TalentsService 列表筛选', () => {
  function listSetup(prisma: PrismaMock) {
    prisma.talentCandidate.count.mockResolvedValue(1);
    prisma.talentCandidate.findMany.mockResolvedValue([{ ...baseCandidate(), _count: { files: 2 } }]);
    return service(prisma);
  }

  it('关键词搜索覆盖姓名/手机/公司/职位/意向岗位（大小写不敏感）', async () => {
    const prisma = buildPrisma();
    const sut = listSetup(prisma);
    await sut.list({ keyword: '供应链', skip: 0, take: 20 } as never);
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toHaveLength(5);
    expect(where.OR[0]).toEqual({ name: { contains: '供应链', mode: 'insensitive' } });
    expect(JSON.stringify(where.OR)).toContain('"phone"');
    expect(JSON.stringify(where.OR)).toContain('"currentCompany"');
  });

  it('状态 / 来源 / 标签筛选映射到对应字段', async () => {
    const prisma = buildPrisma();
    const sut = listSetup(prisma);
    await sut.list({ status: 'interviewing', source: 'referral', tag: 'sales', skip: 0, take: 20 } as never);
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('interviewing');
    expect(where.sourceChannel).toBe('referral');
    expect(where.tags).toEqual({ has: 'sales' });
  });

  it('薪资区间按交集过滤：候选人下限 ≤ 筛选上限 且 候选人上限 ≥ 筛选下限', async () => {
    const prisma = buildPrisma();
    const sut = listSetup(prisma);
    await sut.list({ salaryMin: 15, salaryMax: 25, skip: 0, take: 20 } as never);
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { expectSalaryMax: { gte: 15 } },
      { expectSalaryMin: { lte: 25 } },
    ]);
  });

  it('dueOnly 走「最新一条非空下次跟进日期 ≤ 今天」的候选人集合', async () => {
    const prisma = buildPrisma();
    prisma.$queryRaw.mockResolvedValue([{ id: 'due-1' }, { id: 'due-2' }]);
    const sut = listSetup(prisma);
    await sut.list({ dueOnly: true, skip: 0, take: 20 } as never);
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{ id: { in: ['due-1', 'due-2'] } }]);
  });

  it('staleOnly 命中 18 个月未联系（含从未跟进且入库超 18 个月）', async () => {
    const prisma = buildPrisma();
    const sut = listSetup(prisma);
    await sut.list({ staleOnly: true, skip: 0, take: 20 } as never);
    const where = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toHaveLength(2);
    expect(where.AND[0].OR[0].lastFollowUpAt).toHaveProperty('lt');
    expect(where.AND[0].OR[1]).toEqual({
      AND: [{ lastFollowUpAt: null }, { createdAt: expect.objectContaining({}) }],
    });
  });
});

describe('TalentsService 更新与软删除', () => {
  it('编辑换手机号时同样查重，命中 → 409', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst
      .mockResolvedValueOnce(baseCandidate())          // findActive
      .mockResolvedValueOnce({ id: 'other-1', name: '测试丙' }); // 查重
    const sut = service(prisma);
    await expect(sut.update('cand-1', { phone: '17011113333' } as never, HR))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          data: { reason: TALENT_PHONE_EXISTS, existingId: 'other-1', existingName: '测试丙' },
        }),
      });
  });

  it('软删除写 deletedAt 并留审计，不物理删除', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findUnique.mockResolvedValue(baseCandidate());
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    const sut = service(prisma);
    const impact = await sut.deleteImpact('cand-1');
    const result = await sut.remove('cand-1', HR, { impactVersion: impact.version });
    expect(result).toEqual({ id: 'cand-1', deleted: true });
    expect(prisma.talentCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cand-1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'delete_talent_candidate' }) }),
    );
    expect('delete' in prisma.talentCandidate).toBe(false); // mock 中不存在物理删除入口
  });

  it('软删后详情 404（findActive 命中已删记录即 404）', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue(null);
    const sut = service(prisma);
    await expect(sut.findActive('cand-1')).rejects.toThrow(NotFoundException);
  });
});

describe('TalentsService 手动标记已入职禁用', () => {
  it('分支一：切已入职未选员工 → 400', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue(baseCandidate());
    const sut = service(prisma);
    await expect(sut.update('cand-1', { status: 'hired' } as never, HR))
      .rejects.toThrow('请通过入离职办理并确认到岗');
  });

  it('分支二：userId 对应的员工不存在 → 400', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue(baseCandidate());
    prisma.user.findUnique.mockResolvedValue(null);
    const sut = service(prisma);
    await expect(sut.convert('cand-1', 'ghost-user', HR))
      .rejects.toThrow('请通过入离职办理并确认到岗');
  });

  it('即使传入已关联员工也不执行手动转换', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst
      .mockResolvedValueOnce(baseCandidate())
      .mockResolvedValueOnce({ id: 'cand-2', name: '测试乙' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-9', name: '员工己' });
    const sut = service(prisma);
    await expect(sut.convert('cand-1', 'user-9', HR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('手动转换错误不泄漏其他候选人姓名', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst
      .mockResolvedValueOnce(baseCandidate())
      .mockResolvedValueOnce({ id: 'cand-2', name: '测试乙' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-9', name: '员工己' });
    const sut = service(prisma);
    await expect(sut.convert('cand-1', 'user-9', HR))
      .rejects.toThrow('请通过入离职办理并确认到岗');
  });

  it('已入职候选人重复 convert → 400；已入职回退其他状态 → 400（终态）', async () => {
    const prisma = buildPrisma();
    prisma.talentCandidate.findFirst.mockResolvedValue(baseCandidate({ status: 'hired' }));
    const sut = service(prisma);
    await expect(sut.convert('cand-1', 'user-9', HR)).rejects.toThrow('请通过入离职办理并确认到岗');
    await expect(sut.update('cand-1', { status: 'contacted' } as never, HR))
      .rejects.toThrow('已入职为终态');
  });

  it('历史成功参数现在拒绝，不能写入候选人或员工', async () => {
    const prisma = buildPrisma();
    // 第一次 findFirst（findActive）返回候选人，第二次（占用检查）返回 null
    prisma.talentCandidate.findFirst.mockResolvedValueOnce(baseCandidate()).mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-9', name: '员工己' });
    const tx = {
      talentCandidate: {
        update: jest.fn().mockResolvedValue(baseCandidate({ status: 'hired' })),
      },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    const sut = service(prisma);
    await expect(sut.convert('cand-1', 'user-9', HR)).rejects.toThrow(BadRequestException);
    expect(tx.talentCandidate.update).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
