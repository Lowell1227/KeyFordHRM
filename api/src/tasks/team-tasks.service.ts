import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  AssessmentPeriodStatus,
  AssessmentPeriodType,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { Paginated } from "@/common/dto/pagination.dto";
import { ERROR_CODE } from "@/common/constants/error-codes";
import { AuthUser } from "@/common/types/auth.types";
import { NotificationsService } from "@/notifications/notifications.service";
import { PrismaService } from "@/prisma/prisma.service";
import type { TaskListItem } from "./tasks.service";
import {
  BatchIndicatorReviewDto,
  BatchRejectIndicatorReviewDto,
  BatchTaskRefDto,
} from "./dto/batch-indicator-review.dto";
import { TeamTaskQueryDto } from "./dto/team-task-query.dto";
import { FlowService } from "./flow.service";
import { assertTaskVersion, claimTaskVersion } from "./task-version";
import {
  getTeamStageState,
  getTeamStageStatuses,
  TEAM_STAGE_STATUSES,
  TeamStageState,
} from "./team-task-stage";

export interface TeamTaskCounts {
  all: number;
  notStarted: number;
  pending: number;
  completed: number;
  exempted: number;
}

export interface TeamTaskListItem extends TaskListItem {
  employeeNo: string | null;
  avatarUrl: string | null;
  position: string | null;
  stageState: TeamStageState;
  periodReview: {
    id: string;
    periodKey: string;
    periodType: AssessmentPeriodType;
    status: AssessmentPeriodStatus;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
  } | null;
}

export interface TeamTaskPage extends Paginated<TeamTaskListItem> {
  counts: TeamTaskCounts;
  facets: {
    departments: Array<{ id: string; name: string }>;
    employees: Array<{
      id: string;
      name: string;
      employeeNo: string | null;
      deptId: string | null;
    }>;
  };
}

export interface BatchReviewResult {
  succeeded: Array<{ taskId: string; status: TaskStatus }>;
  failed: Array<{ taskId: string; reason: string }>;
}

type ReviewTask = Prisma.AssessmentTaskGetPayload<{
  select: {
    id: true;
    cycleId: true;
    employeeId: true;
    managerId: true;
    deptHeadId: true;
    approverId: true;
    status: true;
    updatedAt: true;
    indicatorInstances: { select: { weight: true } };
  };
}>;

type TeamListTask = Prisma.AssessmentTaskGetPayload<{
  include: {
    employee: {
      select: {
        name: true;
        employeeNo: true;
        avatarUrl: true;
        position: true;
      };
    };
    cycle: { select: { name: true } };
    dept: { select: { name: true } };
    gradeResult: { select: { calculatedScore: true; rawGrade: true } };
  };
}> & {
  periods?: Array<{
    id: string;
    periodKey: string;
    periodType: AssessmentPeriodType;
    sequence: number;
    status: AssessmentPeriodStatus;
    selfScoreTotal: Prisma.Decimal | null;
    managerScoreTotal: Prisma.Decimal | null;
  }>;
};

