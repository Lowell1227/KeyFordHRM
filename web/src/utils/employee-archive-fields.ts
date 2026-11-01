const employeeFields = new Set(['name', 'employeeNo', 'deptId', 'positionId', 'jobGrade', 'jobFamily', 'managerId',
  'workLocation', 'employmentType', 'employeeStatus', 'entryDate', 'effectiveFrom', 'effectiveTo', 'leaveDate',
  'plannedRegularDate', 'actualRegularDate', 'probationMonths']);
const profileFields = new Set(['phone', 'gender', 'birthDate', 'ethnicity', 'education', 'professionalTitle', 'school',
  'graduationDate', 'major', 'maritalStatus', 'childrenStatus', 'childrenCount', 'politicalStatus', 'nativePlace',
  'householdType', 'idAddress', 'idNumber', 'currentAddress', 'emergencyContactName', 'emergencyContactRelation',
  'emergencyContactPhone', 'socialSecurityStatus', 'socialSecurityStartDate', 'housingFundStatus', 'housingFundStartDate',
  'bankName', 'bankBranch', 'bankAccount']);

export function archiveFieldPath(field: string): string {
  const path = field.replace(/\[(\d+)\]/g, '.$1');
  if (['company', 'companyText', 'contractSubjectId', 'employee.company', 'employee.contractSubjectId'].includes(path)) return 'employee.companyText';
  if (path === 'status' || path === 'employee.status') return 'employee.employeeStatus';
  if (path === 'position' || path === 'employee.position') return 'employee.positionId';
  if (employeeFields.has(path)) return `employee.${path}`;
  if (profileFields.has(path)) return `profile.${path}`;
  return path.replace(/^(contracts\.\d+)\.contractSubjectId$/, '$1.signingCompany');
}
