import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountType, EmployeeNumberStatus, UserStatus } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  EmployeeIdentityCandidate,
  EmployeeIdentityLookupDto,
  EmployeeIdentityLookupResult,
} from './dto/employee-onboarding.dto';

@Injectable()
export class EmployeeIdentityMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async lookup(input: EmployeeIdentityLookupDto): Promise<EmployeeIdentityLookupResult> {
    const phone = input.phone ? this.normalizePhone(input.phone) : null;
    const idNumber = input.idNumber ? this.normalizeIdNumber(input.idNumber) : null;
    if (!phone && !idNumber) {
      throw new BadRequestException('请输入完整手机号或身份证号');
    }

    const phoneUsers = phone ? await this.findPhone(phone) : [];
    const idUsers = idNumber ? await this.findId(this.fingerprint(idNumber)) : [];
    if (phone && idNumber) {
      const phoneIds = new Set(phoneUsers.map((item) => item.id));
      if (phoneUsers.length > 0 && idUsers.length > 0 && idUsers.some((item) => !phoneIds.has(item.id))) {
        return { outcome: 'conflict', candidates: [] };
      }
    }

    if (idUsers.length > 0) {
      return { outcome: 'identity_match', candidates: idUsers.map((item) => this.toCandidate(item, 'id_number')) };
    }
    if (phoneUsers.length > 0) {
      return { outcome: 'phone_candidates', candidates: phoneUsers.map((item) => this.toCandidate(item, 'phone')) };
    }
    return { outcome: 'none', candidates: [] };
  }

  private normalizePhone(value: string): string {
    const normalized = value.replace(/[\s-]/g, '').replace(/^\+86/, '');
    if (!/^1\d{10}$/.test(normalized)) throw new BadRequestException('请输入完整手机号或身份证号');
    return normalized;
  }

  private normalizeIdNumber(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^(?:\d{15}|\d{17}[\dX])$/.test(normalized)) throw new BadRequestException('请输入完整手机号或身份证号');
    return normalized;
  }

  private fingerprint(value: string): string {
    const secret = this.config.get<string>('EMPLOYEE_ARCHIVE_ENCRYPTION_KEY')
      ?? this.config.get<string>('JWT_SECRET');
    if (!secret) throw new BadRequestException('员工档案加密配置缺失');
    const key = createHash('sha256').update(`employee-archive:${secret}`).digest();
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private baseWhere() {
    return { deletedAt: null, accountType: AccountType.employee } as const;
  }

  private include() {
    return {
      dept: { select: { name: true } },
      employeeNumberAssignments: {
        where: { status: EmployeeNumberStatus.historical },
        orderBy: { effectiveFrom: 'desc' as const },
        take: 1,
        select: { employeeNo: true },
      },
    };
  }

  private findPhone(phone: string) {
    return this.prisma.user.findMany({
      where: {
        ...this.baseWhere(),
        OR: [{ phone }, { employeeProfile: { phone } }],
      },
      include: this.include(),
      take: 10,
    });
  }

  private findId(fingerprint: string) {
    return this.prisma.user.findMany({
      where: { ...this.baseWhere(), employeeProfile: { idNumberFingerprint: fingerprint } },
      include: this.include(),
      take: 10,
    });
  }

  private toCandidate(user: any, matchBasis: 'id_number' | 'phone'): EmployeeIdentityCandidate {
    const nextAction = matchBasis === 'phone'
      ? 'confirm_phone'
      : user.status === UserStatus.resigned || user.archivedAt
        ? 'reentry'
        : user.status === UserStatus.pending_entry
          ? 'view_onboarding'
          : 'view_profile';
    return {
      id: user.id,
      maskedName: this.maskName(user.name),
      currentEmployeeNo: user.employeeNo ?? null,
      matchedHistoricalEmployeeNo: user.employeeNumberAssignments?.[0]?.employeeNo ?? null,
      status: user.status,
      archived: Boolean(user.archivedAt),
      departmentName: user.dept?.name ?? null,
      matchBasis,
      nextAction,
    };
  }

  private maskName(name: string): string {
    const value = name.trim();
    if (value.length <= 1) return value;
    if (value.length === 2) return `${value[0]}*`;
    return `${value[0]}${'*'.repeat(value.length - 2)}${value.at(-1)}`;
  }
}
