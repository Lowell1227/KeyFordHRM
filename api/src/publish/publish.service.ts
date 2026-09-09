import { isResultPublished, canEmployeeViewResult, PUBLISHED_RESULT_WHERE } from '@/tasks/result-publication';
import { buildResultEvidence, maskResultEvidence, RESULT_PERIOD_SELECT, ResultEvidence } from '@/tasks/result-evidence';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AssessmentCycle, PerfGrade, Prisma, TaskStatus } from "@prisma/client";
import dayjs from "dayjs";
import { PrismaService } from "@/prisma/prisma.service";
import { ERROR_CODE } from "@/common/constants/error-codes";
import { AuthUser } from "@/common/types/auth.types";
import { FlowService } from "@/tasks/flow.service";
import { NotificationsService } from "@/notifications/notifications.service";
import { PublishCycleDto } from "./dto/publish-cycle.dto";
import { PublicationRecordsQueryDto } from "./dto/publication-records-query.dto";
import { hasHrCapability } from "@/auth/hr-capabilities";
import { assertCycleOperator } from "@/cycles/cycle-operator-scope";
import { mapReviewHistory, REVIEW_HISTORY_NODES } from "@/tasks/review-history";
import { Paginated, paginated } from "@/common/dto/pagination.dto";

/** 公示结果。 */
export interface PublishResult {
  cycleId: string;
  published: number;
  publishedAt: Date;
  deadlineAppeal: Date;
}

export type PublicationState =
  | "pending_confirmation"
  | "pending_approval"
  | "ready_to_publish"
  | "published"
  | "confirmed"
  | "appealing"
  | "closed";

export interface PublicationRecord {
  taskId: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  position: string | null;
  status: TaskStatus;
  publicationState: PublicationState;
  canPublish: boolean;
  resultMasked: boolean;
  totalScore: number | null;
  rawGrade: PerfGrade | null;
  calibratedGrade: PerfGrade | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  employeeConfirmedAt: Date | null;
  updatedAt: Date;
}

export interface PublicationRecordDetail extends PublicationRecord {
  resultEvidence?: ResultEvidence;
  managerName: string | null;
  flowRecords: ReturnType<typeof mapReviewHistory>;
}

const PUBLICATION_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.approval,
  TaskStatus.published,
  TaskStatus.confirmed,
  TaskStatus.appealing,
  TaskStatus.closed,
];

interface PublishVisibleFields {
  total_score: boolean;
  grade: boolean;
  manager_comment: boolean;
  indicator_scores: boolean;
}

const DEFAULT_PUBLISH_VISIBLE_FIELDS: PublishVisibleFields = {
  total_score: true,
  grade: true,
  manager_comment: true,
  indicator_scores: true,
};

/**
 * 计算申诉截止日。
 * 规则：自公示日起加 appealWindowDays 天；若周期已有更晚的 deadlineAppeal 则取 max。
 */
export function calcAppealDeadline(
  publishedAt: Date,
  cycle: Pick<AssessmentCycle, "deadlineAppeal">,
  appealWindowDays: number,
): Date {
  const base = dayjs(publishedAt);
  const calculated = base.add(appealWindowDays, "day").startOf("day").toDate();

  if (
    cycle.deadlineAppeal &&
    new Date(cycle.deadlineAppeal).getTime() > calculated.getTime()
  ) {
    return new Date(cycle.deadlineAppeal);
  }

  return calculated;
}

