import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TalentSharesService, SHARE_FORBIDDEN_MESSAGE } from './talent-shares.service';
import type { AuthUser } from '@/common/types/auth.types';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateShareDto } from './dto/create-share.dto';

/**
 * 分享授权（T5，需求 §5.4）：
 * 创建（当前业务资格/通知）、被分享人视图（白名单/过期/撤销/软删统一 403）、
 * 脱敏字段白名单、includeResume 控制文件可见、撤销幂等。
 */

const HR: AuthUser = {
  id: 'hr-1', name: '姚瑶', sysRole: 'hr' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};
const MGR: AuthUser = {
  id: 'mgr-1', name: '郑冠宇', sysRole: 'manager' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};

const FORBIDDEN_MESSAGE = '链接已失效或无权查看';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1', name: '测试甲', status: 'interviewing',
    gender: 'male', birthYear: 1996,
    currentCompany: '某科技公司', currentPosition: '供应链主管',
    yearsOfExperience: 8, education: 'bachelor', school: '某大学', major: '物流管理',
    expectCity: '上海', appliedPosition: '供应链经理',
    tags: ['supply_chain', 'same_industry'],
    deletedAt: null,
    files: [{
      id: 'file-1', objectKey: 'talent-resume/2026/11/09/a.pdf',
      fileName: '简历.pdf', fileSize: 1024, mimeType: 'application/pdf',
    }],
    ...overrides,
  };
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    token: 'a'.repeat(64),
    isPublicLink: false,
    recipientIds: ['mgr-1'],
    includeResume: false,
    message: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    viewCount: 0,
    lastViewedAt: null,
    lastViewedById: null,
    createdById: 'hr-1',
    createdAt: new Date('2026-11-09T00:00:00.000Z'),
    candidate: candidate(),
    ...overrides,
  };
}

function setup(foundShare: unknown) {
  const prisma = {
    talentShare: {
      findUnique: jest.fn().mockResolvedValue(foundShare),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'mgr-1', name: '测试主管' }]), count: jest.fn() },
    employmentRecord: { findMany: jest.fn().mockResolvedValue([]) },
    talentCandidate: { findFirst: jest.fn().mockResolvedValue(candidate()) },
    notificationLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(ops => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
  const talents = { findActive: jest.fn().mockResolvedValue(candidate()) };
  const sut = new TalentSharesService(prisma as never, talents as never);
  return { prisma, sut };
}

