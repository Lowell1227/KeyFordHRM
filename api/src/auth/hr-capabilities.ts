export const HR_CAPABILITIES = [
  'employee_archive_edit',
  'employee_archive_review',
  'organization_edit',
  'cycle_plan_edit',
  'cycle_plan_review',
  'performance_calibration',
  'performance_publish',
  'confirmation_manage',
  'talent_hiring_confirm',
  'recruitment_view',
  'recruitment_edit',
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
  if (capability === 'recruitment_edit') return Boolean(subject.hrCapabilities?.includes(capability));
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
