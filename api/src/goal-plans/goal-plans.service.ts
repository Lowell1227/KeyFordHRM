import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FlowNodeType, Prisma, SysRole, TaskStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { AuthUser } from "@/common/types/auth.types";
import { paginated } from "@/common/dto/pagination.dto";
import { ERROR_CODE } from "@/common/constants/error-codes";
import {
  getGoalReviewActorId,
  usesFiveStepGoalWorkflow,
} from "@/tasks/goal-workflow";
import { GoalPlanQueryDto, GoalPlanScope } from "./goal-plans.dto";

const GOAL_STATUSES: TaskStatus[] = [
  "pending",
  "indicator_drafting",
  "indicator_setting",
  "indicator_reviewing",
  "indicator_dept_reviewing",
  "indicator_confirming",
  "indicator_approving",
  "goal_confirmed",
  "exempted",
];
const GOAL_NODES: FlowNodeType[] = [
  "indicator_setting",
  "indicator_confirm",
  "indicator_dept_review",
  "indicator_approval",
];
const SUMMARY_SELECT = Prisma.validator<Prisma.AssessmentTaskSelect>()({
  id: true,
  cycleId: true,
  employeeId: true,
  deptId: true,
  managerId: true,
  deptHeadId: true,
  approverId: true,
  status: true,
  isExempt: true,
  exemptReason: true,
  indicatorSetAt: true,
  indicatorConfirmedAt: true,
  goalApprovedAt: true,
  updatedAt: true,
  cycle: { select: { name: true, goalWorkflowVersion: true } },
  employee: { select: { name: true, employeeNo: true, position: true } },
  dept: { select: { name: true } },
  manager: { select: { name: true } },
  deptHead: { select: { name: true } },
  approver: { select: { name: true } },
});
const DETAIL_SELECT = Prisma.validator<Prisma.AssessmentTaskSelect>()({
  ...SUMMARY_SELECT,
  indicatorInstances: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      scoringStandard: true,
      dataSource: true,
      dataCaliber: true,
      targetValue: true,
      targetValueText: true,
      unit: true,
      weight: true,
      indicatorType: true,
      dimensionName: true,
      dimensionWeight: true,
      sortOrder: true,
      visibilityScope: true,
      visibilityRules: { select: { scope: true } },
      visibleDepartments: { select: { departmentId: true } },
      visibleUsers: { select: { userId: true } },
      objectiveAlignments: {
        select: {
          objective: {
            select: { id: true, title: true, level: true, ownerId: true },
          },
        },
      },
      childAlignments: {
        select: {
          parentIndicator: {
            select: {
              id: true,
              name: true,
              task: {
                select: { employee: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  },
  flowRecords: {
    where: { nodeType: { in: GOAL_NODES } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      nodeType: true,
      action: true,
      actorId: true,
      actor: { select: { name: true } },
      comment: true,
      extraData: true,
      createdAt: true,
    },
  },
});
type SummaryRow = Prisma.AssessmentTaskGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

export function canMonitorGoals(viewer: AuthUser): boolean {
  return (
    viewer.sysRole === SysRole.hr ||
    viewer.sysRole === SysRole.system_admin ||
    (viewer.sysRole === SysRole.hr_user &&
      ["cycle_plan_edit", "performance_publish"].every((capability) =>
        viewer.hrCapabilities?.includes(capability),
      ))
  );
}

function goalExtraData(
  data: Prisma.JsonValue,
): Record<string, Prisma.JsonValue> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const safe: Record<string, Prisma.JsonValue> = {};
  const keys = [
    "type",
    "source",
    "count",
    "version",
    "batchId",
    "reason",
    "note",
    "automatic",
    "skipped",
    "merged",
    "managerId",
    "deptHeadId",
    "approverId",
    "goalWorkflowVersion",
    "fromStatus",
    "toStatus",
  ];
  for (const key of keys) {
    const value = data[key];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      safe[key] = value;
  }
  if (Array.isArray(data.items)) {
    const itemKeys = [
      "id",
      "name",
      "description",
      "scoringStandard",
      "dataSource",
      "dataCaliber",
      "targetValue",
      "targetValueText",
      "unit",
      "weight",
      "indicatorType",
      "dimensionName",
      "dimensionWeight",
      "sortOrder",
      "visibilityScope",
    ];
    safe.items = data.items
      .filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => {
        const safeItem: Record<string, Prisma.JsonValue> = {};
        for (const key of itemKeys) {
          const value = (item as Prisma.JsonObject)[key];
          if (
            value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          )
            safeItem[key] = value;
        }
        return safeItem;
      });
  }
  return safe;
}

@Injectable()
export class GoalPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeWhere(
    scope: GoalPlanScope,
    viewer: AuthUser,
  ): Prisma.AssessmentTaskWhereInput {
    if (scope === GoalPlanScope.monitor) {
      if (!canMonitorGoals(viewer))
        throw new ForbiddenException({
          code: ERROR_CODE.FORBIDDEN,
          message: "无权查看全员目标计划",
        });
      return {};
    }
    if (scope === GoalPlanScope.review)
      return {
        OR: [
          { status: "indicator_reviewing", managerId: viewer.id },
          { status: "indicator_setting", managerId: viewer.id },
          { status: "indicator_dept_reviewing", deptHeadId: viewer.id },
          { status: "indicator_approving", approverId: viewer.id },
        ],
      };
    return { employeeId: viewer.id };
  }

  private item(task: SummaryRow, viewer: AuthUser) {
    const version = task.cycle.goalWorkflowVersion ?? 1;
    const isEmployee = task.employeeId === viewer.id;
    const currentReviewer = getGoalReviewActorId(task);
    const reviewer =
      currentReviewer === viewer.id &&
      (!usesFiveStepGoalWorkflow(version) || !isEmployee);
    const legacyAdmin =
      !usesFiveStepGoalWorkflow(version) &&
      (viewer.sysRole === SysRole.hr ||
        viewer.sysRole === SysRole.system_admin);
    const reviewState = [
      "indicator_reviewing",
      "indicator_setting",
      "indicator_dept_reviewing",
      "indicator_approving",
    ].includes(task.status);
    const drafting = ["pending", "indicator_drafting"].includes(task.status);
    const permissions = {
      canEdit:
        !task.isExempt &&
        ((isEmployee && (drafting || task.status === "indicator_setting")) ||
          ((reviewer || legacyAdmin) &&
            ["indicator_reviewing", "indicator_setting"].includes(
              task.status,
            ))),
      canApprove: !task.isExempt && reviewState && (reviewer || legacyAdmin),
      canConfirm:
        !task.isExempt && isEmployee && task.status === "indicator_confirming",
      canReject:
        !task.isExempt &&
        ((reviewState && (reviewer || legacyAdmin)) ||
          (isEmployee && task.status === "indicator_confirming")),
    };
    const currentStep = task.isExempt
      ? "exempt"
      : drafting
        ? "employee_drafting"
        : task.status === "indicator_reviewing" ||
            task.status === "indicator_setting"
          ? "manager_review"
          : task.status === "indicator_dept_reviewing"
            ? "department_review"
            : task.status === "indicator_confirming"
              ? "employee_confirmation"
              : task.status === "indicator_approving"
                ? "leader_review"
                : "effective";
    const handlerId =
      currentStep === "employee_drafting" ||
      currentStep === "employee_confirmation"
        ? task.employeeId
        : currentStep === "effective" || currentStep === "exempt"
          ? null
          : currentReviewer;
    const handlerName =
      handlerId === task.employeeId
        ? task.employee.name
        : handlerId === task.managerId
          ? (task.manager?.name ?? null)
          : handlerId === task.deptHeadId
            ? (task.deptHead?.name ?? null)
            : handlerId === task.approverId
              ? (task.approver?.name ?? null)
              : null;
    return {
      id: task.id,
      cycleId: task.cycleId,
      cycleName: task.cycle.name,
      employeeId: task.employeeId,
      employeeName: task.employee.name,
      employeeNo: task.employee.employeeNo,
      deptId: task.deptId,
      deptName: task.dept?.name ?? null,
      position: task.employee.position,
      managerId: task.managerId,
      managerName: task.manager?.name ?? null,
      deptHeadId: task.deptHeadId,
      deptHeadName: task.deptHead?.name ?? null,
      approverId: task.approverId,
      approverName: task.approver?.name ?? null,
      status: GOAL_STATUSES.includes(task.status)
        ? task.status
        : TaskStatus.goal_confirmed,
      goalWorkflowVersion: version,
      isExempt: task.isExempt,
      exemptReason: task.exemptReason,
      indicatorSetAt: task.indicatorSetAt,
      indicatorConfirmedAt: task.indicatorConfirmedAt,
      goalApprovedAt: task.goalApprovedAt,
      updatedAt: task.updatedAt,
      currentStep,
      currentHandlerId: handlerId,
      currentHandlerName: handlerName,
      permissions,
    };
  }

  async findAll(query: GoalPlanQueryDto, viewer: AuthUser) {
    const conditions: Prisma.AssessmentTaskWhereInput[] = [
      this.scopeWhere(query.scope, viewer),
    ];
    if (query.cycleId) conditions.push({ cycleId: query.cycleId });
    if (query.deptId) conditions.push({ deptId: query.deptId });
    const keyword = query.employeeName?.trim();
    if (keyword)
      conditions.push({
        employee: {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { employeeNo: { contains: keyword, mode: "insensitive" } },
          ],
        },
      });
    if (query.status === "goal_confirmed")
      conditions.push({
        NOT: {
          status: { in: GOAL_STATUSES.filter((s) => s !== "goal_confirmed") },
        },
      });
    else if (query.status) conditions.push({ status: query.status });
    const where: Prisma.AssessmentTaskWhereInput = { AND: conditions };
    const [rows, total] = await Promise.all([
      this.prisma.assessmentTask.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.assessmentTask.count({ where }),
    ]);
    return paginated(
      rows.map((task) => this.item(task, viewer)),
      total,
      query,
    );
  }

  async options(query: GoalPlanQueryDto, viewer: AuthUser) {
    const where = this.scopeWhere(query.scope, viewer);
    const [cycleRows, deptRows] = await Promise.all([
      this.prisma.assessmentTask.findMany({
        where,
        distinct: ["cycleId"],
        select: { cycle: { select: { id: true, name: true } } },
      }),
      this.prisma.assessmentTask.findMany({
        where: { AND: [where, { deptId: { not: null } }] },
        distinct: ["deptId"],
        select: { dept: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      cycles: cycleRows
        .map((row) => row.cycle)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      departments: deptRows
        .flatMap((row) => (row.dept ? [row.dept] : []))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    };
  }

  async findOne(id: string, viewer: AuthUser) {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!task)
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: "目标计划不存在",
      });
    if (
      !canMonitorGoals(viewer) &&
      ![
        task.employeeId,
        task.managerId,
        task.deptHeadId,
        task.approverId,
      ].includes(viewer.id)
    ) {
      throw new ForbiddenException({
        code: ERROR_CODE.FORBIDDEN,
        message: "无权查看该目标计划",
      });
    }
    return {
      ...this.item(task, viewer),
      indicatorInstances: task.indicatorInstances.map((indicator) => ({
        id: indicator.id,
        name: indicator.name,
        description: indicator.description,
        scoringStandard: indicator.scoringStandard,
        dataSource: indicator.dataSource,
        dataCaliber: indicator.dataCaliber,
        targetValue:
          indicator.targetValue === null ? null : Number(indicator.targetValue),
        targetValueText: indicator.targetValueText,
        unit: indicator.unit,
        weight: Number(indicator.weight),
        indicatorType: indicator.indicatorType,
        dimensionName: indicator.dimensionName,
        dimensionWeight: Number(indicator.dimensionWeight),
        sortOrder: indicator.sortOrder,
        visibilityScope: indicator.visibilityScope,
        visibilityScopes: indicator.visibilityRules.length
          ? indicator.visibilityRules.map((r) => r.scope)
          : [indicator.visibilityScope],
        visibleDepartmentIds: indicator.visibleDepartments.map(
          (r) => r.departmentId,
        ),
        visibleUserIds: indicator.visibleUsers.map((r) => r.userId),
        alignedObjectives: indicator.objectiveAlignments.map(
          (r) => r.objective,
        ),
        alignedParentIndicators: indicator.childAlignments.map((r) => ({
          id: r.parentIndicator.id,
          name: r.parentIndicator.name,
          owner: r.parentIndicator.task.employee,
        })),
      })),
      flowRecords: task.flowRecords
        .filter((record) => GOAL_NODES.includes(record.nodeType))
        .map((record) => ({
          id: record.id,
          nodeType: record.nodeType,
          action: record.action,
          actorId: record.actorId,
          actorName: record.actor?.name ?? null,
          comment: record.comment,
          extraData: goalExtraData(record.extraData),
          createdAt: record.createdAt,
        })),
    };
  }
}
