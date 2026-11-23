import { ForbiddenException } from '@nestjs/common';

export const PAYROLL_CAPABILITIES = ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit',
  'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle', 'payroll_parameter_review'] as const;
export type PayrollCapability = typeof PAYROLL_CAPABILITIES[number];
export interface PayrollActor { id: string; sysRole?: string; isAssessorOnly?: boolean; canViewAll?: boolean }
export interface PayrollGrantFact {
  userId: string; subjectId: string; capabilities: string[]; revokedAt: Date | null;
  subject?: { name: string };
}
export interface PayrollAccess {
  enabled: boolean;
  subjects: Array<{ id: string; name: string; capabilities: PayrollCapability[] }>;
}
export function payrollAccess(actor: PayrollActor, grants: PayrollGrantFact[], enabled: boolean): PayrollAccess {
  if (!enabled || actor.isAssessorOnly) return { enabled: false, subjects: [] };
  return { enabled: true, subjects: grants.filter(grant => grant.userId === actor.id && !grant.revokedAt)
    .map(grant => ({ id: grant.subjectId, name: grant.subject?.name ?? grant.subjectId,
      capabilities: grant.capabilities.filter((capability): capability is PayrollCapability =>
        (PAYROLL_CAPABILITIES as readonly string[]).includes(capability)) }))
    .filter(grant => grant.capabilities.length > 0) };
}
export function assertPayrollGrant(actor: PayrollActor, grants: PayrollGrantFact[], subjectId: string,
  capability: PayrollCapability, enabled: boolean): void {
  if (!payrollAccess(actor, grants, enabled).subjects.some(subject => subject.id === subjectId && subject.capabilities.includes(capability))) {
    throw new ForbiddenException('没有该公司主体的薪酬操作权限');
  }
}
