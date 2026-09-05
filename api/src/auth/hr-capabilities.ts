export const HR_CAPABILITIES = [
  'employee_archive_edit',
  'employee_archive_review',
  'organization_edit',
  'cycle_plan_edit',
  'cycle_plan_review',
  'performance_calibration',
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
  if (subject.sysRole === 'system_admin' || subject.sysRole === 'hr') return true;
  return subject.sysRole === 'hr_user' && Boolean(subject.hrCapabilities?.includes(capability));
}
