import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { ERROR_CODE } from '@/common/constants/error-codes';
import type { AuthUser } from '@/common/types/auth.types';
import { DataScopeService } from '@/common/services/data-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { QueryPeriodMonitoringDto, PeriodMonitoringStatus } from './dto/query-period-monitoring.dto';
import type { PeriodMonitoringResult, PeriodMonitoringRow } from './period-review.types';

const monitoringSelect = {
  id: true,
  periodKey: true,
  sequence: true,
  status: true,
  draftVersion: true,
  selfEvalOpenAt: true,
  selfEvalDueAt: true,
  managerDueAt: true,
  employeeSubmittedAt: true,
  managerSubmittedAt: true,
  lockedAt: true,
  selfScoreTotal: true,
  managerScoreTotal: true,
  selfGrade: true,
  managerGrade: true,
  task: {
    select: {
      id: true,
      status: true,
      publishedAt: true,
      participantDisposition: true,
      employee: { select: { id: true, employeeNo: true, name: true } },
      dept: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
      cycle: { select: { id: true, publishedAt: true } },
      gradeResult: { select: { isPublished: true, publishedAt: true } },
    },
  },
} satisfies Prisma.AssessmentPeriodSelect;

type MonitoringPeriod = Prisma.AssessmentPeriodGetPayload<{ select: typeof monitoringSelect }>;

@Injectable()
export class PeriodMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async findCycleMonitoring(
    cycleId: string,
    query: QueryPeriodMonitoringDto,
    viewer: AuthUser,
    now = new Date(),
  ): Promise<PeriodMonitoringResult> {
    const canEdit = hasHrCapability(viewer, 'cycle_plan_edit');
    const canRead = canEdit || hasHrCapability(viewer, 'cycle_plan_review');
    if (!canRead) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看月度自评进度' });
    }
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, name: true },
    });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }

    const employeeWhere = await this.dataScope.getVisibleEmployeeFilter(viewer);
    const periods = await this.prisma.assessmentPeriod.findMany({
      where: {
        task: {
          cycleId,
          participantDisposition: 'active',
          employee: employeeWhere,
        },
      },
      select: monitoringSelect,
    });
    const rows = periods.map((period) => this.toRow(period, canEdit, now));
    const summary = {
      employeePending: rows.filter((row) => row.derivedStatus === 'employee_pending').length,
      employeeOverdue: rows.filter((row) => row.derivedStatus === 'employee_overdue').length,
      managerPending: rows.filter((row) => row.derivedStatus === 'manager_pending').length,
      managerCompleted: rows.filter((row) => row.derivedStatus === 'manager_completed').length,
      total: rows.length,
    };
    const keyword = query.keyword?.trim().toLocaleLowerCase('zh-CN') ?? '';
    const filtered = rows
      .filter((row) => !query.periodKey || row.periodKey === query.periodKey)
      .filter((row) => !query.status || row.derivedStatus === query.status)
      .filter((row) => !keyword || [row.employeeName, row.employeeNo ?? '']
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      .sort((left, right) => (
        left.sequence - right.sequence
        || this.statusPriority(left.derivedStatus) - this.statusPriority(right.derivedStatus)
        || (left.employeeNo ?? '').localeCompare(right.employeeNo ?? '', 'zh-CN')
        || left.employeeName.localeCompare(right.employeeName, 'zh-CN')
        || left.id.localeCompare(right.id)
      ));
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    return {
      cycle: { id: cycle.id, name: cycle.name },
      summary,
      total: filtered.length,
      page,
      pageSize,
      items: filtered.slice(skip, skip + pageSize),
    };
  }

  private toRow(period: MonitoringPeriod, canEdit: boolean, now: Date): PeriodMonitoringRow {
    const derivedStatus = this.derivedStatus(period, now);
    const publicationBlocked = Boolean(
      period.task.cycle.publishedAt
      || period.task.publishedAt
      || period.task.gradeResult?.isPublished
      || period.task.gradeResult?.publishedAt,
    );
    const taskStatusBlocked = !['manager_scoring', 'dept_review', 'hr_calibration', 'approval', 'self_eval']
      .includes(period.task.status);
    const reopenBlockedReason = !canEdit
      ? '仅具备周期管理编辑权限的HR可重新开放'
      : publicationBlocked
        ? '结果已经公示，请走现有结果更正流程'
        : derivedStatus !== 'manager_completed'
          ? '主管评分尚未提交并锁定'
          : taskStatusBlocked
            ? '当前任务阶段不支持重新开放'
            : null;

    return {
      id: period.id,
      taskId: period.task.id,
      periodKey: period.periodKey,
      sequence: period.sequence,
      status: period.status,
      derivedStatus,
      draftVersion: period.draftVersion,
      employeeId: period.task.employee.id,
      employeeNo: period.task.employee.employeeNo,
      employeeName: period.task.employee.name,
      deptName: period.task.dept?.name ?? null,
      managerName: period.task.manager?.name ?? null,
      selfEvalOpenAt: period.selfEvalOpenAt,
      selfEvalDueAt: period.selfEvalDueAt,
      managerDueAt: period.managerDueAt,
      employeeSubmittedAt: period.employeeSubmittedAt,
      managerSubmittedAt: period.managerSubmittedAt,
      lockedAt: period.lockedAt,
      selfScoreTotal: period.selfScoreTotal?.toNumber() ?? null,
      managerScoreTotal: period.managerScoreTotal?.toNumber() ?? null,
      selfGrade: period.selfGrade,
      managerGrade: period.managerGrade,
      canReopen: reopenBlockedReason == null,
      reopenBlockedReason,
    };
  }

  private derivedStatus(period: MonitoringPeriod, now: Date): PeriodMonitoringStatus {
    if (period.managerSubmittedAt && period.lockedAt && period.status === 'completed') {
      return 'manager_completed';
    }
    if (period.employeeSubmittedAt) return 'manager_pending';
    return now.getTime() > period.selfEvalDueAt.getTime()
      ? 'employee_overdue'
      : 'employee_pending';
  }

  private statusPriority(status: PeriodMonitoringStatus): number {
    return {
      employee_overdue: 0,
      employee_pending: 1,
      manager_pending: 2,
      manager_completed: 3,
    }[status];
  }
}
