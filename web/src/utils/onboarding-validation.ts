import type { EmployeeCreateDraftPayload } from '@/api/employee-archives.api';

function calendarDay(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateOnboardingStep(input: EmployeeCreateDraftPayload, step: number): Record<string, string> {
  const errors: Record<string, string> = {};
  const present = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '';
  const required = (path: string, value: unknown, message: string) => { if (!present(value)) errors[path] = message; };
  const text = (path: string, value: unknown, max: number) => {
    if (present(value) && (typeof value !== 'string' || value.length > max)) errors[path] = `最多填写 ${max} 个字符`;
  };
  const date = (path: string, value: unknown) => { if (present(value) && !calendarDay(value)) errors[path] = '请填写有效日期'; };
  const integer = (path: string, value: unknown, max: number) => {
    if (present(value) && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max)) errors[path] = `请填写 0 至 ${max} 的整数`;
  };
  const employee = input.employee ?? {};
  const profile = input.profile ?? {};
  if (step === 0) {
    required('employee.name', input.name, '请填写姓名');
    text('employee.name', input.name, 50);
    if (present(input.phone) && !/^1\d{10}$/.test(String(input.phone))) errors['profile.phone'] = '请填写完整的 11 位手机号';
    if (present(input.idNumber) && !/^(?:\d{15}|\d{17}[\dX])$/.test(String(input.idNumber))) errors['profile.idNumber'] = '请填写完整的身份证号，或清空后稍后补充';
  }
  if (step === 1) {
    required('employee.companyText', employee.contractSubjectId || employee.companyText, '请选择所属公司');
    if (!input.company && !errors['employee.companyText']) errors['employee.companyText'] = '所属公司尚未配置内部公司映射，请先在基础资料中配置';
    required('employee.deptId', input.deptId, '请选择部门');
    required('employee.entryDate', input.entryDate, '请选择入职日期');
    required('employee.effectiveFrom', input.effectiveFrom, '请选择任职开始日期');
    required('employee.employmentType', input.employmentType, '请选择用工类型');
    required('employee.employeeStatus', input.employeeStatus, '请选择员工状态');
    for (const key of ['entryDate', 'effectiveFrom', 'effectiveTo'] as const) date(`employee.${key}`, input[key]);
    for (const key of ['plannedRegularDate', 'actualRegularDate', 'leaveDate']) date(`employee.${key}`, employee[key]);
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) errors['employee.effectiveTo'] = '任职结束日期不能早于任职开始日期';
    integer('employee.probationMonths', employee.probationMonths, 12);
    for (const [key, max] of Object.entries({ companyText: 150, position: 100, jobGrade: 50, jobFamily: 100, workLocation: 100 })) text(`employee.${key}`, employee[key], max);
  }
  if (step === 2) {
    for (const [key, max] of Object.entries({ gender: 30, ethnicity: 50, education: 50, professionalTitle: 100, school: 200, major: 100,
      maritalStatus: 30, childrenStatus: 50, politicalStatus: 50, nativePlace: 100, householdType: 50, idAddress: 500, currentAddress: 500,
      emergencyContactName: 100, emergencyContactRelation: 50, emergencyContactPhone: 30, socialSecurityStatus: 50, housingFundStatus: 50,
      bankName: 100, bankBranch: 200, bankAccount: 50 })) text(`profile.${key}`, profile[key], max);
    integer('profile.childrenCount', profile.childrenCount, 20);
    for (const key of ['birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate']) date(`profile.${key}`, profile[key]);
    const contracts = input.contracts ?? [];
    if (contracts.length > 20) errors.contracts = '最多填写 20 份合同';
    contracts.forEach((contract, index) => {
      for (const [key, max] of Object.entries({ contractType: 50, name: 200, signingCompany: 200, termType: 100,
        originalCompany: 200, newCompany: 200, confidentialityAgreement: 200, nonCompeteAgreement: 200, portraitAgreement: 200 })) {
        text(`contracts.${index}.${key}`, contract[key], max);
      }
      for (const key of ['signedAt', 'effectiveFrom', 'expiresAt']) date(`contracts.${index}.${key}`, contract[key]);
    });
  }
  return errors;
}
