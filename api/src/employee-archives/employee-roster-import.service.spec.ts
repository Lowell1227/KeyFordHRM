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

  it('组织路径唯一时允许跨公司编码匹配，并把公司差异列为提醒', async () => {
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
    expect(result.summary.warningCount).toBeGreaterThan(0);
  });

  it('所属公司为空但部门唯一时，从 HRM 部门推导公司并列为提醒', async () => {
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

    expect(result.canConfirm).toBe(true);
    expect(result.summary.blockingErrorCount).toBe(0);
    expect(result.summary.warningCount).toBeGreaterThan(0);
    expect(persistedRows[0].normalizedValue.employee.company).toBe('fuede_sports');
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

  it('确认时校验同一文件，并在一个事务中创建账号、档案、任职和合同', async () => {
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
        update: jest.fn().mockResolvedValue({ id: 'batch-3', status: 'completed' }),
      },
      employeeImportRow: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

    expect(result).toEqual({ batchId: 'batch-3', status: 'completed', created: 1, updated: 0 });
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeProfile.upsert).toHaveBeenCalledTimes(1);
    expect(tx.employmentRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeContract.createMany).toHaveBeenCalledTimes(1);
    expect(tx.employeeImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-3' },
      data: expect.objectContaining({ status: 'completed', confirmedById: 'hr-1' }),
    });
  });

  it('增量确认不会用空单元格清空旧档案和任职字段', async () => {
    const parsed = row(2, '001', '李宏');
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

    const projectionUpdate = tx.user.update.mock.calls.find(([call]) => 'name' in call.data)?.[0];
    expect(projectionUpdate.data).not.toHaveProperty('phone');
    expect(projectionUpdate.data).not.toHaveProperty('plannedRegularDate');
    expect(projectionUpdate.data).not.toHaveProperty('actualRegularDate');
    expect(tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(tx.employmentRecord.update).toHaveBeenCalledWith({
      where: { id: 'employment-current' },
      data: expect.objectContaining({
        jobGrade: 'P5',
        jobFamily: '项目管理',
        directManagerId: 'manager-1',
        workLocation: '杭州',
        plannedRegularDate: new Date('2024-04-01T00:00:00.000Z'),
        actualRegularDate: new Date('2024-04-01T00:00:00.000Z'),
        probationMonths: 3,
      }),
    });
  });
});
