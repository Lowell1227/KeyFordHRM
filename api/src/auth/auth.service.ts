import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { DingtalkService } from '../dingtalk/dingtalk.service';
import { ERROR_CODE } from '../common/constants/error-codes';
import { JwtPayload } from '../common/types/auth.types';
import { LocalLoginDto } from './dto/local-login.dto';
import { DingTalkLoginDto } from './dto/dingtalk-login.dto';

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

    return this.issueToken(user);
  }

  /** 钉钉免密登录（结构占位）。 */
  async dingtalkLogin(dto: DingTalkLoginDto): Promise<LoginResponse> {
    const user = await this.resolveUserByAuthCode(dto.authCode);
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
   * 调钉钉 API 换 unionId → 查 users.dingtalk_unionId → 命中返回 User，未命中抛 4004。
   */
  private async resolveUserByAuthCode(authCode: string): Promise<User> {
    const unionId = await this.dingtalk.getAuthCodeUnionId(authCode);

    const user = await this.prisma.user.findFirst({
      where: { dingtalkUnionId: unionId, deletedAt: null },
      include: { dept: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '账号未开通',
      });
    }

    return user;
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