@Injectable()
export class TeamTasksService {
  private readonly logger = new Logger(TeamTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(
    dto: TeamTaskQueryDto,
    viewer: AuthUser,
  ): Promise<TeamTaskPage> {
    const authorizedWhere: Prisma.AssessmentTaskWhereInput = {
      managerId: viewer.id,
    };
    const filteredWhere = this.withFilters(authorizedWhere, dto);
    const facetWhere: Prisma.AssessmentTaskWhereInput = { ...authorizedWhere };

    if (dto.cycleId) {
      facetWhere.cycleId = dto.cycleId;
    }

    if (dto.stage === "manager-eval") {
      return this.findManagerEvaluations(dto, filteredWhere, facetWhere);
    }

    const itemWhere: Prisma.AssessmentTaskWhereInput = dto.stageState
      ? {
          ...filteredWhere,
          status: { in: [...getTeamStageStatuses(dto.stage, dto.stageState)] },
        }
      : filteredWhere;

    const [total, statusCounts, tasks, departmentTasks, employeeTasks] =
      await Promise.all([
        this.prisma.assessmentTask.count({ where: itemWhere }),
        this.prisma.assessmentTask.groupBy({
          by: ["status"],
          where: filteredWhere,
          _count: { status: true },
        }),
        this.prisma.assessmentTask.findMany({
          where: itemWhere,
          skip: dto.skip,
          take: dto.take,
          include: {
            employee: {
              select: {
                name: true,
                employeeNo: true,
                avatarUrl: true,
                position: true,
              },
            },
            cycle: { select: { name: true } },
            dept: { select: { name: true } },
            gradeResult: { select: { calculatedScore: true, rawGrade: true } },
          },
          orderBy: [{ cycle: { startDate: "desc" } }, { updatedAt: "desc" }],
        }),
        this.prisma.assessmentTask.findMany({
          where: facetWhere,
          distinct: ["deptId"],
          select: { dept: { select: { id: true, name: true } } },
          orderBy: { dept: { name: "asc" } },
        }),
        this.prisma.assessmentTask.findMany({
          where: facetWhere,
          distinct: ["employeeId"],
          select: {
            employee: {
              select: { id: true, name: true, employeeNo: true, deptId: true },
            },
          },
          orderBy: { employee: { name: "asc" } },
        }),
      ]);

    return {
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      items: tasks.map((task) => this.toListItem(task, dto.stage)),
      counts: this.toCounts(statusCounts, dto.stage),
      facets: {
        departments: departmentTasks.flatMap((task) =>
          task.dept ? [task.dept] : [],
        ),
        employees: employeeTasks.map((task) => task.employee),
      },
    };
  }

  private async findManagerEvaluations(
    dto: TeamTaskQueryDto,
    filteredWhere: Prisma.AssessmentTaskWhereInput,
    facetWhere: Prisma.AssessmentTaskWhereInput,
  ): Promise<TeamTaskPage> {
    const [tasks, departmentTasks, employeeTasks] = await Promise.all([
      this.prisma.assessmentTask.findMany({
        where: filteredWhere,
        include: {
          employee: {
            select: {
              name: true,
              employeeNo: true,
              avatarUrl: true,
              position: true,
            },
          },
          cycle: { select: { name: true } },
          dept: { select: { name: true } },
          gradeResult: { select: { calculatedScore: true, rawGrade: true } },
          periods: {
            select: {
              id: true,
              periodKey: true,
              periodType: true,
              sequence: true,
              status: true,
              selfScoreTotal: true,
              managerScoreTotal: true,
            },
            orderBy: { sequence: "asc" },
          },
        },
        orderBy: [{ cycle: { startDate: "desc" } }, { updatedAt: "desc" }],
      }),
      this.prisma.assessmentTask.findMany({
        where: facetWhere,
        distinct: ["deptId"],
        select: { dept: { select: { id: true, name: true } } },
        orderBy: { dept: { name: "asc" } },
      }),
      this.prisma.assessmentTask.findMany({
        where: facetWhere,
        distinct: ["employeeId"],
        select: {
          employee: {
            select: { id: true, name: true, employeeNo: true, deptId: true },
          },
        },
        orderBy: { employee: { name: "asc" } },
      }),
    ]);

    const allItems = tasks.map((task) => this.toListItem(task, dto.stage));
    const matchingItems = dto.stageState
      ? allItems.filter((item) => item.stageState === dto.stageState)
      : allItems;
    const counts = allItems.reduce<TeamTaskCounts>(
      (result, item) => {
        result.all += 1;
        if (item.stageState === "not_started") result.notStarted += 1;
        if (item.stageState === "pending") result.pending += 1;
        if (item.stageState === "completed") result.completed += 1;
        if (item.stageState === "exempted") result.exempted += 1;
        return result;
      },
      { all: 0, notStarted: 0, pending: 0, completed: 0, exempted: 0 },
    );

    return {
      total: matchingItems.length,
      page: dto.page,
      pageSize: dto.pageSize,
      items: matchingItems.slice(dto.skip, dto.skip + dto.take),
      counts,
      facets: {
        departments: departmentTasks.flatMap((task) => task.dept ? [task.dept] : []),
        employees: employeeTasks.map((task) => task.employee),
      },
    };
  }

  async batchApprove(
    dto: BatchIndicatorReviewDto,
    viewer: AuthUser,
  ): Promise<BatchReviewResult> {
    return this.reviewBatch(dto.tasks, viewer, "approve");
  }

  async batchReject(
    dto: BatchRejectIndicatorReviewDto,
    viewer: AuthUser,
  ): Promise<BatchReviewResult> {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: "请填写驳回原因",
      });
    }

    return this.reviewBatch(dto.tasks, viewer, "reject", reason);
  }

  private withFilters(
    authorizedWhere: Prisma.AssessmentTaskWhereInput,
    dto: TeamTaskQueryDto,
  ): Prisma.AssessmentTaskWhereInput {
    const where: Prisma.AssessmentTaskWhereInput = { ...authorizedWhere };

    if (dto.cycleId) where.cycleId = dto.cycleId;
    if (dto.deptId) where.deptId = dto.deptId;
    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.keyword) {
      where.employee = {
        OR: [
          { name: { contains: dto.keyword, mode: "insensitive" } },
          { employeeNo: { contains: dto.keyword, mode: "insensitive" } },
        ],
      };
    }

    return where;
  }

  private toCounts(
    statusCounts: Array<{ status: TaskStatus; _count: { status: number } }>,
    stage: TeamTaskQueryDto["stage"],
  ): TeamTaskCounts {
    const byStatus = new Map(
      statusCounts.map(({ status, _count }) => [status, _count.status]),
    );
    const countStatuses = (statuses: readonly TaskStatus[]) =>
      statuses.reduce(
        (total, status) => total + (byStatus.get(status) ?? 0),
        0,
      );

    return {
      all: countStatuses(Object.values(TaskStatus)),
      notStarted: countStatuses(TEAM_STAGE_STATUSES[stage].not_started),
      pending: countStatuses(TEAM_STAGE_STATUSES[stage].pending),
      completed: countStatuses(TEAM_STAGE_STATUSES[stage].completed),
      exempted: countStatuses(getTeamStageStatuses(stage, "exempted")),
    };
  }

  private toListItem(
    task: TeamListTask,
    stage: TeamTaskQueryDto["stage"],
  ): TeamTaskListItem {
    const periodReview = stage === "manager-eval"
      ? this.pickManagerPeriod(task.periods ?? [])
      : null;
    return {
      id: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle.name,
      employeeId: task.employeeId,
      employeeName: task.employee.name,
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      managerId: task.managerId,
      status: task.status as TaskStatus,
      isExempt: task.isExempt,
      exemptReason: task.exemptReason,
      totalScore: task.gradeResult?.calculatedScore?.toNumber() ?? null,
      rawGrade: task.gradeResult?.rawGrade ?? null,
      updatedAt: task.updatedAt,
      employeeNo: task.employee.employeeNo,
      avatarUrl: task.employee.avatarUrl,
      position: task.employee.position,
      stageState: stage === "manager-eval"
        ? this.managerStageState(task, periodReview)
        : getTeamStageState(task.status, stage),
      periodReview: periodReview
        ? {
            id: periodReview.id,
            periodKey: periodReview.periodKey,
            periodType: periodReview.periodType,
            status: periodReview.status,
            selfScoreTotal: periodReview.selfScoreTotal?.toNumber() ?? null,
            managerScoreTotal: periodReview.managerScoreTotal?.toNumber() ?? null,
          }
        : null,
    };
  }

  private pickManagerPeriod(periods: NonNullable<TeamListTask["periods"]>) {
    return periods.find((period) => period.status === AssessmentPeriodStatus.manager_scoring)
      ?? periods.find((period) => period.status === AssessmentPeriodStatus.self_eval)
      ?? periods.find((period) => period.status === AssessmentPeriodStatus.unopened)
      ?? periods.at(-1)
      ?? null;
  }

  private managerStageState(
    task: TeamListTask,
    period: ReturnType<TeamTasksService["pickManagerPeriod"]>,
  ): TeamStageState {
    if (task.isExempt || task.status === TaskStatus.exempted) return "exempted";
    if (!period) return getTeamStageState(task.status, "manager-eval");
    if (period.status === AssessmentPeriodStatus.manager_scoring) return "pending";
    if (
      period.status === AssessmentPeriodStatus.unopened
      || period.status === AssessmentPeriodStatus.self_eval
    ) return "not_started";
    return "completed";
  }

  private async reviewBatch(
    taskRefs: BatchTaskRefDto[],
    viewer: AuthUser,
    action: "approve" | "reject",
    comment?: string,
  ): Promise<BatchReviewResult> {
    const batchId = randomUUID();
    const result: BatchReviewResult = { succeeded: [], failed: [] };
    const processedTaskIds = new Set<string>();

    for (const taskRef of taskRefs) {
      const taskId = taskRef.taskId.toLowerCase();
      if (processedTaskIds.has(taskId)) continue;
      processedTaskIds.add(taskId);

      try {
        const status = await this.reviewTask(taskRef, viewer, action, batchId, comment);
        result.succeeded.push({ taskId: taskRef.taskId, status });
      } catch (error) {
        result.failed.push({
          taskId: taskRef.taskId,
          reason: this.reviewFailureReason(taskRef.taskId, error),
        });
      }
    }

    return result;
  }

  private async reviewTask(
    taskRef: BatchTaskRefDto,
    viewer: AuthUser,
    action: "approve" | "reject",
    batchId: string,
    comment?: string,
  ): Promise<TaskStatus> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: taskRef.taskId },
      select: {
        id: true,
        cycleId: true,
        employeeId: true,
        managerId: true,
        deptHeadId: true,
        approverId: true,
        status: true,
        updatedAt: true,
        indicatorInstances: { select: { weight: true } },
      },
    });

    if (!task) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: "考核任务不存在" });
    }

    this.assertCanReview(task, viewer);
    assertTaskVersion(task.updatedAt, taskRef.updatedAt);
    this.assertValidIndicators(task);

    const targetStatus: TaskStatus =
      action === "approve" ? "indicator_confirming" : "indicator_drafting";
    const extraData = {
      type: action === "approve" ? "indicator_review_approved" : "indicator_review_rejected",
      source: "manager",
      batchId,
    };

    await this.prisma.$transaction(async (tx) => {
      const claimedUpdatedAt = await claimTaskVersion(tx, task.id, taskRef.updatedAt);
      await this.flowService.transitionTx(tx, {
        task,
        action: action === "approve" ? "submit" : "reject",
        targetStatus,
        actorId: viewer.id,
        comment,
        extraData,
        taskUpdate:
          action === "approve"
            ? { indicatorSetAt: new Date(), indicatorConfirmedAt: null, updatedAt: claimedUpdatedAt }
            : { indicatorConfirmedAt: null, updatedAt: claimedUpdatedAt },
      });
    });

    await this.notifyReviewedEmployee(task, viewer, action, comment);

    return targetStatus;
  }

  private assertCanReview(task: ReviewTask, viewer: AuthUser): void {
    if (task.managerId !== viewer.id) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: "无权审核该员工目标",
      });
    }
    if (task.status !== "indicator_reviewing") {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: "当前状态不允许审核目标",
      });
    }
  }

  private assertValidIndicators(task: ReviewTask): void {
    if (!task.indicatorInstances.length) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: "请至少保留一条指标",
      });
    }

    const totalWeight = task.indicatorInstances.reduce(
      (sum, indicator) => sum.plus(indicator.weight),
      new Prisma.Decimal(0),
    );
    if (totalWeight.minus(1).abs().greaterThan(0.0001)) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: "目标权重合计必须为100%",
      });
    }
  }

  private exceptionReason(error: HttpException): string {
    const response = error.getResponse();
    if (typeof response === "string") return response;
    const message = (response as { message?: unknown }).message;
    if (typeof message === "string") return message;
    return error.message;
  }

  private reviewFailureReason(taskId: string, error: unknown): string {
    if (error instanceof HttpException && error.getStatus() < 500) {
      return this.exceptionReason(error);
    }

    this.logger.error(
      `batch review failed for task ${taskId}`,
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    return "任务处理失败，请稍后重试";
  }

  private async notifyReviewedEmployee(
    task: ReviewTask,
    viewer: AuthUser,
    action: "approve" | "reject",
    comment?: string,
  ): Promise<void> {
    try {
      await this.notificationsService.create({
        userId: task.employeeId,
        senderId: viewer.id,
        cycleId: task.cycleId,
        taskId: task.id,
        type: "indicator_setting_notice",
        title: action === "approve" ? "考核指标待确认" : "指标被驳回",
        content:
          action === "approve"
            ? "主管已审核本周期正式考核指标，请进入“我的绩效”确认。"
            : `主管已驳回考核指标：${comment}，请重新调整。`,
      });
    } catch (error) {
      this.logger.error(
        `batch review notification failed for task ${task.id}`,
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    }
  }
}
