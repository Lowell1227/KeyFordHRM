import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { DingtalkService } from '../dingtalk/dingtalk.service';
import { BusinessCapabilitiesService } from './business-capabilities.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const eligibleUser = {
  id: 'test-manager-id',
  employeeNo: 'MGR001',
  name: '测试·周强明',
  sysRole: 'employee',
  status: 'active',
  dingtalkId: null,
  dingtalkUnionId: null,
  passwordHash: 'hashed',
  mustChangePassword: true,
  hrCapabilities: [],
  deptId: 'test-dept-id',
  isAssessorOnly: false,
  canViewAll: false,
  avatarUrl: null,
  dept: { name: '测试研发部' },
};

function createService(enabled: boolean) {
  const prisma = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    externalIdentityBinding: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    employmentRecord: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('test-token') };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'ENABLE_TEST_QUICK_LOGIN') return enabled ? 'true' : 'false';
      if (key === 'JWT_EXPIRES_IN') return fallback ?? '8h';
      return undefined;
    }),
  };
  const dingtalk = { getAuthCodeUnionId: jest.fn() };
  const businessCapabilities = {
    getForUser: jest.fn().mockResolvedValue({
      canManageTeam: true,
      canReviewDepartment: false,
      canViewPerformanceApproval: false,
      canOperatePerformanceApproval: false,
      canHandleHrCycle: false,
      canHandleInterviews: false,
      canHandleProbationReviews: false,
      canHandleConfirmationApprovals: false,
      canViewReports: true,
      canManageObjectives: true,
      identities: [{ type: 'performance_manager', label: '绩效直属上级', count: 1 }],
    }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    dingtalk as unknown as DingtalkService,
    businessCapabilities as unknown as BusinessCapabilitiesService,
  );

  return { service, prisma, jwt, dingtalk, businessCapabilities };
}

