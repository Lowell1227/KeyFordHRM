import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExternalIdentityProvider, ExternalIdentityStatus, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { DingtalkService } from '../dingtalk/dingtalk.service';
import { ERROR_CODE } from '../common/constants/error-codes';
import { JwtPayload } from '../common/types/auth.types';
import { LocalLoginDto } from './dto/local-login.dto';
import { DingTalkLoginDto } from './dto/dingtalk-login.dto';
import { TestLoginDto } from './dto/test-login.dto';
import { findTestAccount, TEST_ACCOUNT_MANIFEST } from './test-accounts';

/** 登录成功响应。 */
export interface LoginResponse {
  token: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    sysRole: string;
    deptName: string | null;
    avatarUrl: string | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dingtalk: DingtalkService,
  ) {}

  /** 工号+密码登录。 */
  async localLogin(dto: LocalLoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        employeeNo: dto.employeeNo,
        deletedAt: null,
        status: { not: 'resigned' },
      },
      include: { dept: true },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '工号或密码错误',
      });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '工号或密码错误',
      });
    }

    await this.assertCurrentEmployment(user.id);
    return this.issueToken(user);
  }

  /** 钉钉免密登录（结构占位）。 */
  async dingtalkLogin(dto: DingTalkLoginDto): Promise<LoginResponse> {
    const user = await this.resolveUserByAuthCode(dto.authCode, dto.loginMode);
    return this.issueToken(user);
  }

  /** 返回由后端开关控制的固定测试身份，不向浏览器下发任何密码。 */
  async getTestAccounts() {
    if (!this.isTestQuickLoginEnabled()) {
      return { enabled: false, accounts: [] };
    }

    const users = await this.prisma.user.findMany({
      where: {
        employeeNo: { in: TEST_ACCOUNT_MANIFEST.map((account) => account.employeeNo) },
        deletedAt: null,
        status: { not: 'resigned' },
        dingtalkId: null,
        dingtalkUnionId: null,
        passwordHash: { not: null },
      },
      select: {
        employeeNo: true,
        name: true,
        sysRole: true,
      },
    });

    const eligible = new Map(
      users
        .map((user) => {
          const expected = user.employeeNo ? findTestAccount(user.employeeNo) : undefined;
          if (!expected || user.name !== expected.name || user.sysRole !== expected.sysRole) return null;
          return [expected.employeeNo, {
            employeeNo: expected.employeeNo,
            name: expected.name,
            sysRole: expected.sysRole,
            roleLabel: expected.roleLabel,
          }] as const;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    );

    return {
      enabled: true,
      accounts: TEST_ACCOUNT_MANIFEST
        .map((account) => eligible.get(account.employeeNo))
        .filter((account): account is NonNullable<typeof account> => Boolean(account)),
    };
  }

  /** 仅为已隔离、无钉钉身份的固定测试账号签发令牌。 */
  async testLogin(dto: TestLoginDto): Promise<LoginResponse> {
    if (!this.isTestQuickLoginEnabled()) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '测试快捷登录未启用' });
    }

    const expected = findTestAccount(dto.employeeNo);
    if (!expected) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '测试账号不存在' });
    }

    const user = await this.prisma.user.findFirst({
      where: {
        employeeNo: dto.employeeNo,
        deletedAt: null,
        status: { not: 'resigned' },
      },
      include: { dept: true },
    });

    if (!user) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '测试账号不存在' });
    }
    if (user.dingtalkId || user.dingtalkUnionId) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '该工号已绑定真实钉钉身份' });
    }
    if (!user.passwordHash || user.name !== expected.name || user.sysRole !== expected.sysRole) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '账号不是受控测试身份' });
    }

    return this.issueToken(user);
  }

  /** 获取当前登录用户详情（含部门、直属上级）。 */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        dept: true,
        directManager: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '用户不存在或已被禁用',
      });
    }

    return {
      id: user.id,
      name: user.name,
      employeeNo: user.employeeNo,
      phone: user.phone,
      deptId: user.deptId,
      deptName: user.dept?.name ?? null,
      deptPath: user.dept?.fullPath ?? null,
      position: user.position,
      sysRole: user.sysRole,
      isAssessorOnly: user.isAssessorOnly,
      canViewAll: user.canViewAll,
      directManagerId: user.directManagerId,
      directManagerName: user.directManager?.name ?? null,
      avatarUrl: user.avatarUrl,
    };
  }

  /**
   * 根据钉钉 authCode 解析用户：
   * 调钉钉 API 换 unionId → 查当前启用身份关联 → 校验权威任职 → 返回 User。
   */
  private async resolveUserByAuthCode(authCode: string, loginMode: DingTalkLoginDto['loginMode']): Promise<User> {
    const unionId = await this.dingtalk.getAuthCodeUnionId(authCode, loginMode);

    const binding = await this.prisma.externalIdentityBinding.findFirst({
      where: {
        provider: ExternalIdentityProvider.dingtalk,
        externalUnionId: unionId,
        status: ExternalIdentityStatus.enabled,
        endedAt: null,
        user: { deletedAt: null },
      },
      include: {
        user: { include: { dept: true } },
      },
    });

    if (!binding) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '账号未开通',
      });
    }

    await this.assertCurrentEmployment(binding.userId);

    await this.prisma.externalIdentityBinding.update({
      where: { id: binding.id },
      data: { lastLoginAt: new Date() },
    });

    return binding.user;
  }

  /** 所有真实登录方式都以员工主数据中的当前有效任职作为准入依据。 */
  private async assertCurrentEmployment(userId: string): Promise<void> {
    const now = new Date();
    const currentEmployment = await this.prisma.employmentRecord.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        employeeStatus: { not: UserStatus.resigned },
      },
      select: { id: true },
    });

    if (!currentEmployment) {
      throw new UnauthorizedException({
        code: ERROR_CODE.UNAUTHORIZED,
        message: '当前无有效任职，无法登录',
      });
    }
  }

  /** 签发 JWT 并组装登录响应（供本地登录与钉钉登录复用）。 */
  async issueToken(user: User & { dept?: { name: string } | null }): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      name: user.name,
      sysRole: user.sysRole,
      deptId: user.deptId,
      isAssessorOnly: user.isAssessorOnly,
      canViewAll: user.canViewAll,
    };

    const token = await this.jwt.signAsync(payload);
    const expiresIn = this.resolveExpiresInSeconds();

    return {
      token,
      expiresIn,
      user: {
        id: user.id,
        name: user.name,
        sysRole: user.sysRole,
        deptName: user.dept?.name ?? null,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /** 取 JWT_EXPIRES_IN 并转换为秒，供前端使用。 */
  private resolveExpiresInSeconds(): number {
    const raw = this.config.get<string>('JWT_EXPIRES_IN', '8h');
    return parseExpiresIn(raw);
  }

  private isTestQuickLoginEnabled(): boolean {
    return this.config.get<string>('ENABLE_TEST_QUICK_LOGIN', 'false') === 'true';
  }
}

/** 把如 '8h' / '1d' / '3600' 的 JWT 过期时间转成秒。 */
function parseExpiresIn(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = /^([\d.]+)\s*([smhd])?$/.exec(trimmed);
  if (!match) return 8 * 3600;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value < 0) return 8 * 3600;

  const unit = match[2] || 's';
  const multiplier: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return Math.floor(value * multiplier[unit]);
}