describe('TalentSharesService 创建分享', () => {
  it('显式启用外链的新请求无需接收人，原件默认关闭且不发通知', async () => {
    const { prisma, sut } = setup(null);
    prisma.talentShare.create.mockResolvedValue({ id: 'external-1' });
    const result = await sut.create('cand-1', { isPublicLink: true, expiresInDays: 7 } as never, HR);
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.talentShare.create.mock.calls[0][0].data).toMatchObject({ isPublicLink: true, recipientIds: [], includeResume: false });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('缺少模式与接收人不能意外创建外链，进入事务前拒绝且无写入', async () => {
    const { prisma, sut } = setup(null);
    prisma.talentShare.create.mockResolvedValue({ id: 'must-not-create' });
    await expect(sut.create('cand-1', { expiresInDays: 7 } as never, HR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.talentShare.create).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('明确外链模式不能同时授予指定接收人，明确受限模式必须有接收人', async () => {
    for (const input of [{ isPublicLink: true, recipientIds: ['mgr-1'] }, { isPublicLink: false }]) {
      await expect(setup(null).sut.create('cand-1', { ...input, expiresInDays: 7 } as never, HR)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('HTTP DTO 仅允许显式启用的无接收人外链，仍拒绝空接收人和无效有效期', async () => {
    expect(await validate(plainToInstance(CreateShareDto, { isPublicLink: true, expiresInDays: 7 }))).toEqual([]);
    expect((await validate(plainToInstance(CreateShareDto, { expiresInDays: 30 }))).some(e => e.property === 'recipientIds')).toBe(true);
    for (const recipientIds of [[], null]) {
      expect((await validate(plainToInstance(CreateShareDto, { recipientIds, expiresInDays: 7 }))).some(e => e.property === 'recipientIds')).toBe(true);
    }
    expect((await validate(plainToInstance(CreateShareDto, { isPublicLink: 'true', expiresInDays: 1 }))).map(e => e.property)).toEqual(expect.arrayContaining(['isPublicLink', 'expiresInDays']));
  });
  it('接收人不存在、失去资格或已删除 → 400', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: '郑冠宇', sysRole: 'manager' }]);
    await expect(sut.create('cand-1', {
      recipientIds: ['mgr-1', 'ghost'], expiresInDays: 7,
    } as never, HR)).rejects.toThrow(BadRequestException);
  });

  it('当前资格查询未命中接收人时拒绝创建，不向旧选项发送通知', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([]);
    await expect(sut.create('cand-1', { recipientIds: ['u-1'], expiresInDays: 7 } as never, HR))
      .rejects.toThrow(BadRequestException);
    expect(prisma.talentShare.create).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ ...ELIGIBLE_RECIPIENTS, id: { in: ['u-1'] } });
  });

  it('仅按数据库当前资格创建分享，不再要求接收人返回旧sysRole，原件默认关闭', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }]);
    prisma.talentShare.create.mockResolvedValue({ id: 'share-1' });
    const before = Date.now();
    const result = await sut.create('cand-1', {
      recipientIds: ['mgr-1'], expiresInDays: 30, message: '  重点看供应链经验  ',
    } as never, HR);
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.url).toBe(`/talents/s/${result.token}`);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
    const data = prisma.talentShare.create.mock.calls[0][0].data;
    expect(data.message).toBe('重点看供应链经验'); // trim
    expect(data.includeResume).toBe(false);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ ...ELIGIBLE_RECIPIENTS, id: { in: ['mgr-1'] } });
    // 站内通知逐人一条，不发钉钉
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'mgr-1', channel: 'system', type: 'talent_share' }),
    }));
  });

  it('重复接收人不能绕过限制，也不产生分享或通知', async () => {
    const { prisma, sut } = setup(null);
    prisma.talentShare.create.mockResolvedValue({ id: 'share-duplicate' });
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: '测试主管', sysRole: 'manager' }, { id: 'mgr-1', name: '测试主管', sysRole: 'manager' }]);
    await expect(sut.create('cand-1', { recipientIds: ['mgr-1', 'mgr-1'], expiresInDays: 7 } as never, HR))
      .rejects.toThrow(BadRequestException);
    expect(prisma.talentShare.create).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('HTTP DTO 拒绝重复接收人，保留最多五人及7/30天', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const invalid = plainToInstance(CreateShareDto, { recipientIds: [id, id], expiresInDays: 7 });
    expect((await validate(invalid)).some(error => error.property === 'recipientIds')).toBe(true);
    expect(await validate(plainToInstance(CreateShareDto, { recipientIds: [id], expiresInDays: 30 }))).toEqual([]);
    expect((await validate(plainToInstance(CreateShareDto, { recipientIds: Array.from({ length: 6 }, (_, i) => id.slice(0, -1) + (i + 1)), expiresInDays: 1 }))))
      .toEqual(expect.arrayContaining([expect.objectContaining({ property: 'recipientIds' }), expect.objectContaining({ property: 'expiresInDays' })]));
  });
});

const ELIGIBLE_RECIPIENTS = {
  deletedAt: null, archivedAt: null, status: { in: ['active', 'probation'] },
  OR: [
    { sysRole: { in: ['hr', 'hr_user', 'system_admin'] } },
    { id: { in: [] as string[] } },
    { ledDepartments: { some: { isActive: true } } },
  ],
};

