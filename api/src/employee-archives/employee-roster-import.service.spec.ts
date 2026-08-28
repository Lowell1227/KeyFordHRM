import { SysRole } from '@prisma/client';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import type { ParsedEmployeeRosterRow } from './employee-roster.excel';

function row(rowNumber: number, employeeNo: string, name: string): ParsedEmployeeRosterRow {
  return {
    rowNumber,
    employee: {
      name,
      employeeNo,
      companyText: '孚德',
      departmentPath: ['项目中心'],
      position: '项目经理',
      jobGrade: 'P4',
      jobFamily: '项目管理',
      managerName: null,
      entryDate: new Date('2024-01-01T00:00:00.000Z'),
      workLocation: '杭州',
      employmentTypeText: '全职',
      employeeStatusText: '正式',
      probationMonths: null,
      plannedRegularDate: null,
      actualRegularDate: null,
    },
    profile: {
      phone: null,
      gender: null,
      birthDate: null,
      ethnicity: null,
      education: null,
      professionalTitle: null,
      school: null,
      graduationDate: null,
      major: null,
      maritalStatus: null,
      childrenStatus: null,
      childrenCount: null,
      politicalStatus: null,
      nativePlace: null,
      householdType: null,
      idAddress: null,
      idNumber: null,
      currentAddress: null,
      emergencyContactName: null,
      emergencyContactRelation: null,
      emergencyContactPhone: null,
      socialSecurityStatus: null,
      socialSecurityStartDate: null,
      housingFundStatus: null,
      housingFundStartDate: null,
      bankName: null,
      bankBranch: null,
      bankAccount: null,
    },
    contracts: [],
  };
}

