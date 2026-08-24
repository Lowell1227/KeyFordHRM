import { ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { AssessmentCycle, PerfGrade, Prisma, SysRole, TaskStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { ReportFormat, ReportQueryDto } from './dto/report-query.dto';
import {
  buildExportWorkbook,
  buildGradeListWorkbook,
  buildSummaryWorkbook,
  SUMMARY_COLUMNS,
  ReportItem,
} from './reports.excel';

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

/** 汇总报表单项。任务 ID 仅供 JSON 工作台详情入口使用，不参与导出列。 */
export interface ReportSummaryItem extends ReportItem {
  taskId: string;
}

/** 汇总报表统计。 */
export interface ReportSummaryStats {
  total: number;
  resulted: number;
  pending: number;
  qualified: number;
  qualifiedRate: number;
  grades: Record<PerfGrade, { count: number; ratio: number }>;
}

/** 汇总报表响应。 */
export interface ReportSummary {
  stats: ReportSummaryStats;
  items: ReportSummaryItem[];
}

/** 周期进度响应。 */
export interface CycleProgress {
  byStatus: Record<TaskStatus, number>;
  overdueByNode: Array<{ node: string; overdueCount: number }>;
}

/** A/D 级名单单项。 */
export interface GradeListItem extends ReportSummaryItem {}

/** 员工归档/趋势单项。 */
export interface EmployeeArchiveItem {
  cycleId: string;
  cycleName: string;
  startDate: Date;
  endDate: Date;
  grade: PerfGrade;
  totalScore: number;
}

/** 连续 D 预警名单单项。 */
export interface ConsecutiveDWarningItem {
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  consecutiveCount: number;
  archives: Array<{
    cycleId: string;
    cycleName: string;
    grade: PerfGrade;
    archivedAt: Date;
  }>;
}

/** 原始任务 + 关联数据（汇总/导出/名单共用）。 */
type TaskWithResult = Awaited<
  ReturnType<ReportsService['findSummaryTasks']>
>[number];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  // ============================================================================
  // GET /reports/cycle/:id/summary
  // ============================================================================

  async getCycleSummary(
    cycleId: string,
    dto: ReportQueryDto,
    viewer: AuthUser,
  ): Promise<ReportSummary | StreamableFile> {
    const summary = await this.buildSummary(cycleId, dto, viewer);

    const format = dto.format ?? ReportFormat.json;
    if (format === ReportFormat.excel) {
      const workbook = await buildSummaryWorkbook({
        stats: summary.stats,
        items: summary.items,
      });
      const buffer = await workbook.xlsx.writeBuffer();
      return new StreamableFile(buffer as any, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment; filename="reports-summary.xlsx"',
      });
    }

    return summary;
  }

  // ============================================================================
  // GET /reports/cycle/:id/progress
  // ============================================================================

  async getCycleProgress(cycleId: string): Promise<CycleProgress> {
    const cycle = await this.getCycleOrThrow(cycleId);

    const statusCounts = await this.prisma.assessmentTask.groupBy({
      by: ['status'],
      where: { cycleId },
      _count: { status: true },
    });

    const byStatus = {} as Record<TaskStatus, number>;
    for (const status of Object.values(TaskStatus)) {
      byStatus[status] = 0;
    }
    for (const sc of statusCounts) {
      byStatus[sc.status] = sc._count.status;
    }

    const tasks = await this.prisma.assessmentTask.findMany({
      where: { cycleId },
      select: { status: true },
    });

    const overdueByNode = this.buildOverdueByNode(tasks, cycle);

    return { byStatus, overdueByNode };
  }

  // ============================================================================
  // GET /reports/cycle/:id/grade-list
  // ============================================================================

  async getCycleGradeList(cycleId: string): Promise<{
    aList: GradeListItem[];
    cList: GradeListItem[];
    dList: GradeListItem[];
  }> {
    const tasks = await this.findSummaryTasks(cycleId, {});
    const items = tasks.map((t) => this.mapToSummaryItem(t));

    return {
      aList: items.filter((i) => i.grade === 'A'),
      cList: items.filter((i) => i.grade === 'C'),
      dList: items.filter((i) => i.grade === 'D'),
    };
  }

  // ============================================================================
  // GET /reports/employee/:id/archive
  // ============================================================================

  async getEmployeeArchive(employeeId: string, viewer: AuthUser): Promise<EmployeeArchiveItem[]> {
    await this.assertCanViewArchive(employeeId, viewer);

    const archives = await this.prisma.performanceArchive.findMany({
      where: { employeeId },
      include: {
        cycle: { select: { name: true, startDate: true, endDate: true } },
      },
      orderBy: { archivedAt: 'desc' },
    });

    if (archives.length > 0) {
      return archives.map((a) => ({
        cycleId: a.cycleId,
        cycleName: a.cycle.name,
        startDate: a.cycle.startDate,
        endDate: a.cycle.endDate,
        grade: a.grade,
        totalScore: a.totalScore.toNumber(),
      }));
    }

    // 回退：已公示的 grade_results
    const gradeResults = await this.prisma.gradeResult.findMany({
      where: {
        task: { employeeId },
        isPublished: true,
      },
      include: {
        task: {
          include: {
            cycle: { select: { name: true, startDate: true, endDate: true } },
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    });

    return gradeResults.map((gr) => ({
      cycleId: gr.task.cycleId,
      cycleName: gr.task.cycle.name,
      startDate: gr.task.cycle.startDate,
      endDate: gr.task.cycle.endDate,
      grade: (gr.calibratedGrade ?? gr.rawGrade) as PerfGrade,
      totalScore: gr.calculatedScore?.toNumber() ?? 0,
    }));
  }

  // ============================================================================
  // GET /reports/cycle/:id/export
  // ============================================================================

  async exportCycle(cycleId: string): Promise<StreamableFile> {
    const tasks = await this.findSummaryTasks(cycleId, {});
    const items = tasks.map((t) => this.mapToSummaryItem(t));

    const workbook = await buildExportWorkbook({
      items: items,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new StreamableFile(buffer as any, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="reports-export.xlsx"',
    });
  }

  // ============================================================================
  // GET /reports/consecutive-d-warning
  // ============================================================================

  async getConsecutiveDWarningList(viewer: AuthUser): Promise<ConsecutiveDWarningItem[]> {
    const scopeFilter = await this.dataScope.getVisibleEmployeeFilter(viewer);

    // 先取可见员工中最近两条归档都是 D 的人
    const archives = await this.prisma.performanceArchive.findMany({
      where: { employee: scopeFilter },
      include: {
        employee: {
          select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } },
        },
        cycle: { select: { id: true, name: true } },
      },
      orderBy: [{ employeeId: 'asc' }, { archivedAt: 'desc' }],
    });

    const byEmployee = new Map<
      string,
      {
        employee: { id: string; name: string; employeeNo: string | null; dept: { name: string } | null };
        archives: Array<{ cycleId: string; cycleName: string; grade: PerfGrade; archivedAt: Date }>;
      }
    >();

    for (const archive of archives) {
      const entry = byEmployee.get(archive.employeeId) ?? {
        employee: archive.employee,
        archives: [],
      };
      if (entry.archives.length < 2) {
        entry.archives.push({
          cycleId: archive.cycleId,
          cycleName: archive.cycle.name,
          grade: archive.grade,
          archivedAt: archive.archivedAt,
        });
      }
      byEmployee.set(archive.employeeId, entry);
    }

    const result: ConsecutiveDWarningItem[] = [];
    for (const [employeeId, { employee, archives: recentArchives }] of byEmployee.entries()) {
      if (recentArchives.length >= 2 && recentArchives.every((a) => a.grade === 'D')) {
        const allArchives = archives.filter((a) => a.employeeId === employeeId);
        let consecutiveCount = 0;
        for (const archive of allArchives) {
          if (archive.grade === 'D') {
            consecutiveCount++;
          } else {
            break;
          }
        }
        result.push({
          employeeId,
          employeeName: employee.name,
          employeeNo: employee.employeeNo,
          deptName: employee.dept?.name ?? null,
          consecutiveCount,
          archives: recentArchives,
        });
      }
    }

    return result.sort((a, b) => b.consecutiveCount - a.consecutiveCount);
  }

  // ============================================================================
  // 内部公共查询
  // ============================================================================

  /** 汇总/导出/名单共用的任务查询：非豁免 + 必要的关联。 */
  private async findSummaryTasks(
    cycleId: string,
    options: {
      approverId?: string;
      responsibleUserId?: string;
      deptId?: string;
      grade?: PerfGrade;
      employeeWhere?: Prisma.UserWhereInput;
    },
  ) {
    const where: Prisma.AssessmentTaskWhereInput = {
      cycleId,
      isExempt: false,
    };

    if (options.approverId) {
      where.approverId = options.approverId;
    }

    if (options.employeeWhere && options.responsibleUserId) {
      where.AND = [{
        OR: [
          { employee: options.employeeWhere },
          { managerId: options.responsibleUserId },
          { deptHeadId: options.responsibleUserId },
          { approverId: options.responsibleUserId },
        ],
      }];
    } else if (options.employeeWhere) {
      where.employee = options.employeeWhere;
    }

    if (options.deptId) {
      const subDeptIds = await this.dataScope.getSubDeptIds(options.deptId);
      where.deptId = { in: subDeptIds };
    }

    if (options.grade) {
      where.gradeResult = {
        OR: [
          { calibratedGrade: options.grade },
          { calibratedGrade: null, rawGrade: options.grade },
        ],
      };
    }

    return this.prisma.assessmentTask.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, employeeNo: true, position: true } },
        dept: { select: { name: true } },
        manager: { select: { name: true } },
        gradeResult: { select: { calculatedScore: true, rawGrade: true, calibratedGrade: true } },
      },
      orderBy: { employee: { name: 'asc' } },
    });
  }

  private async buildSummary(
    cycleId: string,
    dto: ReportQueryDto,
    viewer: AuthUser,
  ): Promise<ReportSummary> {
    await this.getCycleOrThrow(cycleId);

    const options: {
      approverId?: string;
      responsibleUserId?: string;
      deptId?: string;
      grade?: PerfGrade;
      employeeWhere?: Prisma.UserWhereInput;
    } = {};

    // 数据范围：系统管理员、HR 管理员和全量只读账号可看全量；
    // 其他账号合并当前组织范围与历史任务责任，不依赖旧主管/高管角色。
    const canViewAll =
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll === true;

    if (!canViewAll) {
      options.employeeWhere = await this.dataScope.getVisibleEmployeeFilter(viewer);
      options.responsibleUserId = viewer.id;
    }

    if (dto.deptId) {
      options.deptId = dto.deptId;
    }
    if (dto.grade) {
      options.grade = dto.grade;
    }

    const tasks = await this.findSummaryTasks(cycleId, options);
    const items = tasks.map((t) => this.mapToSummaryItem(t));

    const total = items.length;
    const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };

    for (const item of items) {
      if (item.grade && GRADES.includes(item.grade)) {
        counts[item.grade]++;
      }
    }

    const resulted = GRADES.reduce((sum, grade) => sum + counts[grade], 0);
    const pending = Math.max(0, total - resulted);
    const qualified = counts.A + counts.B + counts.C;
    const qualifiedRate = resulted === 0 ? 0 : qualified / resulted;
    const grades = {} as Record<PerfGrade, { count: number; ratio: number }>;
    for (const grade of GRADES) {
      grades[grade] = {
        count: counts[grade],
        ratio: resulted === 0 ? 0 : counts[grade] / resulted,
      };
    }

    return {
      stats: { total, resulted, pending, qualified, qualifiedRate, grades },
      items,
    };
  }

  private mapToSummaryItem(task: TaskWithResult): ReportSummaryItem {
    const gradeResult = task.gradeResult;
    return {
      taskId: task.id,
      employeeName: task.employee.name,
      employeeNo: task.employee.employeeNo ?? null,
      deptName: task.dept?.name ?? null,
      position: task.employee.position ?? null,
      totalScore: gradeResult?.calculatedScore?.toNumber() ?? null,
      grade: (gradeResult?.calibratedGrade ?? gradeResult?.rawGrade) as PerfGrade | null,
      managerName: task.manager?.name ?? null,
    };
  }

  private async getCycleOrThrow(cycleId: string): Promise<AssessmentCycle> {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    return cycle;
  }

  private buildOverdueByNode(
    tasks: Array<{ status: TaskStatus }>,
    cycle: Pick<
      AssessmentCycle,
      | 'deadlineIndicatorSetting'
      | 'deadlineIndicatorConfirm'
      | 'deadlineSelfEval'
      | 'deadlineManagerScore'
      | 'deadlineHrCalibration'
      | 'deadlineApproval'
      | 'deadlinePublish'
    >,
  ) {
    const today = dayjs().startOf('day');
    const isOverdue = (deadline: Date | null): boolean => {
      if (!deadline) return false;
      return today.isAfter(dayjs(deadline).startOf('day'));
    };

    const nodes: Array<{
      node: string;
      statuses: TaskStatus[];
      deadlineFor: (status: TaskStatus) => Date | null;
    }> = [
      {
        node: 'indicator_setting',
        statuses: ['indicator_drafting', 'indicator_reviewing', 'indicator_setting', 'indicator_confirming'],
        deadlineFor: (status) =>
          status === 'indicator_confirming'
            ? cycle.deadlineIndicatorConfirm
            : cycle.deadlineIndicatorSetting,
      },
      {
        node: 'self_eval',
        statuses: ['self_eval'],
        deadlineFor: () => cycle.deadlineSelfEval,
      },
      {
        node: 'manager_scoring',
        statuses: ['manager_scoring', 'dept_review'],
        deadlineFor: () => cycle.deadlineManagerScore,
      },
      {
        node: 'hr_calibration',
        statuses: ['hr_calibration'],
        deadlineFor: () => cycle.deadlineHrCalibration,
      },
      {
        node: 'approval',
        statuses: ['approval'],
        deadlineFor: () => cycle.deadlineApproval,
      },
      {
        node: 'published',
        statuses: ['published'],
        deadlineFor: () => cycle.deadlinePublish,
      },
    ];

    return nodes.map(({ node, statuses, deadlineFor }) => ({
      node,
      overdueCount: tasks.filter(
        (t) => statuses.includes(t.status) && isOverdue(deadlineFor(t.status)),
      ).length,
    }));
  }

  private async assertCanViewArchive(employeeId: string, viewer: AuthUser): Promise<void> {
    if (viewer.id === employeeId) return;
    if (viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin) return;

    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { directManagerId: true },
    });
    if (employee?.directManagerId === viewer.id) return;

    const managedTask = await this.prisma.assessmentTask.findFirst({
      where: { employeeId, managerId: viewer.id },
      select: { id: true },
    });
    if (managedTask) return;

    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '无权限查看该员工档案',
    });
  }

  // 导出列常量（供单测引用）
  static readonly SUMMARY_COLUMNS = SUMMARY_COLUMNS;
  static readonly GRADE_LIST_COLUMNS = SUMMARY_COLUMNS;
}