@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flowService: FlowService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** GET /cycles/:id/publication-records — 公示工作台记录，不复用通用任务可见范围。 */
  async getPublicationRecords(
    cycleId: string,
    dto: PublicationRecordsQueryDto,
    viewer: AuthUser,
  ): Promise<Paginated<PublicationRecord>> {
    const cycle = await this.getAuthorizedCycleOrThrow(cycleId, viewer);
    const where: Prisma.AssessmentTaskWhereInput = {
      cycleId,
      OR: [{ status: { in: PUBLICATION_TASK_STATUSES } }, { flowRecords: { some: { nodeType: "approval" } } }],
      isExempt: false,
    };
    const [total, tasks] = await Promise.all([
      this.prisma.assessmentTask.count({ where }),
      this.prisma.assessmentTask.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        select: {
          id: true,
          cycleId: true,
          employeeId: true,
          status: true,
          approvedAt: true,
          publishedAt: true,
          employeeConfirmedAt: true,
          updatedAt: true,
          appeals: { where: { status: "pending" }, select: { id: true } },
          employee: {
            select: { name: true, employeeNo: true, position: true },
          },
          dept: { select: { name: true } },
          gradeResult: {
            select: {
              approvedAt: true,
              calculatedScore: true,
              rawGrade: true,
              calibratedGrade: true,
              publishedAt: true,
              isPublished: true,
              employeeConfirmedAt: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);

    return paginated(
      tasks.map((task) => this.mapPublicationRecord(task, cycle, viewer)),
      total,
      dto,
    );
  }

  /** GET /cycles/:id/publication-records/:taskId — 公示环节白名单详情。 */
  async getPublicationRecordDetail(
    cycleId: string,
    taskId: string,
    viewer: AuthUser,
  ): Promise<PublicationRecordDetail> {
    const cycle = await this.getAuthorizedCycleOrThrow(cycleId, viewer);
    const task = await this.prisma.assessmentTask.findFirst({
      where: {
        id: taskId,
        cycleId,
        isExempt: false,
        AND: [{ OR: [{ status: { in: PUBLICATION_TASK_STATUSES } }, { flowRecords: { some: { nodeType: "approval" } } }] }],
        OR: [
          { employeeId: { not: viewer.id } },
          PUBLISHED_RESULT_WHERE,
          { status: { in: ["approval", "confirmed"] }, approvedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        cycleId: true,
        employeeId: true,
        status: true,
        approvedAt: true,
        publishedAt: true,
        employeeConfirmedAt: true,
        updatedAt: true,
        appeals: { where: { status: "pending" }, select: { id: true } },
        employee: { select: { name: true, employeeNo: true, position: true } },
        dept: { select: { name: true } },
        manager: { select: { name: true } },
        gradeResult: {
          select: {
            approvedAt: true,
            calculatedScore: true,
            rawGrade: true,
            calibratedGrade: true,
            publishedAt: true,
            isPublished: true,
            employeeConfirmedAt: true,
          },
        },
        periods: { orderBy: { sequence: "asc" }, select: RESULT_PERIOD_SELECT },
        flowRecords: {
          where: { nodeType: { in: REVIEW_HISTORY_NODES } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { actor: { select: { name: true } } },
        },
      },
    });
    if (!task) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: "无权查看该任务的公示详情，或任务尚未进入公示范围",
      });
    }

    const visibleFields = this.parsePublishVisibleFields(
      cycle.publishVisibleFields,
    );
    const flowRecords = mapReviewHistory(task.flowRecords);
    const evidence = buildResultEvidence(task.periods);
    return {
      ...this.mapPublicationRecord(task, cycle, viewer),
      managerName: task.manager?.name ?? null,
      resultEvidence: task.employeeId === viewer.id ? maskResultEvidence(evidence, visibleFields) : evidence,
      flowRecords:
        task.employeeId === viewer.id &&
        canEmployeeViewResult(task)
          ? this.maskOwnPublishedHistory(flowRecords, visibleFields)
          : flowRecords,
    };
  }

  /** POST /cycles/:id/publish — HR 按 taskIds 批量公示。 */
  async publishCycle(
    cycleId: string,
    dto: PublishCycleDto,
    viewer: AuthUser,
  ): Promise<PublishResult> {
    if (!dto.taskIds || dto.taskIds.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: "taskIds 不能为空",
      });
    }

    const cycle = await this.getAuthorizedCycleOrThrow(cycleId, viewer);
    const appealWindowDays = await this.loadAppealWindowDays();

    const publishedAt = new Date();
    const deadlineAppeal = calcAppealDeadline(
      publishedAt,
      cycle,
      appealWindowDays,
    );

    const tasks = await this.prisma.$transaction(
      async (tx) => {
        // 锁定后重新读取审批状态，避免审批撤回或并发公示仍使用事务外旧快照。
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "assessment_tasks"
          WHERE "cycle_id" = ${cycleId}::uuid
            AND "id" IN (${Prisma.join(dto.taskIds.map((taskId) => Prisma.sql`${taskId}::uuid`))})
          ORDER BY "id" FOR NO KEY UPDATE
        `);
        const lockedTasks = await tx.assessmentTask.findMany({
          where: {
            id: { in: dto.taskIds },
            cycleId,
            status: TaskStatus.confirmed,
            employeeConfirmedAt: { not: null },
            NOT: PUBLISHED_RESULT_WHERE,
            isExempt: false,
          },
          include: {
            appeals: { where: { status: "pending" }, select: { id: true } },
            gradeResult: {
              select: {
                approvedAt: true,
                employeeConfirmedAt: true,
                isPublished: true,
                publishedAt: true,
                calibratedGrade: true,
                rawGrade: true,
              },
            },
          },
          orderBy: { id: "asc" },
        });
        if (lockedTasks.length !== dto.taskIds.length) {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: "存在非本周期、状态已变化、已公示或已豁免的任务",
          });
        }
        const notApproved = lockedTasks.filter(
          (task) => task.status !== "confirmed" || !task.approvedAt || !task.gradeResult?.approvedAt
            || !task.employeeConfirmedAt || !task.gradeResult?.employeeConfirmedAt || isResultPublished(task) || task.appeals.length > 0,
        );
        if (notApproved.length > 0) {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: `存在未审批、未确认或申诉未完成的任务：${notApproved.map((task) => task.id).join(", ")}`,
          });
        }

        for (const task of lockedTasks) {
          await this.flowService.transitionTx(tx, {
            task,
            action: "approve",
            targetStatus: "published",
            actorId: viewer.id,
            comment: "HR 公示发布",
            taskUpdate: { publishedAt },
          });

          const publishedResult = await tx.gradeResult.updateMany({
            where: {
              taskId: task.id,
              approvedAt: { not: null },
              isPublished: false,
            },
            data: {
              isPublished: true,
              publishedAt,
            },
          });
          if (publishedResult.count !== 1) {
            throw new ConflictException({
              code: ERROR_CODE.CONFLICT,
              message: `任务审批结果已变化，请刷新后重试：${task.id}`,
            });
          }

          // A1：公示时自动为每个已审批任务创建绩效面谈记录，截止日 = 审批通过 +20 日
          const approved = dayjs(task.gradeResult?.approvedAt ?? publishedAt);
          const deadline = new Date(
            Date.UTC(approved.year(), approved.month(), approved.date() + 20),
          );

          await tx.performanceInterview.upsert({
            where: { taskId: task.id },
            create: {
              taskId: task.id,
              cycleId: task.cycleId,
              employeeId: task.employeeId,
              interviewerId: task.managerId ?? viewer.id,
              deadline,
              status: "pending",
            },
            update: {},
          });

          // A2：最终等级为 D 时自动生成绩效改进计划（壳）
          const effectiveGrade =
            task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade;
          if (effectiveGrade === "D") {
            await tx.improvementPlan.upsert({
              where: {
                employeeId_cycleId: { employeeId: task.employeeId, cycleId },
              },
              create: {
                employeeId: task.employeeId,
                cycleId,
                taskId: task.id,
                status: "draft",
              },
              update: {},
            });
          }
        }

        // 全部非豁免任务均已实际公示后才推进周期，申诉重评和待确认任务仍阻止整周期完成。
        const remainingUnpublishedTasks = await tx.assessmentTask.count({
          where: { cycleId, isExempt: false, NOT: PUBLISHED_RESULT_WHERE },
        });

        const cycleData: Prisma.AssessmentCycleUpdateInput = {
          publishedAt,
          deadlineAppeal,
        };
        if (remainingUnpublishedTasks === 0) {
          cycleData.status = "published";
        }

        await tx.assessmentCycle.update({
          where: { id: cycleId },
          data: cycleData,
        });
        return lockedTasks;
      },
      { timeout: 60000, maxWait: 10000 },
    );

    if (dto.sendDingtalkNotification) {
      for (const task of tasks) {
        await this.notificationsService
          .sendResultPublished(task.id)
          .catch(() => {
            // 通知失败不阻断业务
          });
      }
    }

    return {
      cycleId,
      published: tasks.length,
      publishedAt,
      deadlineAppeal,
    };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private async getAuthorizedCycleOrThrow(cycleId: string, viewer: AuthUser) {
    if (!hasHrCapability(viewer, "performance_publish")) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: "无结果公示权限",
      });
    }
    const cycle = await this.prisma.assessmentCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        name: true,
        hrOwnerId: true,
        deadlineAppeal: true,
        publishVisibleFields: true,
      },
    });
    if (!cycle) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: "考核周期不存在",
      });
    }
    assertCycleOperator(viewer, cycle, "performance_publish");
    return cycle;
  }

  private publicationState(task: any): PublicationState {
    if (isResultPublished(task)) return task.status as PublicationState;
    if (task.status === TaskStatus.confirmed && task.employeeConfirmedAt && task.gradeResult?.approvedAt) return 'ready_to_publish';
    return task.gradeResult?.approvedAt ? 'pending_confirmation' : 'pending_approval';
  }

  private mapPublicationRecord(
    task: any,
    cycle: { name: string; publishVisibleFields: Prisma.JsonValue },
    viewer: AuthUser,
  ): PublicationRecord {
    const canViewOwnResult = canEmployeeViewResult(task);
    const resultMasked = task.employeeId === viewer.id && !canViewOwnResult;
    const ownVisibleFields =
      task.employeeId === viewer.id && canViewOwnResult
        ? this.parsePublishVisibleFields(cycle.publishVisibleFields)
        : DEFAULT_PUBLISH_VISIBLE_FIELDS;
    return {
      taskId: task.id,
      cycleId: task.cycleId,
      cycleName: cycle.name,
      employeeId: task.employeeId,
      employeeName: task.employee.name,
      employeeNo: task.employee.employeeNo ?? null,
      deptName: task.dept?.name ?? null,
      position: task.employee.position ?? null,
      status: task.status,
      publicationState: this.publicationState(task),
      canPublish:
        task.status === TaskStatus.confirmed && !isResultPublished(task) &&
        Boolean(task.approvedAt && task.employeeConfirmedAt && task.gradeResult?.approvedAt && task.gradeResult?.employeeConfirmedAt) && !(task.appeals?.length),
      resultMasked,
      totalScore:
        resultMasked || !ownVisibleFields.total_score
          ? null
          : (task.gradeResult?.calculatedScore?.toNumber() ?? null),
      rawGrade:
        resultMasked || !ownVisibleFields.grade
          ? null
          : (task.gradeResult?.rawGrade ?? null),
      calibratedGrade:
        resultMasked || !ownVisibleFields.grade
          ? null
          : (task.gradeResult?.calibratedGrade ?? null),
      approvedAt: task.gradeResult?.approvedAt ?? task.approvedAt ?? null,
      publishedAt: task.gradeResult?.publishedAt ?? task.publishedAt ?? null,
      employeeConfirmedAt: task.employeeConfirmedAt ?? null,
      updatedAt: task.updatedAt,
    };
  }

  private parsePublishVisibleFields(
    value: Prisma.JsonValue,
  ): PublishVisibleFields {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return DEFAULT_PUBLISH_VISIBLE_FIELDS;
    }
    const fields = value as Prisma.JsonObject;
    return {
      total_score:
        typeof fields.total_score === "boolean" ? fields.total_score : true,
      grade: typeof fields.grade === "boolean" ? fields.grade : true,
      indicator_scores: typeof fields.indicator_scores === "boolean" ? fields.indicator_scores : true,
      manager_comment:
        typeof fields.manager_comment === "boolean"
          ? fields.manager_comment
          : true,
    };
  }

  private maskOwnPublishedHistory(
    records: ReturnType<typeof mapReviewHistory>,
    visibleFields: PublishVisibleFields,
  ): ReturnType<typeof mapReviewHistory> {
    const hideAllResultComments =
      !visibleFields.total_score || !visibleFields.grade;
    if (visibleFields.manager_comment && !hideAllResultComments) return records;
    return records.map((record) => {
      const hideManagerComment =
        !visibleFields.manager_comment && record.nodeType === "manager_score";
      if (!hideAllResultComments && !hideManagerComment) return record;
      const data = record.extraData;
      const extraData =
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        "comment" in data
          ? { ...data, comment: null }
          : data;
      return {
        ...record,
        comment: null,
        extraData,
      };
    }) as ReturnType<typeof mapReviewHistory>;
  }

  private async loadAppealWindowDays(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: "appeal_window_days" },
    });

    if (!config) return 30;

    const value = config.value as number | { value?: number } | undefined;
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && typeof value.value === "number") {
      return value.value;
    }
    return 30;
  }
}
