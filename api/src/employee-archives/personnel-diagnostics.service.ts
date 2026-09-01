import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { intervalsOverlap } from './employment-timeline';

export interface DiagnosticItem {
  code: string;
  label: string;
  userIds: string[];
  detail: string;
}

export interface PersonnelDiagnosticsResult {
  blocking: false;
  total: number;
  items: DiagnosticItem[];
}

@Injectable()
export class PersonnelDiagnosticsService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(): Promise<PersonnelDiagnosticsResult> {
    const [users, positions] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, accountType: 'employee' },
        select: {
          id: true, name: true, employeeNo: true, phone: true, deptId: true, positionId: true,
          position: true, directManagerId: true, status: true,
          employeeProfile: { select: { idNumberFingerprint: true } },
          employmentHistory: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
          employeeContracts: { select: { id: true, isActive: true, effectiveFrom: true, expiresAt: true } },
          externalIdentityBindings: { select: { id: true, status: true } },
        },
      }),
      this.prisma.position.findMany({ select: { id: true } }),
    ]);
    const items: DiagnosticItem[] = [];
    this.addDuplicateItems(items, users, 'employeeNo', 'duplicate_employee_no', '工号重复');
    this.addDuplicateItems(items, users, 'phone', 'duplicate_phone', '手机号重复');
    this.addDuplicateItems(
      items,
      users.map((user) => ({ ...user, identity: user.employeeProfile?.idNumberFingerprint ?? null })),
      'identity', 'duplicate_identity', '证件信息重复',
    );
    const validPositionIds = new Set(positions.map((position) => position.id));

    for (const user of users) {
      if (!user.deptId) this.add(items, 'missing_department', '缺少部门', user, '员工尚未归属有效部门');
      if (!user.positionId || !validPositionIds.has(user.positionId)) {
        this.add(items, 'missing_position', '岗位未映射', user, '当前岗位尚未关联岗位目录');
      }
      if (user.status === 'active' && !user.directManagerId) {
        this.add(items, 'missing_roster_manager', '缺少直属主管', user, '花名册直属主管尚未维护');
      }
      if (this.hasOverlap(user.employmentHistory)) {
        this.add(items, 'employment_overlap', '任职时间重叠', user, '存在多条时间区间重叠的任职记录');
      }
      const activeContracts = user.employeeContracts
        .filter((contract) => contract.isActive && contract.effectiveFrom)
        .map((contract) => ({
          id: contract.id,
          effectiveFrom: contract.effectiveFrom!,
          effectiveTo: contract.expiresAt,
        }));
      if (this.hasOverlap(activeContracts)) {
        this.add(items, 'contract_overlap', '合同时间重叠', user, '存在多份有效期重叠的合同');
      }
      if (user.status === 'resigned' && user.externalIdentityBindings.some((binding) => binding.status === 'enabled')) {
        this.add(items, 'resigned_login_enabled', '离职账号仍可登录', user, '离职员工的外部登录关联仍为启用状态');
      }
    }

    return { blocking: false, total: items.length, items };
  }

  private addDuplicateItems<T extends { id: string; name: string }>(
    items: DiagnosticItem[], records: T[], field: keyof T, code: string, label: string,
  ) {
    const groups = new Map<string, T[]>();
    for (const record of records) {
      const raw = record[field];
      if (raw === null || raw === undefined || raw === '') continue;
      const key = String(raw).trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      items.push({ code, label, userIds: group.map((record) => record.id), detail: group.map((record) => record.name).join('、') });
    }
  }

  private hasOverlap(records: Array<{ id: string; effectiveFrom: Date; effectiveTo: Date | null }>) {
    return records.some((record, index) => records.slice(index + 1).some((other) => intervalsOverlap(record, other)));
  }

  private add(items: DiagnosticItem[], code: string, label: string, user: { id: string; name: string }, detail: string) {
    items.push({ code, label, userIds: [user.id], detail: `${user.name}：${detail}` });
  }
}
