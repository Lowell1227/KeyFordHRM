import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TalentSharesService, SHARE_FORBIDDEN_MESSAGE } from './talent-shares.service';
import type { AuthUser } from '@/common/types/auth.types';

/**
 * 分享授权（T5，需求 §5.4）：
 * 创建（角色白名单/通知）、被分享人视图（白名单/过期/撤销/软删统一 403）、
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
    user: { findMany: jest.fn() },
    notificationLog: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const talents = { findActive: jest.fn().mockResolvedValue(candidate()) };
  const sut = new TalentSharesService(prisma as never, talents as never);
  return { prisma, sut };
}

describe('TalentSharesService 创建分享', () => {
  it('接收人不存在或已删除 → 400', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: '郑冠宇', sysRole: 'manager' }]);
    await expect(sut.create('cand-1', {
      recipientIds: ['mgr-1', 'ghost'], expiresInDays: 7,
    } as never, HR)).rejects.toThrow('部分接收人不存在或已删除');
  });

  it.each(['employee', 'hr_user', 'chairman'])('角色 %s 不在接收人白名单 → 400', async (role) => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-1', name: '普通员工', sysRole: role }]);
    await expect(sut.create('cand-1', { recipientIds: ['u-1'], expiresInDays: 7 } as never, HR))
      .rejects.toThrow(BadRequestException);
    expect(prisma.talentShare.create).not.toHaveBeenCalled();
  });

  it('dept_head/manager/hr/vp/system_admin 均可接收；创建成功返回 64 位 token 与相对链接', async () => {
    const { prisma, sut } = setup(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: '郑冠宇', sysRole: 'manager' }]);
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
    // 站内通知逐人一条，不发钉钉
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'mgr-1', channel: 'system', type: 'talent_share' }),
    }));
  });
});

describe('TalentSharesService 被分享人视图（脱敏白名单）', () => {
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
  it('includeResume=false 下载简历 → 403；文件不属于候选人 → 404', async () => {
    const { sut } = setup(share());
    await expect(sut.resolveFile('a'.repeat(64), 'file-1', MGR)).rejects.toThrow(FORBIDDEN_MESSAGE);

    const { sut: sut2 } = setup(share({ includeResume: true, candidate: candidate({ files: [] }) }));
    await expect(sut2.resolveFile('a'.repeat(64), 'file-1', MGR)).rejects.toBeInstanceOf(NotFoundException);
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