describe('TalentSharesService 专用接收人查询', () => {
  it('仅查询当前HR、有效直属下属的主管和启用部门负责人，分页且只返回最小字段', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-1', name: '测试HR', employeeNo: 'F001', dept: { name: '人事部' } }]);
    prisma.user.count.mockResolvedValue(21);
    const search = Reflect.get(sut, 'searchRecipients');
    expect(typeof search).toBe('function');
    const result = await search.call(sut, { page: 2, pageSize: 10 });
    expect(result).toEqual({ items: [{ id: 'u-1', name: '测试HR', employeeNo: 'F001', deptName: '人事部' }], total: 21, page: 2, pageSize: 10 });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: ELIGIBLE_RECIPIENTS,
      select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { employeeNo: 'asc' }, { id: 'asc' }], skip: 10, take: 10,
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: ELIGIBLE_RECIPIENTS });
  });

  it('姓名/工号检索与资格取交集，不通过关键词扩大资格', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    const search = Reflect.get(sut, 'searchRecipients');
    expect(typeof search).toBe('function');
    await search.call(sut, { keyword: ' F001 ', page: 1, pageSize: 20 });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ ...ELIGIBLE_RECIPIENTS, AND: [{ OR: [
      { name: { contains: 'F001', mode: 'insensitive' } }, { employeeNo: { contains: 'F001', mode: 'insensitive' } },
    ] }] });
  });
});

describe('分享实际主管必须来自当前花名册任职，不是绩效关系', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-17T04:00:00.000Z')); });
  afterEach(() => jest.useRealTimers());

  function employment(overrides: Record<string, unknown> = {}) {
    return { id: 'employment-1', userId: 'report-1', directManagerId: 'roster-A', employeeStatus: 'active',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null,
      createdAt: new Date('2026-01-01T01:00:00.000Z'), ...overrides };
  }

  it('当前花名册主管A与User绩效主管B不同时，搜索资格只包含A', async () => {
    const { prisma, sut } = setup(null);
    prisma.employmentRecord.findMany.mockResolvedValue([employment()]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    await sut.searchRecipients({ page: 1, pageSize: 20 } as never);
    const expected = [ELIGIBLE_RECIPIENTS.OR[0], { id: { in: ['roster-A'] } }, ELIGIBLE_RECIPIENTS.OR[2]];
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual(expected);
    expect(prisma.user.count.mock.calls[0][0].where.OR).toEqual(expected);
  });

  it('只选当前任职；未来、已结束、待入职、已离职和被新任职替代的旧主管不授予资格', async () => {
    const { prisma, sut } = setup(null);
    prisma.employmentRecord.findMany.mockResolvedValue([
      employment(),
      employment({ id: 'employment-new', directManagerId: 'roster-current', effectiveFrom: new Date('2026-11-15T00:00:00.000Z') }),
      employment({ id: 'future', userId: 'future-report', directManagerId: 'future-manager', effectiveFrom: new Date('2026-11-18T00:00:00.000Z') }),
      employment({ id: 'ended', userId: 'ended-report', directManagerId: 'ended-manager', effectiveTo: new Date('2026-11-16T00:00:00.000Z') }),
      employment({ id: 'pending', userId: 'pending-report', directManagerId: 'pending-manager', employeeStatus: 'pending_entry' }),
      employment({ id: 'resigned', userId: 'resigned-report', directManagerId: 'resigned-manager', employeeStatus: 'resigned' }),
      employment({ id: 'probation', userId: 'probation-report', directManagerId: 'probation-manager', employeeStatus: 'probation' }),
    ]);
    await sut.searchRecipients({ page: 1, pageSize: 20 } as never);
    expect(prisma.user.findMany.mock.calls[0][0].where.OR[1]).toEqual({ id: { in: ['probation-manager', 'roster-current'] } });
  });

  it('任职来源复用已批准及确认到岗约束，下属必须当前在职/试用且未归档未删除', async () => {
    const { prisma, sut } = setup(null);
    await sut.searchRecipients({ page: 1, pageSize: 20 } as never);
    expect(prisma.employmentRecord.findMany).toHaveBeenCalledWith({
      where: {
        user: { deletedAt: null, archivedAt: null, status: { in: ['active', 'probation'] } },
        AND: [
          { OR: [
            { sourceRequestId: null },
            { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: { not: 'cancelled' },
              OR: [{ requiresArrivalConfirmation: false }, { arrivalConfirmedAt: { not: null }, onboardingStatus: 'effective' }] } },
            { sourceRequest: { profileReviewStatus: 'approved', onboardingStatus: null,
              OR: [{ requiresArrivalConfirmation: false }, { arrivalConfirmedAt: { not: null }, onboardingStatus: 'effective' }] } },
          ] },
          { effectiveFrom: { lte: new Date('2026-11-17T00:00:00.000Z') } },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date('2026-11-17T00:00:00.000Z') } }] },
        ],
      },
      select: { id: true, userId: true, directManagerId: true, employeeStatus: true, effectiveFrom: true, effectiveTo: true, createdAt: true },
    });
  });

  it('创建及旧链接查看/下载同步采用花名册A资格，绩效B不能接收或继续查看', async () => {
    const { prisma, sut } = setup(share({ recipientIds: ['roster-A', 'performance-B'], includeResume: true }));
    prisma.employmentRecord.findMany.mockResolvedValue([employment()]);
    prisma.user.findMany.mockImplementation(async ({ where }) => where.id.in
      .filter((id: string) => where.OR.some((rule: { id?: { in: string[] } }) => rule.id?.in.includes(id)))
      .map((id: string) => ({ id })));
    prisma.talentShare.create.mockResolvedValue({ id: 'share-current' });
    await expect(sut.create('cand-1', { recipientIds: ['roster-A'], expiresInDays: 7 } as never, HR)).resolves.toHaveProperty('id', 'share-current');
    await expect(sut.create('cand-1', { recipientIds: ['performance-B'], expiresInDays: 7 } as never, HR)).rejects.toThrow(BadRequestException);
    const roster = { ...MGR, id: 'roster-A', sysRole: 'employee' } as AuthUser;
    const performance = { ...roster, id: 'performance-B' };
    await expect(sut.resolve('a'.repeat(64), roster)).resolves.toHaveProperty('candidate.name', '测试甲');
    await expect(sut.resolve('a'.repeat(64), performance)).rejects.toThrow(FORBIDDEN_MESSAGE);
    await expect(sut.resolveFile('a'.repeat(64), 'file-1', roster)).resolves.toBe('talent-resume/2026/11/09/a.pdf');
    await expect(sut.resolveFile('a'.repeat(64), 'file-1', performance)).rejects.toThrow(FORBIDDEN_MESSAGE);
  });
});

