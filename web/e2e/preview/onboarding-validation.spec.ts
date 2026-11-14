import { expect, test } from '@playwright/test';
import { validateOnboardingStep } from '../../src/utils/onboarding-validation';

test('step validation is scoped and optional identity fields stay optional', () => {
  expect(validateOnboardingStep({ name: '虚构分步' }, 0)).toEqual({});
  expect(validateOnboardingStep({ name: '', phone: '12345', idNumber: '123' }, 0)).toEqual({
    'employee.name': '请填写姓名', 'profile.phone': '请填写完整的 11 位手机号',
    'profile.idNumber': '请填写完整的身份证号，或清空后稍后补充',
  });
});

test('employment step blocks missing company mapping and required fields', () => {
  const missing = validateOnboardingStep({}, 1);
  expect(Object.keys(missing)).toEqual(['employee.companyText', 'employee.deptId', 'employee.entryDate', 'employee.effectiveFrom', 'employee.employmentType', 'employee.employeeStatus']);
  const filled = { company: 'fuede', deptId: 'department', entryDate: '2026-11-13', effectiveFrom: '2026-11-13',
    employmentType: 'full_time', employeeStatus: 'probation', employee: { contractSubjectId: 'subject', companyText: '虚构主体' } };
  expect(validateOnboardingStep(filled, 1)).toEqual({});
  expect(validateOnboardingStep({ ...filled, company: null }, 1)['employee.companyText']).toContain('映射');
  expect(validateOnboardingStep({ ...filled, entryDate: '2026-02-31' }, 1)['employee.entryDate']).toBe('请填写有效日期');
});

test('archive step validates supplied fields without making them required', () => {
  expect(validateOnboardingStep({}, 2)).toEqual({});
  expect(validateOnboardingStep({ profile: { school: '文'.repeat(201), childrenCount: 21, birthDate: '2025-02-29' },
    contracts: [{ name: '合'.repeat(201), expiresAt: '2026-02-31' }] }, 2)).toEqual({
    'profile.school': '最多填写 200 个字符', 'profile.childrenCount': '请填写 0 至 20 的整数', 'profile.birthDate': '请填写有效日期',
    'contracts.0.name': '最多填写 150 个字符', 'contracts.0.expiresAt': '请填写有效日期',
  });
  expect(validateOnboardingStep({ profile: { birthDate: '2024-02-29', childrenCount: 0 }, contracts: [{}] }, 2)).toEqual({});
});

test('step limits agree with archive column limits instead of accepting values the API rejects', () => {
  expect(validateOnboardingStep({ employee: { jobGrade: '文'.repeat(31) } }, 1)['employee.jobGrade']).toBe('最多填写 30 个字符');
  expect(validateOnboardingStep({ profile: { gender: '文'.repeat(21), childrenStatus: '文'.repeat(31) },
    contracts: [{ name: '文'.repeat(151), confidentialityAgreement: '文'.repeat(51) }] }, 2)).toMatchObject({
    'profile.gender': '最多填写 20 个字符', 'profile.childrenStatus': '最多填写 30 个字符',
    'contracts.0.name': '最多填写 150 个字符', 'contracts.0.confidentialityAgreement': '最多填写 50 个字符',
  });
});
