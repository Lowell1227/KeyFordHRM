import { SysRole } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

const operator = { id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true };
const user = () => ({
  id: 'employee-1', employeeNo: '001', name: '员工甲', phone: null, deptId: 'dept-1',
  positionId: null, position: null, entryDate: new Date('2024-01-01'), plannedRegularDate: null,
  actualRegularDate: null, leaveDate: null, employmentType: 'full_time', status: 'active',
  directManagerId: null, deletedAt: null, employeeProfile: null, employeeContracts: [],
  employmentHistory: [{ company: 'fuede', companyText: '花名册公司原文', directManagerId: null }],
});

describe('employee company text', () => {
  function incompleteArchiveReview(overrides: {
    current?: Record<string, unknown>; base?: Record<string, unknown>; proposed?: Record<string, unknown>;
    userId?: string | null; sourceType?: string;
  } = {}) {
    const current = { ...user(), deptId: null, entryDate: null, ...overrides.current };
    const employee = { employeeNo: '001', name: '员工甲', company: 'fuede', companyText: '花名册公司原文',
      deptId: null, entryDate: null, employmentType: 'full_time', employeeStatus: 'active', ...overrides.base };
    const request = { id: 'review-1', userId: overrides.userId === undefined ? current.id : overrides.userId,
      intakeType: null, sourceType: overrides.sourceType ?? 'manual_archive_change', sourceBatchId: null,
      recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [],
      baseValue: { employee }, proposedValue: { employee: { ...employee, companyText: '已补公司', ...overrides.proposed },
        profile: { phone: '已审核测试号码' }, contracts: [{ id: 'contract-1', contractType: 'contract', signedAt: '2025-01-01' }] } };
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(current), update: jest.fn(), create: jest.fn() },
      employeeDataChangeRequest: { findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      employeeContract: { findMany: jest.fn().mockResolvedValue([{ id: 'contract-1', contractType: 'contract', sequence: 0 }]), update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const service = new EmployeeDataReviewsService({ $transaction: async (run: any) => run(tx) } as any);
    return { tx, approve: () => service.approveBatch({ requestIds: ['review-1'], scopes: ['profile'] }, operator) };
  }

  it('allows existing missing department and entry date to remain while other archive fields are corrected', async () => {
    const { tx, approve } = incompleteArchiveReview();
    const result = await approve();
    expect(result.failed).toEqual([]);
    expect(result.succeeded).toEqual([{ requestId: 'review-1', scopes: ['profile'] }]);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'employee-1' }, data: expect.objectContaining({ deptId: null, entryDate: null }) });
    expect(tx.employmentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ companyText: '已补公司', deptId: null, entryDate: null }) });
    expect(tx.employeeProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { phone: '已审核测试号码' } }));
    expect(tx.employeeContract.update).toHaveBeenCalledWith({ where: { id: 'contract-1' }, data: expect.objectContaining({ signedAt: new Date('2025-01-01'), signingCompany: null }) });
  });

  it.each([
    { label: 'existing department cleared', current: { deptId: 'dept-1' }, base: { deptId: 'dept-1' }, proposed: { deptId: null }, reason: '所属部门不能为空' },
    { label: 'existing entry date cleared', current: { entryDate: new Date('2024-01-01') }, base: { entryDate: '2024-01-01' }, proposed: { entryDate: null }, reason: '入职日期不能为空' },
    { label: 'new employee without department', userId: null, sourceType: 'manual_employee_create', reason: '所属部门不能为空' },
    { label: 'new employee without entry date', userId: null, sourceType: 'manual_employee_create', base: { deptId: 'dept-1' }, reason: '入职日期不能为空' },
    { label: 'invalid date entered', proposed: { entryDate: 'not-a-date' }, reason: '入职日期不能为空' },
    { label: 'stale empty baseline', current: { deptId: 'new-dept' }, reason: '正式基础档案已发生变化，请重新提交审核' },
  ])('keeps validation for $label', async ({ label: _label, reason, ...overrides }) => {
    const { tx, approve } = incompleteArchiveReview(overrides);
    expect((await approve()).failed).toEqual([{ requestId: 'review-1', reason }]);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
  });

  it.each(['另一家签约公司', null])('submits a company-text-only correction without changing scope: %s', async (companyText) => {
    const create = jest.fn(async ({ data }) => ({ id: 'review-1', ...data }));
    const service = new EmployeeArchivesService({
      user: { findUnique: jest.fn().mockResolvedValue(user()) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as any);
    const result = await service.submitDraft('employee-1', { employee: { companyText }, profile: {} }, operator);
    expect(result.profileReviewStatus).toBe('pending');
    expect(result.performanceReviewStatus).toBe('not_required');
    expect(result.baseValue).toMatchObject({ employee: { company: 'fuede', companyText: '花名册公司原文' } });
    expect(result.proposedValue).toMatchObject({ employee: { company: 'fuede', companyText } });
  });

  it.each([42, '甲'.repeat(151)])('rejects invalid company text before saving a draft', async (companyText) => {
    const create = jest.fn();
    const service = new EmployeeArchivesService({
      user: { findUnique: jest.fn().mockResolvedValue(user()) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as any);
    await expect(service.submitDraft('employee-1', { employee: { companyText }, profile: {} }, operator))
      .rejects.toThrow('所属公司须为不超过150字的文字');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { stale: false, companyText: '另一家签约公司', expected: '另一家签约公司' },
    { stale: false, companyText: null, expected: null },
    { stale: false, companyText: undefined, expected: '花名册公司原文' },
    { stale: true, companyText: '另一家签约公司', expected: null },
  ])('applies company text without losing legacy values ($companyText, stale=$stale)', async ({ stale, companyText, expected }) => {
    const current = user();
    const baseEmployee = { employeeNo: '001', name: '员工甲', company: 'fuede', companyText: '花名册公司原文',
      deptId: 'dept-1', entryDate: '2024-01-01T00:00:00.000Z', employmentType: 'full_time', employeeStatus: 'active' };
    const request = {
      id: 'review-1', userId: current.id, intakeType: null, sourceType: 'manual_archive_change', sourceBatchId: null,
      recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [],
      baseValue: { employee: companyText === undefined ? { ...baseEmployee, companyText: undefined } : baseEmployee },
      proposedValue: { employee: { ...baseEmployee, companyText, ...(companyText === undefined ? { position: '新岗位' } : {}) } },
    };
    if (companyText === undefined) {
      delete (request.baseValue.employee as Record<string, unknown>).companyText;
      delete request.proposedValue.employee.companyText;
    }
    if (stale) current.employmentHistory[0].companyText = '已被他人更正';
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(current), update: jest.fn() },
      employeeDataChangeRequest: { findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
      employmentRecord: { findFirst: jest.fn(async ({ select }) => select.companyText ? { companyText: '花名册公司原文' } : null),
        create: jest.fn(), update: jest.fn() },
      employeeContract: { findMany: jest.fn().mockResolvedValue([]) }, auditLog: { create: jest.fn() },
    };
    const service = new EmployeeDataReviewsService({ $transaction: async (run: any) => run(tx) } as any);
    const result = await service.approveBatch({ requestIds: ['review-1'], scopes: ['profile'] }, operator);
    if (stale) {
      expect(result.failed).toEqual([{ requestId: 'review-1', reason: '正式基础档案已发生变化，请重新提交审核' }]);
      expect(tx.employmentRecord.create).not.toHaveBeenCalled();
    } else {
      expect(result.failed).toEqual([]);
      expect(tx.employmentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        company: 'fuede', companyText: expected,
      }) });
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: current.id }, data: expect.not.objectContaining({ sysRole: expect.anything() }) });
    }
  });
});