describe('AuthService test quick login', () => {
  it('开关关闭时不暴露测试账号', async () => {
    const { service, prisma } = createService(false);

    await expect(service.getTestAccounts()).resolves.toEqual({ enabled: false, accounts: [] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('开关开启时只返回身份和角色均匹配的固定测试账号', async () => {
    const { service, prisma } = createService(true);
    prisma.user.findMany.mockResolvedValue([
      eligibleUser,
      { ...eligibleUser, employeeNo: 'EMP999', name: '测试·越界账号', sysRole: 'employee' },
      { ...eligibleUser, employeeNo: 'HR001', name: '姚瑶', sysRole: 'hr' },
    ]);

    await expect(service.getTestAccounts()).resolves.toEqual({
      enabled: true,
      accounts: [{
        employeeNo: 'MGR001',
        name: '测试·周强明',
        sysRole: 'employee',
        roleLabel: '绩效直属上级场景',
      }],
    });
  });

  it('开关关闭或账号不在白名单时拒绝快捷登录', async () => {
    const disabled = createService(false);
    await expect(disabled.service.testLogin({ employeeNo: 'MGR001' })).rejects.toBeInstanceOf(NotFoundException);

    const enabled = createService(true);
    await expect(enabled.service.testLogin({ employeeNo: 'UNKNOWN' })).rejects.toBeInstanceOf(NotFoundException);
    expect(enabled.prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('拒绝被钉钉身份占用的固定工号', async () => {
    const { service, prisma } = createService(true);
    prisma.user.findFirst.mockResolvedValue({ ...eligibleUser, dingtalkId: 'real-dingtalk-id' });

    await expect(service.testLogin({ employeeNo: 'MGR001' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('为完全匹配的测试账号签发登录令牌', async () => {
    const { service, prisma, jwt, businessCapabilities } = createService(true);
    prisma.user.findFirst.mockResolvedValue(eligibleUser);

    await expect(service.testLogin({ employeeNo: 'MGR001' })).resolves.toMatchObject({
      token: 'test-token',
      user: {
        id: 'test-manager-id',
        name: '测试·周强明',
        status: 'active',
        sysRole: 'employee',
        systemPermission: 'standard_user',
        canViewAll: false,
        businessCapabilities: expect.objectContaining({ canManageTeam: true }),
      },
    });
    expect(jwt.signAsync).toHaveBeenCalledTimes(1);
    expect(businessCapabilities.getForUser).toHaveBeenCalledWith(expect.objectContaining({ id: eligibleUser.id }));
  });
});

describe('AuthService current user capabilities', () => {
  it('/auth/me 返回动态业务能力', async () => {
    const { service, prisma, businessCapabilities } = createService(false);
    prisma.user.findUnique.mockResolvedValue({
      ...eligibleUser,
      phone: null,
      position: '研发经理',
      directManagerId: null,
      directManager: null,
      dept: { name: '测试研发部', fullPath: '测试研发部' },
    });

    await expect(service.getMe(eligibleUser.id)).resolves.toMatchObject({
      id: eligibleUser.id,
      status: 'active',
      systemPermission: 'standard_user',
      businessCapabilities: expect.objectContaining({ canManageTeam: true }),
    });
    expect(businessCapabilities.getForUser).toHaveBeenCalledWith(expect.objectContaining({ id: eligibleUser.id }));
  });
});

describe('AuthService DingTalk identity boundary', () => {
  it('通过已启用的钉钉身份关联登录，并校验当前有效任职', async () => {
    const { service, prisma, dingtalk } = createService(false);
    dingtalk.getAuthCodeUnionId.mockResolvedValue('union-enabled');
    prisma.externalIdentityBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      provider: 'dingtalk',
      status: 'enabled',
      endedAt: null,
      user: eligibleUser,
    });
    prisma.employmentRecord.findFirst.mockResolvedValue({ id: 'employment-1' });

    await expect(service.dingtalkLogin({
      authCode: 'auth-code',
      loginMode: 'internal',
    })).resolves.toMatchObject({
      token: 'test-token',
      passwordChangeRequired: false,
      user: { id: eligibleUser.id },
    });

    expect(prisma.externalIdentityBinding.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'dingtalk',
        externalUnionId: 'union-enabled',
        status: 'enabled',
        endedAt: null,
      }),
    }));
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('已绑定但无当前有效任职时拒绝登录', async () => {
    const { service, prisma, dingtalk } = createService(false);
    dingtalk.getAuthCodeUnionId.mockResolvedValue('union-enabled');
    prisma.externalIdentityBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      provider: 'dingtalk',
      status: 'enabled',
      endedAt: null,
      user: eligibleUser,
    });
    prisma.employmentRecord.findFirst.mockResolvedValue(null);

    await expect(service.dingtalkLogin({
      authCode: 'auth-code',
      loginMode: 'internal',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService local identity boundary', () => {
  it('工号密码正确但无当前有效任职时拒绝登录', async () => {
    const { service, prisma } = createService(false);
    prisma.user.findFirst.mockResolvedValue(eligibleUser);
    prisma.employmentRecord.findFirst.mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.localLogin({
      employeeNo: 'MGR001',
      password: 'correct-password',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('工号密码与当前有效任职都通过时签发令牌', async () => {
    const { service, prisma, jwt } = createService(false);
    prisma.user.findFirst.mockResolvedValue({
      ...eligibleUser,
      hrCapabilities: ['employee_archive_edit'],
    });
    prisma.employmentRecord.findFirst.mockResolvedValue({ id: 'employment-1' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.localLogin({
      employeeNo: 'MGR001',
      password: 'correct-password',
    })).resolves.toMatchObject({
      token: 'test-token',
      passwordChangeRequired: true,
      user: { id: eligibleUser.id },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({
      hrCapabilities: ['employee_archive_edit'],
    }));
  });

  it('修改密码只接受4至6位数字且不能继续使用0000', async () => {
    const { service, prisma } = createService(false);
    prisma.user.findUnique.mockResolvedValue(eligibleUser);

    await expect((service as any).changePassword(
      eligibleUser.id,
      { password: '0000', confirmPassword: '0000' },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: expect.stringContaining('0000') }) });
    await expect((service as any).changePassword(
      eligibleUser.id,
      { password: '12ab', confirmPassword: '12ab' },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: expect.stringContaining('4至6位数字') }) });
  });

  it('修改密码成功后清除首次改密标记并写审计', async () => {
    const { service, prisma } = createService(false);
    prisma.user.findUnique.mockResolvedValue(eligibleUser);
    prisma.user.update.mockResolvedValue({ ...eligibleUser, mustChangePassword: false });
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

    await expect((service as any).changePassword(
      eligibleUser.id,
      { password: '12345', confirmPassword: '12345' },
    )).resolves.toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: eligibleUser.id },
      data: { passwordHash: 'new-hash', mustChangePassword: false },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'change_password', userId: eligibleUser.id }),
    }));
  });
});
