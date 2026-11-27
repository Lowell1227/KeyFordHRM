export const HR_CAPABILITIES = [
  'employee_archive_edit',
  'employee_archive_review',
  'organization_edit',
  'cycle_plan_edit',
  'cycle_plan_review',
  'cycle_terminate',
  'performance_calibration',
  'performance_publish',
  'performance_lifecycle_view',
  'performance_lifecycle_terminate',
  'performance_lifecycle_delete',
  'confirmation_manage',
  'talent_hiring_confirm',
  'recruitment_view',
  'recruitment_edit',
  'recruitment_demand_review',
] as const;

export type HrCapability = typeof HR_CAPABILITIES[number];

export interface HrCapabilitySubject {
  sysRole: string;
  hrCapabilities?: readonly string[] | null;
}

export function hasHrCapability(
  subject: HrCapabilitySubject,
  capability: HrCapability,
): boolean {
  if (capability === 'cycle_terminate') return ['hr_user', 'hr', 'system_admin'].includes(subject.sysRole)
    && Boolean(subject.hrCapabilities?.includes(capability));
  if (capability === 'recruitment_edit' || capability === 'recruitment_demand_review') return Boolean(subject.hrCapabilities?.includes(capability));
  if (capability === 'recruitment_view') {
    return subject.sysRole === 'hr' || subject.sysRole === 'system_admin'
      || Boolean(subject.hrCapabilities?.some(value => value === capability || value === 'recruitment_edit'));
  }
  if (capability === 'talent_hiring_confirm') {
    return subject.sysRole === 'hr' || Boolean(subject.hrCapabilities?.includes(capability));
  }
  if (subject.sysRole === 'system_admin' || subject.sysRole === 'hr') return true;
  return subject.sysRole === 'hr_user' && Boolean(subject.hrCapabilities?.includes(capability));
}