describe('EmployeeRosterImportService', () => {
  it('全量预检以花名册生成组织方案，缺少现有部门时不阻断确认', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-new-org' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-new-org', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const rosterRow = row(2, '001', '李宏');
    rosterRow.employee.companyText = '孚德';
    rosterRow.employee.departmentPath = ['总经办'];

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'full', fileName: '花名册.xlsx', fileHash: 'hash-new-org' },
      { id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true },
    );

    expect(result).toMatchObject({
      canConfirm: true,
      summary: { desiredDepartmentCount: 1, blockingErrorCount: 0 },
    });
    expect(persistedRows[0].normalizedValue.employee).toEqual(expect.objectContaining({
      organizationKey: JSON.stringify(['总经办']),
      deptId: null,
    }));
  });

  it('存量员工工号为空时按唯一姓名和部门匹配，避免创建重复人员', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'legacy-wang', employeeNo: null, name: '王琳', position: '平面设计师',
          deptId: 'legacy-design', status: 'active', accountType: 'employee',
          dept: { name: '创意设计部', fullPath: '创意设计部' },
        }]),
      },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-match-legacy' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-match-legacy', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const rosterRow = row(2, '286', '王琳（男）');
    rosterRow.employee.companyText = '孚德';
    rosterRow.employee.departmentPath = ['创意设计部'];
    rosterRow.employee.position = '平面设计师';

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'full', fileName: '花名册.xlsx', fileHash: 'hash-match-legacy' },
      { id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true },
    );

    expect(result.summary).toMatchObject({ createCount: 0, updateCount: 1 });
    expect(persistedRows[0]).toEqual(expect.objectContaining({
      matchedUserId: 'legacy-wang',
      action: 'update',
    }));
  });

  it('同工号姓名变化且账号已绑定钉钉时阻断导入，避免把真实身份换给另一人', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'bound-user', employeeNo: '001', name: '原姓名', position: '专员',
          deptId: 'dept-old', status: 'active', accountType: 'employee', dept: null,
          externalIdentityBindings: [{ status: 'enabled' }],
        }]),
      },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-bound-rename' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-bound-rename', ...data })),
      },
      employeeImportRow: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const rosterRow = row(2, '001', '新姓名');
    rosterRow.employee.departmentPath = ['总经办'];

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'full', fileName: '花名册.xlsx', fileHash: 'hash-bound-rename' },
      { id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true },
    );

    expect(result).toMatchObject({ canConfirm: false, summary: { blockingErrorCount: 1 } });
  });

  it('全量预检只保存批次差异，不写员工正式数据，并把文件缺行列为疑似离职', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-001', employeeNo: '001', name: '李宏' },
          { id: 'user-999', employeeNo: '999', name: '文件未出现人员' },
        ]),
        create: jest.fn(),
        update: jest.fn(),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-project', name: '项目中心', fullPath: '项目中心', company: 'fuede' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-1', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: { create: jest.fn() },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1',
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: true,
    };

    const result = await service.createPreviewFromRows([
      row(2, '001', '李宏'),
      row(3, '002', '新员工'),
    ], {
      mode: 'full',
      fileName: '花名册.xlsx',
      fileHash: 'hash-1',
    }, operator);

    expect(result).toMatchObject({
      batchId: 'batch-1',
      canConfirm: true,
      summary: {
        totalRows: 2,
        createCount: 1,
        updateCount: 1,
        blockingErrorCount: 0,
        missingFromFullRosterCount: 1,
      },
    });
    expect(persistedRows).toHaveLength(3);
    expect(persistedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 3, action: 'create' }),
      expect.objectContaining({ matchedUserId: 'user-001', action: 'update' }),
      expect.objectContaining({ matchedUserId: 'user-999', action: 'possible_resignation' }),
    ]));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(prisma.employmentRecord.create).not.toHaveBeenCalled();
  });

  it('全量预检不把已离职账号再次列为疑似离职', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-001', employeeNo: '001', name: '李宏', deptId: 'dept-project', status: 'active' },
          { id: 'user-active-missing', employeeNo: '998', name: '在职缺失人员', deptId: 'dept-project', status: 'active' },
          { id: 'user-resigned-missing', employeeNo: '999', name: '已离职人员', deptId: null, status: 'resigned' },
        ]),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-project', name: '项目中心', fullPath: '项目中心', company: 'fuede' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-ignore-resigned' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-ignore-resigned', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.createPreviewFromRows(
      [row(2, '001', '李宏')],
      { mode: 'full', fileName: '花名册.xlsx', fileHash: 'hash-ignore-resigned' },
      operator,
    );

    expect(result.summary.missingFromFullRosterCount).toBe(1);
    expect(persistedRows.filter((item) => item.action === 'possible_resignation')).toEqual([
      expect.objectContaining({ matchedUserId: 'user-active-missing' }),
    ]);
  });

  it('重复工号是阻断项，不能确认导入', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-2' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-2', ...data })),
      },
      employeeImportRow: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.createPreviewFromRows([
      row(2, '002', '新员工'),
      row(3, '002', '另一姓名'),
    ], { mode: 'incremental', fileName: '增量.xlsx', fileHash: 'hash-2' }, operator);

    expect(result.canConfirm).toBe(false);
    expect(result.summary.blockingErrorCount).toBe(2);
  });

  it('组织路径唯一时直接匹配，部门元数据中的公司编码不影响员工公司', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-project', name: '项目一部', fullPath: '项目中心 / 项目一部', company: 'beijing_fuede' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-company-diff' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-company-diff', ...data })),
      },
      employeeImportRow: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };
    const rosterRow = row(2, '002', '新员工');
    rosterRow.employee.departmentPath = ['项目中心', '项目一部'];

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'incremental', fileName: '增量.xlsx', fileHash: 'hash-company-diff' },
      operator,
    );

    expect(result.canConfirm).toBe(true);
    expect(result.summary.blockingErrorCount).toBe(0);
    expect(result.summary.warningCount).toBe(0);
  });

  it('所属公司为空时不能从合并后的部门元数据反推公司', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-live', name: '直播电商部', fullPath: '项目中心/直播电商部', company: 'fuede_sports' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-infer-company' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-infer-company', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };
    const rosterRow = row(2, '002', '新员工');
    rosterRow.employee.companyText = null;
    rosterRow.employee.departmentPath = ['项目中心', '直播电商部'];

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'incremental', fileName: '增量.xlsx', fileHash: 'hash-infer-company' },
      operator,
    );

    expect(result.canConfirm).toBe(false);
    expect(result.summary.blockingErrorCount).toBe(1);
    expect(persistedRows[0]).toEqual(expect.objectContaining({
      action: 'blocked',
      errors: expect.arrayContaining(['所属公司不能为空']),
    }));
  });

  it('HRM 存在同名部门时，存量员工沿用自己的当前部门并列为提醒', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-001', employeeNo: '001', name: '李宏', deptId: 'dept-current' },
        ]),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-current', name: '总经办', fullPath: '总经办', company: 'fuede' },
          { id: 'dept-duplicate', name: '总经办', fullPath: null, company: 'fuede' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-duplicate-dept' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-duplicate-dept', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };
    const rosterRow = row(2, '001', '李宏');
    rosterRow.employee.departmentPath = ['总经办'];

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'incremental', fileName: '增量.xlsx', fileHash: 'hash-duplicate-dept' },
      operator,
    );

    expect(result.canConfirm).toBe(true);
    expect(result.summary.blockingErrorCount).toBe(0);
    expect(result.summary.warningCount).toBeGreaterThan(0);
    expect(persistedRows[0].normalizedValue.employee.deptId).toBe('dept-current');
  });

  it('直属上级无法按花名册或现有工号员工唯一匹配时阻断确认', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'dept-project', name: '项目中心', fullPath: '项目中心', company: 'fuede' },
        ]),
      },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-manager-missing' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-manager-missing', ...data })),
      },
      employeeImportRow: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };
    const rosterRow = row(2, '002', '新员工');
    rosterRow.employee.managerName = '不存在主管';

    const result = await service.createPreviewFromRows(
      [rosterRow],
      { mode: 'incremental', fileName: '增量.xlsx', fileHash: 'hash-manager-missing' },
      operator,
    );

    expect(result.canConfirm).toBe(false);
    expect(result.summary.blockingErrorCount).toBe(1);
  });

  it('同一花名册中有无效员工时仍允许提交其他有效员工', async () => {
    const persistedRows: any[] = [];
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      employeeImportBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-partial-valid' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-partial-valid', ...data })),
      },
      employeeImportRow: {
        createMany: jest.fn(async ({ data }: any) => {
          persistedRows.push(...data);
          return { count: data.length };
        }),
      },
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const valid = row(2, '001', '有效员工');
    valid.employee.departmentPath = ['项目中心'];
    const invalid = row(3, '002', '无效员工');
    invalid.employee.departmentPath = ['项目中心'];
    invalid.employee.managerName = '不存在主管';
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.createPreviewFromRows(
      [valid, invalid],
      { mode: 'full', fileName: '花名册.xlsx', fileHash: 'hash-partial-valid' },
      operator,
    );

    expect(result.canConfirm).toBe(true);
    expect(result.summary).toMatchObject({ createCount: 1, blockingErrorCount: 1 });
    expect(persistedRows.map((item) => item.action)).toEqual(['create', 'blocked']);
    expect(prisma.employeeImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-partial-valid' },
      data: expect.objectContaining({ status: 'ready_to_confirm' }),
    });
  });

  it('确认花名册后只生成待审核变更，未审核前不改正式员工数据', async () => {
    const parsed = row(2, '002', '新员工');
    parsed.profile.phone = '13800000000';
    parsed.profile.gender = '男';
    parsed.contracts = [{
      sequence: 0,
      kind: 'contract',
      name: '劳动合同',
      signedAt: new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      termText: '3年',
      originalCompany: null,
      newCompany: null,
      confidentialityAgreement: '已签',
      nonCompeteAgreement: '无',
      portraitAgreement: '已签',
    }];
    const tx = {
      employeeImportBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'batch-3', status: 'pending_review' }),
      },
      employeeImportRow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
      },
      user: {
        create: jest.fn(async ({ data }: any) => ({ id: 'new-user-002', ...data })),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      employeeProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'employment-1' }),
        update: jest.fn(),
      },
      employeeContract: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      employeeImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'batch-3',
          fileHash: 'hash-3',
          mode: 'incremental',
          status: 'ready_to_confirm',
          rows: [{
            rowNumber: 2,
            action: 'create',
            matchedUserId: null,
            errors: [],
            normalizedValue: {
              employee: {
                company: 'fuede',
                deptId: 'dept-project',
                employmentType: 'full_time',
                employeeStatus: 'active',
              },
            },
          }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.confirmFromRows('batch-3', [parsed], 'hash-3', operator);

    expect(result).toEqual({ batchId: 'batch-3', status: 'pending_review', submitted: 1 });
    expect(tx.employeeDataChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: 'employee_roster_import',
        sourceBatchId: 'batch-3',
        sourceRowNumber: 2,
        employeeNo: '002',
        employeeName: '新员工',
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'pending',
      }),
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(tx.employeeContract.createMany).not.toHaveBeenCalled();
    expect(tx.employeeImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-3' },
      data: expect.objectContaining({ status: 'pending_review', confirmedById: 'hr-1' }),
    });
  });

  it('花名册直属主管变化只作为差异提示，不覆盖已审核的绩效直属上级', async () => {
    const parsed = row(2, '001', '存量员工');
    parsed.employee.managerName = '花名册新主管';
    const reviewCreate = jest.fn().mockResolvedValue({ id: 'review-existing' });
    const officialUserUpdate = jest.fn();
    const tx = {
      employeeImportBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'batch-existing', status: 'pending_review' }),
      },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: reviewCreate },
      user: {
        findUnique: jest.fn().mockResolvedValue({ directManagerId: 'performance-manager-approved' }),
        update: officialUserUpdate,
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-existing' }) },
    };
    const prisma = {
      employeeImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'batch-existing',
          fileHash: 'hash-existing',
          mode: 'incremental',
          status: 'ready_to_confirm',
          summary: {},
          rows: [{
            rowNumber: 2,
            action: 'update',
            matchedUserId: 'employee-existing',
            errors: [],
            normalizedValue: {
              employee: {
                company: 'fuede',
                deptId: 'dept-project',
                employmentType: 'full_time',
                employeeStatus: 'active',
              },
            },
          }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    await service.confirmFromRows('batch-existing', [parsed], 'hash-existing', operator);

    expect(reviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        performanceReviewStatus: 'not_required',
        proposedValue: expect.objectContaining({
          performance: {
            managerId: 'performance-manager-approved',
            suggestedRosterManagerName: '花名册新主管',
          },
        }),
      }),
    });
    expect(officialUserUpdate).not.toHaveBeenCalled();
  });

  it('重复确认与正式档案一致的花名册时不生成无效待审核记录', async () => {
    const parsed = row(2, '001', '存量员工');
    parsed.employee.managerName = '花名册主管';
    parsed.contracts = [{
      sequence: 0, kind: 'contract', name: '劳动合同',
      signedAt: new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-31T00:00:00.000Z'), termText: '3年',
      originalCompany: null, newCompany: null, confidentialityAgreement: '已签',
      nonCompeteAgreement: '无', portraitAgreement: '已签',
    }];
    const today = new Date('2026-08-24T00:00:00.000Z');
    const reviewCreate = jest.fn();
    const tx = {
      employeeImportBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(async ({ data }: any) => ({ id: 'batch-unchanged', ...data })),
      },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: reviewCreate },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee-existing', employeeNo: '001', name: '存量员工', phone: null,
          deptId: 'dept-project', position: '项目经理', entryDate: new Date('2024-01-01T00:00:00.000Z'),
          plannedRegularDate: null, actualRegularDate: null, leaveDate: null,
          employmentType: 'full_time', status: 'active', directManagerId: 'performance-manager-approved',
          employeeProfile: null,
          employeeContracts: [{
            id: 'contract-1', contractType: 'contract', sequence: 0, name: '劳动合同',
            signingCompany: parsed.employee.companyText,
            signedAt: new Date('2024-01-01T00:00:00.000Z'),
            effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-12-31T00:00:00.000Z'), termType: '3年',
            originalCompany: null, newCompany: null, confidentialityAgreement: '已签',
            nonCompeteAgreement: '无', portraitAgreement: '已签',
          }],
          dept: { parentId: null, leaderId: null },
          employmentHistory: [{
            company: 'fuede', jobGrade: 'P4', jobFamily: '项目管理', directManagerId: 'roster-manager',
            directManager: { id: 'roster-manager', name: '花名册主管' }, workLocation: '杭州',
            probationMonths: null, effectiveFrom: today, effectiveTo: null,
          }],
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-unchanged' }) },
    };
    const prisma = {
      employeeImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'batch-unchanged', fileHash: 'hash-unchanged', mode: 'incremental',
          status: 'ready_to_confirm', summary: {},
          rows: [{
            rowNumber: 2, action: 'update', matchedUserId: 'employee-existing', errors: [],
            normalizedValue: {
              employee: {
                company: 'fuede', deptId: 'dept-project', employmentType: 'full_time', employeeStatus: 'active',
              },
            },
          }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.confirmFromRows('batch-unchanged', [parsed], 'hash-unchanged', operator);

    expect(result).toEqual({ batchId: 'batch-unchanged', status: 'completed', submitted: 0 });
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(tx.employeeImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-unchanged' },
      data: expect.objectContaining({ status: 'completed' }),
    });
  });

  it('全量确认只暂存组织方案，并把文件缺行员工提交为待审核停用', async () => {
    const parsed = row(2, '001', '李宏');
    parsed.employee.companyText = '孚德';
    parsed.employee.departmentPath = ['总经办'];
    const departmentCreate = jest.fn().mockResolvedValueOnce({ id: 'dept-executive' });
    const transactionUserUpdate = jest.fn();
    const transactionUserUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const reviewCreate = jest.fn().mockResolvedValue({ id: 'review-full' });
    const departmentReviewCreate = jest.fn()
      .mockResolvedValueOnce({ id: 'department-create-review' })
      .mockResolvedValueOnce({ id: 'department-delete-review' });
    const tx = {
      employeeImportBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'batch-full', status: 'completed' }),
      },
      employeeImportRow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: reviewCreate },
      departmentChangeRequest: { create: departmentReviewCreate },
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'dept-old', fullPath: '外援', name: '外援', parentId: null, leaderId: null,
          company: 'fuede', sortOrder: 0, isActive: true, _count: { members: 0, children: 0 },
        }]),
        create: departmentCreate,
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        create: jest.fn(),
        update: transactionUserUpdate,
        updateMany: transactionUserUpdateMany,
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            employeeNo: '001', name: '李宏', phone: null, deptId: 'dept-executive', position: '董事长',
            entryDate: new Date('2024-01-01T00:00:00.000Z'), plannedRegularDate: null,
            actualRegularDate: null, leaveDate: null, employmentType: 'full_time', status: 'active',
            directManagerId: null, employeeProfile: null, employmentHistory: [],
          })
          .mockResolvedValueOnce({
            employeeNo: null, name: '旧员工', phone: null, deptId: 'dept-old', position: '旧岗位',
            entryDate: new Date('2023-01-01T00:00:00.000Z'), plannedRegularDate: null,
            actualRegularDate: null, leaveDate: null, employmentType: 'full_time', status: 'active',
            directManagerId: null, employeeProfile: null, employmentHistory: [{
              id: 'missing-employment', effectiveFrom: new Date('2023-01-01T00:00:00.000Z'),
              company: 'fuede', jobGrade: null, jobFamily: null, directManagerId: null,
              workLocation: null, probationMonths: null,
            }],
          }),
      },
      externalIdentityBinding: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      employeeProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
      employmentRecord: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'missing-employment', effectiveFrom: new Date('2024-01-01T00:00:00.000Z') }),
        create: jest.fn().mockResolvedValue({ id: 'employment-1' }),
        update: jest.fn().mockResolvedValue({ id: 'employment-updated' }),
      },
      employeeContract: { createMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      employeeImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'batch-full',
          fileHash: 'hash-full',
          mode: 'full',
          status: 'ready_to_confirm',
          summary: {},
          rows: [
            {
              rowNumber: 2,
              action: 'update',
              matchedUserId: 'user-001',
              errors: [],
              normalizedValue: {
                employee: {
                  company: 'fuede',
                  organizationKey: JSON.stringify(['总经办']),
                  deptId: null,
                  employmentType: 'full_time',
                  employeeStatus: 'active',
                },
              },
            },
            {
              rowNumber: 4,
              action: 'possible_resignation',
              matchedUserId: 'user-missing',
              errors: [],
              normalizedValue: { employeeNo: null, name: '旧员工' },
            },
          ],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    const result = await service.confirmFromRows('batch-full', [parsed], 'hash-full', operator);

    expect(result).toEqual({ batchId: 'batch-full', status: 'pending_review', submitted: 2 });
    expect(departmentCreate).not.toHaveBeenCalled();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
    expect(departmentReviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'create',
        departmentId: null,
        departmentName: '总经办',
        proposedValue: expect.objectContaining({ fullPath: '总经办', parentFullPath: null }),
        createdById: 'hr-1',
      }),
    });
    expect(departmentReviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'delete',
        departmentId: 'dept-old',
        departmentName: '外援',
        createdById: 'hr-1',
      }),
    });
    expect(reviewCreate).toHaveBeenCalledTimes(2);
    expect(reviewCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        proposedValue: expect.objectContaining({
          employee: expect.objectContaining({
            organizationPath: ['总经办'],
            organizationLeaderPaths: [['总经办']],
          }),
        }),
      }),
    });
    expect(reviewCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        userId: 'user-missing',
        profileReviewStatus: 'pending',
        performanceReviewStatus: 'not_required',
        proposedValue: expect.objectContaining({
          employee: expect.objectContaining({ employeeStatus: 'resigned' }),
        }),
      }),
    });
    expect(transactionUserUpdate).not.toHaveBeenCalled();
    expect(transactionUserUpdateMany).not.toHaveBeenCalled();
    expect(tx.externalIdentityBinding.updateMany).not.toHaveBeenCalled();
  });

  it('增量确认不会用空单元格清空旧档案和任职字段', async () => {
    const parsed = row(2, '001', '李宏');
    parsed.employee.position = '高级项目经理';
    parsed.employee.jobGrade = null;
    parsed.employee.jobFamily = null;
    parsed.employee.managerName = null;
    parsed.employee.workLocation = null;
    parsed.employee.employmentTypeText = null;
    parsed.employee.employeeStatusText = null;
    parsed.employee.probationMonths = null;
    parsed.employee.plannedRegularDate = null;
    parsed.employee.actualRegularDate = null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tx = {
      employeeImportBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'batch-4', status: 'completed' }),
      },
      employeeImportRow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          employeeNo: '001', name: '李宏', phone: '13800000000', deptId: 'dept-project', position: '项目经理',
          entryDate: new Date('2024-01-01T00:00:00.000Z'),
          plannedRegularDate: new Date('2024-04-01T00:00:00.000Z'),
          actualRegularDate: new Date('2024-04-01T00:00:00.000Z'), leaveDate: null,
          employmentType: 'full_time', status: 'active', directManagerId: 'manager-1', employeeProfile: null,
          employmentHistory: [{
            id: 'employment-current', effectiveFrom: today, company: 'fuede', deptId: 'dept-project',
            position: '项目经理', jobGrade: 'P5', jobFamily: '项目管理', directManagerId: 'manager-1',
            workLocation: '杭州', employmentType: 'full_time', employeeStatus: 'active',
            entryDate: new Date('2024-01-01T00:00:00.000Z'),
            plannedRegularDate: new Date('2024-04-01T00:00:00.000Z'),
            actualRegularDate: new Date('2024-04-01T00:00:00.000Z'), probationMonths: 3,
          }],
        }),
      },
      employeeDataChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'review-4' }),
      },
      employeeProfile: { upsert: jest.fn() },
      employmentRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'employment-current',
          effectiveFrom: today,
          company: 'fuede',
          deptId: 'dept-project',
          position: '项目经理',
          jobGrade: 'P5',
          jobFamily: '项目管理',
          directManagerId: 'manager-1',
          workLocation: '杭州',
          employmentType: 'full_time',
          employeeStatus: 'active',
          entryDate: new Date('2024-01-01T00:00:00.000Z'),
          plannedRegularDate: new Date('2024-04-01T00:00:00.000Z'),
          actualRegularDate: new Date('2024-04-01T00:00:00.000Z'),
          probationMonths: 3,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'employment-current' }),
      },
      employeeContract: { createMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      employeeImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'batch-4',
          fileHash: 'hash-4',
          mode: 'incremental',
          status: 'ready_to_confirm',
          rows: [{
            rowNumber: 2,
            action: 'update',
            matchedUserId: 'user-001',
            errors: [],
            normalizedValue: {
              employee: {
                company: 'fuede',
                deptId: 'dept-project',
                employmentType: 'full_time',
                employeeStatus: 'active',
              },
            },
          }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new EmployeeRosterImportService(prisma as any);
    const operator = {
      id: 'hr-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true,
    };

    await service.confirmFromRows('batch-4', [parsed], 'hash-4', operator);

    const reviewData = tx.employeeDataChangeRequest.create.mock.calls[0][0].data;
    expect(reviewData.proposedValue.employee).toEqual(expect.objectContaining({
      phone: '13800000000',
      jobGrade: 'P5',
      jobFamily: '项目管理',
      workLocation: '杭州',
      plannedRegularDate: '2024-04-01T00:00:00.000Z',
      actualRegularDate: '2024-04-01T00:00:00.000Z',
      probationMonths: 3,
    }));
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.employmentRecord.update).not.toHaveBeenCalled();
  });

  it('花名册合同比较覆盖签约公司和生效日期，但不因导入格式缺少 ID 误判', () => {
    const service = new EmployeeRosterImportService({} as any);
    const current = [{
      id: 'contract-1', contractType: 'contract', sequence: 0, name: '劳动合同',
      signingCompany: '孚德', signedAt: new Date('2024-01-01'),
      effectiveFrom: new Date('2024-01-02'), expiresAt: new Date('2026-12-31'), termType: '3年',
    }];
    const proposed = [{
      kind: 'contract', sequence: 0, name: '劳动合同', signingCompany: '孚德',
      signedAt: new Date('2024-01-01'), effectiveFrom: new Date('2024-01-02'),
      expiresAt: new Date('2026-12-31'), termText: '3年',
    }];

    expect((service as any).sameContractSet(current, proposed)).toBe(true);
    expect((service as any).sameContractSet(current, [{ ...proposed[0], signingCompany: '北京孚德' }])).toBe(false);
    expect((service as any).sameContractSet(current, [{ ...proposed[0], effectiveFrom: new Date('2024-02-01') }])).toBe(false);
  });
});
