import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, StreamableFile } from '@nestjs/common';
import { PerfGrade, Prisma, SysRole, TaskStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { ReportFormat } from './dto/report-query.dto';

function makeViewer(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'viewer-1',
    name: 'Viewer',
    sysRole: SysRole.hr,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: false,
    ...overrides,
  } as AuthUser;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    cycleId: 'cycle-1',
    employeeId: 'emp-1',
    deptId: 'dept-1',
    managerId: 'mgr-1',
    approverId: 'vp-1',
    isExempt: false,
    employee: { id: 'emp-1', name: '张三', employeeNo: 'E001', position: '工程师' },
    dept: { name: '研发部' },
    manager: { name: '李主管' },
    gradeResult: {
      calculatedScore: new Prisma.Decimal(85),
      rawGrade: 'B' as PerfGrade,
      calibratedGrade: null,
    },
    ...overrides,
  };
}

function makeCycle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cycle-1',
    name: 'Q1',
    deadlineIndicatorSetting: null,
    deadlineIndicatorConfirm: null,
    deadlineSelfEval: null,
    deadlineManagerScore: null,
    deadlineHrCalibration: null,
    deadlineApproval: null,
    deadlinePublish: null,
    ...overrides,
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: {
    assessmentCycle: { findUnique: jest.Mock };
    assessmentTask: { findMany: jest.Mock; groupBy: jest.Mock; findFirst: jest.Mock };
    performanceArchive: { findMany: jest.Mock };
    gradeResult: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let dataScope: { getSubDeptIds: jest.Mock; getVisibleEmployeeFilter: jest.Mock };

  beforeEach(async () => {
    prisma = {
      assessmentCycle: { findUnique: jest.fn() },
      assessmentTask: { findMany: jest.fn(), groupBy: jest.fn(), findFirst: jest.fn() },
      performanceArchive: { findMany: jest.fn() },
      gradeResult: { findMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    dataScope = {
      getSubDeptIds: jest.fn().mockResolvedValue(['dept-1', 'dept-1-1']),
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({ OR: [{ directManagerId: 'mgr-1' }, { id: 'mgr-1' }] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DataScopeService, useValue: dataScope },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCycleSummary', () => {
    it('HR 查看汇总：返回全部非豁免任务并正确统计', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({
          id: 't1',
          employeeId: 'emp-1',
          approverId: 'vp-1',
          gradeResult: { calculatedScore: new Prisma.Decimal(92), rawGrade: 'A', calibratedGrade: null },
        }),
        makeTask({
          id: 't2',
          employeeId: 'emp-2',
          approverId: 'vp-2',
          gradeResult: { calculatedScore: new Prisma.Decimal(85), rawGrade: 'B', calibratedGrade: 'A' },
        }),
        makeTask({
          id: 't3',
          employeeId: 'emp-3',
          approverId: 'vp-2',
          gradeResult: { calculatedScore: new Prisma.Decimal(70), rawGrade: 'C', calibratedGrade: null },
        }),
      ]);

      const result = await service.getCycleSummary('cycle-1', {}, makeViewer({ sysRole: SysRole.hr }));

      expect(result).not.toBeInstanceOf(StreamableFile);
      const summary = result as Exclude<typeof result, StreamableFile>;
      expect(summary.stats.total).toBe(3);
      expect(summary.stats.grades.A).toEqual({ count: 2, ratio: 2 / 3 });
      expect(summary.stats.grades.C).toEqual({ count: 1, ratio: 1 / 3 });
      expect(summary.items).toHaveLength(3);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cycleId: 'cycle-1', isExempt: false }),
        }),
      );
    });

    it('VP 查看汇总：只返回 approver_id 等于自己的任务', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({ id: 't1', approverId: 'vp-1', gradeResult: { calculatedScore: new Prisma.Decimal(90), rawGrade: 'A', calibratedGrade: null } }),
      ]);

      const result = await service.getCycleSummary(
        'cycle-1',
        {},
        makeViewer({ id: 'vp-1', sysRole: SysRole.vp }),
      );

      const summary = result as Exclude<typeof result, StreamableFile>;
      expect(summary.items).toHaveLength(1);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ approverId: 'vp-1' }),
        }),
      );
    });

    it('canViewAll=true 的董事长查看汇总：返回全量', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({ id: 't1', approverId: 'vp-1' }),
        makeTask({ id: 't2', approverId: 'vp-2' }),
      ]);

      const result = await service.getCycleSummary(
        'cycle-1',
        {},
        makeViewer({ id: 'chair-1', sysRole: SysRole.chairman, canViewAll: true }),
      );

      const summary = result as Exclude<typeof result, StreamableFile>;
      expect(summary.items).toHaveLength(2);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ approverId: expect.anything() }),
        }),
      );
    });

    it('grade 过滤按 calibratedGrade ?? rawGrade 匹配', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await service.getCycleSummary(
        'cycle-1',
        { grade: 'A' as PerfGrade },
        makeViewer({ sysRole: SysRole.hr }),
      );

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            gradeResult: {
              OR: [
                { calibratedGrade: 'A' },
                { calibratedGrade: null, rawGrade: 'A' },
              ],
            },
          }),
        }),
      );
    });

    it('deptId 过滤调用 getSubDeptIds', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await service.getCycleSummary(
        'cycle-1',
        { deptId: 'dept-1' },
        makeViewer({ sysRole: SysRole.hr }),
      );

      expect(dataScope.getSubDeptIds).toHaveBeenCalledWith('dept-1');
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deptId: { in: ['dept-1', 'dept-1-1'] },
          }),
        }),
      );
    });

    it('format=excel 返回 StreamableFile', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({ gradeResult: { calculatedScore: new Prisma.Decimal(90), rawGrade: 'A', calibratedGrade: null } }),
      ]);

      const result = await service.getCycleSummary(
        'cycle-1',
        { format: ReportFormat.excel },
        makeViewer({ sysRole: SysRole.hr }),
      );

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('format=excel 返回可解析的 xlsx 且数据与 JSON 一致', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({
          gradeResult: { calculatedScore: new Prisma.Decimal(90), rawGrade: 'A', calibratedGrade: null },
        }),
      ]);

      const jsonResult = await service.getCycleSummary(
        'cycle-1',
        {},
        makeViewer({ sysRole: SysRole.hr }),
      );
      const jsonSummary = jsonResult as Exclude<typeof jsonResult, StreamableFile>;

      const excelResult = await service.getCycleSummary(
        'cycle-1',
        { format: ReportFormat.excel },
        makeViewer({ sysRole: SysRole.hr }),
      );
      const streamable = excelResult as StreamableFile;
      const buffer = await streamToBuffer(streamable.getStream());

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['统计', '明细']);

      const detailSheet = workbook.getWorksheet('明细');
      const rows: Array<Record<string, unknown>> = [];
      detailSheet?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header
        const cells = row.values as unknown[];
        rows.push({
          employeeName: cells[1],
          employeeNo: cells[2],
          deptName: cells[3],
          position: cells[4],
          totalScore: cells[5],
          grade: cells[6],
          managerName: cells[7],
        });
      });

      expect(rows).toHaveLength(jsonSummary.items.length);
      expect(rows[0].employeeName).toBe(jsonSummary.items[0].employeeName);
      expect(rows[0].grade).toBe(jsonSummary.items[0].grade);
    });

    it('cycle 不存在抛 404', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(null);

      await expect(service.getCycleSummary('cycle-x', {}, makeViewer())).rejects.toThrow(NotFoundException);
    });

    it('输出项不含 coefficient', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({
          gradeResult: {
            calculatedScore: new Prisma.Decimal(90),
            rawGrade: 'A',
            calibratedGrade: null,
            coefficient: new Prisma.Decimal(1.2),
          },
        }),
      ]);

      const result = await service.getCycleSummary('cycle-1', {}, makeViewer());
      const summary = result as Exclude<typeof result, StreamableFile>;
      expect(summary.items[0]).not.toHaveProperty('coefficient');
      expect(summary.items[0].grade).toBe('A');
    });
  });

  describe('getCycleProgress', () => {
    it('按状态计数并计算超期节点', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(
        makeCycle({
          deadlineManagerScore: new Date('2000-01-01'),
          deadlineApproval: new Date('2099-12-31'),
        }),
      );
      prisma.assessmentTask.groupBy.mockResolvedValue([
        { status: 'manager_scoring' as TaskStatus, _count: { status: 2 } },
        { status: 'approval' as TaskStatus, _count: { status: 1 } },
        { status: 'published' as TaskStatus, _count: { status: 1 } },
      ]);
      prisma.assessmentTask.findMany.mockResolvedValue([
        { status: 'manager_scoring' as TaskStatus },
        { status: 'manager_scoring' as TaskStatus },
        { status: 'approval' as TaskStatus },
        { status: 'published' as TaskStatus },
      ]);

      const result = await service.getCycleProgress('cycle-1');

      expect(result.byStatus.manager_scoring).toBe(2);
      expect(result.byStatus.approval).toBe(1);
      expect(result.byStatus.published).toBe(1);
      expect(result.byStatus.closed).toBe(0);

      const managerNode = result.overdueByNode.find((n) => n.node === 'manager_scoring');
      const approvalNode = result.overdueByNode.find((n) => n.node === 'approval');
      expect(managerNode?.overdueCount).toBe(2);
      expect(approvalNode?.overdueCount).toBe(0);
    });

    it('deadline 为空时超期计数为 0', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.groupBy.mockResolvedValue([]);
      prisma.assessmentTask.findMany.mockResolvedValue([{ status: 'self_eval' as TaskStatus }]);

      const result = await service.getCycleProgress('cycle-1');

      const selfEvalNode = result.overdueByNode.find((n) => n.node === 'self_eval');
      expect(selfEvalNode?.overdueCount).toBe(0);
    });
  });

  describe('getCycleGradeList', () => {
    it('正确分出 A 名单和 D 名单', async () => {
      prisma.assessmentTask.findMany.mockResolvedValue([
        makeTask({
          id: 't1',
          gradeResult: { calculatedScore: new Prisma.Decimal(95), rawGrade: 'A', calibratedGrade: null },
        }),
        makeTask({
          id: 't2',
          gradeResult: { calculatedScore: new Prisma.Decimal(50), rawGrade: 'D', calibratedGrade: null },
        }),
        makeTask({
          id: 't3',
          gradeResult: { calculatedScore: new Prisma.Decimal(80), rawGrade: 'C', calibratedGrade: 'B' },
        }),
      ]);

      const result = await service.getCycleGradeList('cycle-1');

      expect(result.aList).toHaveLength(1);
      expect(result.aList[0].grade).toBe('A');
      expect(result.dList).toHaveLength(1);
      expect(result.dList[0].grade).toBe('D');
    });
  });

  describe('getEmployeeArchive', () => {
    it('员工本人可查看', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([]);
      prisma.gradeResult.findMany.mockResolvedValue([]);

      const result = await service.getEmployeeArchive('emp-1', makeViewer({ id: 'emp-1', sysRole: SysRole.employee }));
      expect(result).toEqual([]);
    });

    it('直接主管可查看', async () => {
      prisma.user.findUnique.mockResolvedValue({ directManagerId: 'mgr-1' });
      prisma.performanceArchive.findMany.mockResolvedValue([]);
      prisma.gradeResult.findMany.mockResolvedValue([]);

      const result = await service.getEmployeeArchive('emp-1', makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }));
      expect(result).toEqual([]);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-1' } }),
      );
    });

    it('担任过员工任务 manager_id 的主管可查看', async () => {
      prisma.user.findUnique.mockResolvedValue({ directManagerId: null });
      prisma.assessmentTask.findFirst.mockResolvedValue({ id: 'task-x' });
      prisma.performanceArchive.findMany.mockResolvedValue([]);
      prisma.gradeResult.findMany.mockResolvedValue([]);

      const result = await service.getEmployeeArchive('emp-1', makeViewer({ id: 'mgr-x', sysRole: SysRole.manager }));
      expect(result).toEqual([]);
      expect(prisma.assessmentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ employeeId: 'emp-1', managerId: 'mgr-x' }) }),
      );
    });

    it('HR / system_admin 可查看', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([]);
      prisma.gradeResult.findMany.mockResolvedValue([]);

      await expect(
        service.getEmployeeArchive('emp-1', makeViewer({ sysRole: SysRole.hr })),
      ).resolves.toEqual([]);
      await expect(
        service.getEmployeeArchive('emp-1', makeViewer({ sysRole: SysRole.system_admin })),
      ).resolves.toEqual([]);
    });

    it('非管理侧非本人查看抛 403', async () => {
      prisma.user.findUnique.mockResolvedValue({ directManagerId: 'mgr-1' });
      prisma.assessmentTask.findFirst.mockResolvedValue(null);

      await expect(
        service.getEmployeeArchive('emp-1', makeViewer({ id: 'other', sysRole: SysRole.employee })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('优先返回 performance_archives', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([
        {
          cycleId: 'cycle-1',
          cycle: { name: 'Q1', startDate: new Date('2024-01-01'), endDate: new Date('2024-03-31') },
          grade: 'A' as PerfGrade,
          totalScore: new Prisma.Decimal(95),
        },
      ]);

      const result = await service.getEmployeeArchive('emp-1', makeViewer({ id: 'emp-1', sysRole: SysRole.employee }));

      expect(result).toHaveLength(1);
      expect(result[0].grade).toBe('A');
      expect(result[0].totalScore).toBe(95);
      expect(prisma.gradeResult.findMany).not.toHaveBeenCalled();
    });

    it('无归档时回退已公示的 grade_results', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([]);
      prisma.gradeResult.findMany.mockResolvedValue([
        {
          task: {
            cycleId: 'cycle-1',
            cycle: { name: 'Q1', startDate: new Date('2024-01-01'), endDate: new Date('2024-03-31') },
          },
          calculatedScore: new Prisma.Decimal(88),
          rawGrade: 'B' as PerfGrade,
          calibratedGrade: 'A' as PerfGrade,
        },
      ]);

      const result = await service.getEmployeeArchive('emp-1', makeViewer({ id: 'emp-1', sysRole: SysRole.employee }));

      expect(result).toHaveLength(1);
      expect(result[0].grade).toBe('A');
      expect(result[0].totalScore).toBe(88);
    });
  });

  describe('exportCycle', () => {
    it('返回 StreamableFile', async () => {
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask()]);

      const result = await service.exportCycle('cycle-1');

      expect(result).toBeInstanceOf(StreamableFile);
    });
  });

  describe('导出列常量', () => {
    it('SUMMARY_COLUMNS 与 JSON 输出字段同源且不含 coefficient', () => {
      const keys = ReportsService.SUMMARY_COLUMNS.map((c) => c.key);
      expect(keys).toEqual(['employeeName', 'employeeNo', 'deptName', 'position', 'totalScore', 'grade', 'managerName']);
      expect(keys).not.toContain('coefficient');
    });

    it('GRADE_LIST_COLUMNS 与 SUMMARY_COLUMNS 同源', () => {
      expect(ReportsService.GRADE_LIST_COLUMNS).toBe(ReportsService.SUMMARY_COLUMNS);
    });
  });
});