describe('TalentSharesService 被分享人视图（脱敏白名单）', () => {
  it('显式外链允许匿名查看且不查询组织资格，保持严格字段白名单', async () => {
    const { prisma, sut } = setup(share({ isPublicLink: true, recipientIds: [], includeResume: true, candidate: candidate({ phone: 'private', note: 'private', expectSalaryMin: 999, followUps: ['private'] }) }));
    const view = await sut.resolve('a'.repeat(64), undefined as never);
    expect(Object.keys(view.candidate).sort()).toEqual(['name', 'gender', 'genderLabel', 'age', 'currentCompany', 'currentPosition', 'yearsOfExperience', 'education', 'school', 'major', 'expectCity', 'appliedPosition', 'tags', 'status', 'statusLabel'].sort());
    expect(view.files[0]).not.toHaveProperty('objectKey');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.talentShare.update.mock.calls[0][0].data).toMatchObject({ lastViewedById: null });
  });

  it('旧分享即使接收人为空也不允许匿名查看或下载', async () => {
    for (const recipientIds of [[], ['mgr-1']]) {
      const { sut } = setup(share({ recipientIds, includeResume: true }));
      await expect(sut.resolve('a'.repeat(64), undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
      await expect(sut.resolveFile('a'.repeat(64), 'file-1', undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
    }
  });

  it.each(['missing', 'expired', 'revoked', 'deleted', 'exact-expiry'])('匿名外链 %s 查看与下载返回统一错误', async reason => {
    const now = new Date();
    jest.useFakeTimers().setSystemTime(now);
    try {
      const found = reason === 'missing' ? null : share({ isPublicLink: true, includeResume: true,
        ...(reason === 'expired' ? { expiresAt: new Date(now.getTime() - 1) } : {}),
        ...(reason === 'exact-expiry' ? { expiresAt: now } : {}),
        ...(reason === 'revoked' ? { revokedAt: now } : {}),
        ...(reason === 'deleted' ? { candidate: candidate({ deletedAt: now }) } : {}) });
      const { sut } = setup(found);
      await expect(sut.resolve('a'.repeat(64), undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
      await expect(sut.resolveFile('a'.repeat(64), 'file-1', undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
    } finally { jest.useRealTimers(); }
  });
  it('白名单 + 未过期 + 未撤销：返回视图并累计查看次数', async () => {
    const { prisma, sut } = setup(share());
    const view = await sut.resolve('a'.repeat(64), MGR);
    expect(prisma.talentShare.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ viewCount: { increment: 1 } }),
    }));
    expect(view.candidate.name).toBe('测试甲');
    expect(view.candidate.statusLabel).toBe('面试中');
  });

  it('脱敏响应逐字段断言：无手机号/邮箱/期望薪资/来源/备注/跟进/出生年', async () => {
    const { sut } = setup(share({ includeResume: true }));
    const view = await sut.resolve('a'.repeat(64), MGR);
    const forbidden = [
      'phone', 'email', 'expectSalaryMin', 'expectSalaryMax',
      'sourceChannel', 'note', 'followUps', 'birthYear', 'convertedUserId',
    ];
    for (const key of forbidden) {
      expect(view.candidate).not.toHaveProperty(key);
    }
    // 年龄是允许的派生字段
    expect(view.candidate.age).toBe(new Date().getFullYear() - 1996);
  });

  it('expectCity 属于脱敏白名单之外？——需求 §5.4 允许展示期望城市，校验存在', async () => {
    const { sut } = setup(share());
    const view = await sut.resolve('a'.repeat(64), MGR);
    expect(view.candidate).toHaveProperty('expectCity', '上海');
    expect(view.candidate).toHaveProperty('appliedPosition', '供应链经理');
  });

  it('不在白名单 → 403 统一文案，不泄露候选人姓名', async () => {
    const { sut } = setup(share());
    await expect(sut.resolve('a'.repeat(64), HR)).rejects.toMatchObject({
      response: expect.objectContaining({ message: FORBIDDEN_MESSAGE }),
    });
    await expect(sut.resolve('a'.repeat(64), HR)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('已过期 → 403；已撤销 → 403；候选人已软删 → 403（统一文案）', async () => {
    const expired = share({ expiresAt: new Date(Date.now() - 1000) });
    await expect(setup(expired).sut.resolve('a'.repeat(64), MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);

    const revoked = share({ revokedAt: new Date() });
    await expect(setup(revoked).sut.resolve('a'.repeat(64), MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);

    const deleted = share({ candidate: candidate({ deletedAt: new Date() }) });
    await expect(setup(deleted).sut.resolve('a'.repeat(64), MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);
  });

  it('token 不存在 → 403 统一文案', async () => {
    const { sut } = setup(null);
    await expect(sut.resolve('b'.repeat(64), MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);
  });

  it('旧链接接收人离职/归档或失去HR及实际主管关系时，查看和下载均统一拒绝', async () => {
    const { prisma, sut } = setup(share({ includeResume: true }));
    prisma.user.findMany.mockResolvedValue([]);
    await expect(sut.resolve('a'.repeat(64), MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);
    await expect(sut.resolveFile('a'.repeat(64), 'file-1', MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);
    expect(prisma.talentShare.update).not.toHaveBeenCalled();
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ ...ELIGIBLE_RECIPIENTS, id: { in: ['mgr-1'] } });
  });

  it('includeResume=false 视图 files 为空；true 时带文件清单（不含 objectKey）', async () => {
    const { sut } = setup(share());
    const without = await sut.resolve('a'.repeat(64), MGR);
    expect(without.files).toEqual([]);

    const { sut: sut2 } = setup(share({ includeResume: true }));
    const withResume = await sut2.resolve('a'.repeat(64), MGR);
    expect(withResume.files).toHaveLength(1);
    expect(withResume.files[0]).toMatchObject({ id: 'file-1', fileName: '简历.pdf' });
    expect(withResume.files[0]).not.toHaveProperty('objectKey');
  });
});

describe('TalentSharesService 简历下载与撤销', () => {
  it('外链仅在明确附原件且文件属于该候选人时允许匿名下载', async () => {
    await expect(setup(share({ isPublicLink: true, includeResume: true })).sut.resolveFile('a'.repeat(64), 'file-1', undefined as never)).resolves.toBe('talent-resume/2026/11/09/a.pdf');
    await expect(setup(share({ isPublicLink: true })).sut.resolveFile('a'.repeat(64), 'file-1', undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
    await expect(setup(share({ isPublicLink: true, includeResume: true })).sut.resolveFile('a'.repeat(64), 'other-candidate-file', undefined as never)).rejects.toThrow(FORBIDDEN_MESSAGE);
  });
  it('includeResume=false 或文件不属于候选人均统一拒绝', async () => {
    const { sut } = setup(share());
    await expect(sut.resolveFile('a'.repeat(64), 'file-1', MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);

    const { sut: sut2 } = setup(share({ includeResume: true, candidate: candidate({ files: [] }) }));
    await expect(sut2.resolveFile('a'.repeat(64), 'file-1', MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);
  });

  it('includeResume=true 且文件属于候选人 → 返回 objectKey 供存储层下载', async () => {
    const { sut } = setup(share({ includeResume: true }));
    const key = await sut.resolveFile('a'.repeat(64), 'file-1', MGR);
    expect(key).toBe('talent-resume/2026/11/09/a.pdf');
  });

  it('撤销：写 revokedAt 并留审计；重复撤销幂等', async () => {
    const { prisma, sut } = setup(null);
    prisma.talentShare.findUnique
      .mockResolvedValueOnce(share())                      // 第一次撤销
      .mockResolvedValueOnce(share({ revokedAt: new Date() })); // 第二次撤销
    const first = await sut.revoke('share-1', HR);
    expect(first).toEqual({ id: 'share-1', revoked: true });
    expect(prisma.talentShare.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'share-1' }, data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'revoke_talent_share' }) }),
    );

    const second = await sut.revoke('share-1', HR);
    expect(second.revoked).toBe(true);
    expect(prisma.talentShare.update).toHaveBeenCalledTimes(1); // 幂等，不再写
  });

  it('撤销不存在的分享 → 404', async () => {
    const { prisma, sut } = setup(null);
    prisma.talentShare.findUnique.mockResolvedValue(null);
    await expect(sut.revoke('ghost', HR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// 常量导出契约：统一失效文案供前端复用断言
describe('分享失效文案常量', () => {
  it('SHARE_FORBIDDEN_MESSAGE 与后端响应一致', () => {
    expect(SHARE_FORBIDDEN_MESSAGE).toBe(FORBIDDEN_MESSAGE);
  });
});

describe('分享存储错误不回显令牌', () => {
  it.each(['view', 'file'])('%s 存储故障返回通用503，不让带令牌的ORM异常进入日志', async mode => {
    const { prisma, sut } = setup(null);
    const token = 'd'.repeat(64);
    prisma.talentShare.findUnique.mockRejectedValue(new Error(`Synthetic storage failure, token=${token}`));
    const operation = mode === 'view' ? sut.resolve(token) : sut.resolveFile(token, 'file-1');
    try { await operation; throw new Error('Expected storage failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toBe('分享暂时无法读取，请稍后重试');
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });
});
