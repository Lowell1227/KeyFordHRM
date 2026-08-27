import { createHash } from "crypto";
import type {
  AssessmentTask,
  IndicatorInstance,
  TaskStatus,
  User,
} from "@prisma/client";
import { IndicatorVisibilityScope, Prisma } from "@prisma/client";

const DEMO_NAMESPACE = Buffer.from("a5ad9655f1d34bbf84e60081cb22e2e8", "hex");

const TARGET_MAPPINGS = [
  {
    employeeNo: "MGR001",
    sourceEmployeeNo: "FD300125",
    visibilityScope: IndicatorVisibilityScope.direct_reports,
  },
  {
    employeeNo: "EMP001",
    sourceEmployeeNo: "FD300126",
    visibilityScope: IndicatorVisibilityScope.supervisors,
  },
] as const;

type DemoUser = Pick<User, "id" | "employeeNo" | "deptId" | "directManagerId">;

type DemoIndicator = Omit<
  Pick<
    IndicatorInstance,
    | "id"
    | "templateIndicatorId"
    | "name"
    | "description"
    | "scoringStandard"
    | "dataSource"
    | "dataCaliber"
    | "targetValue"
    | "targetValueText"
    | "unit"
    | "weight"
    | "indicatorType"
    | "dimensionName"
    | "dimensionWeight"
    | "visibilityScope"
    | "actualValue"
    | "actualNote"
    | "selfScore"
    | "selfComment"
    | "managerScore"
    | "managerComment"
    | "extraScores"
    | "finalScore"
    | "sortOrder"
  >,
  "extraScores"
> & { extraScores: Prisma.JsonValue };

type DemoSourceTask = Pick<
  AssessmentTask,
  | "id"
  | "cycleId"
  | "snapshotId"
  | "deptId"
  | "managerId"
  | "deptHeadId"
  | "approverId"
  | "status"
  | "isExempt"
  | "exemptReason"
  | "indicatorSetAt"
  | "indicatorConfirmedAt"
  | "selfEvalSubmittedAt"
  | "managerScoredAt"
  | "deptReviewedAt"
  | "hrCalibratedAt"
  | "approvedAt"
  | "publishedAt"
  | "employeeConfirmedAt"
  | "closedAt"
> & {
  employee: Pick<User, "employeeNo">;
  indicatorInstances: DemoIndicator[];
};

export interface GoalTrackingDemoInput {
  cycle: { id: string; name: string };
  users: DemoUser[];
  sourceTasks: DemoSourceTask[];
}

export interface GoalTrackingDemoTaskCreate {
  id: string;
  cycleId: string;
  snapshotId: string | null;
  employeeId: string;
  deptId: string | null;
  managerId: string | null;
  deptHeadId: string | null;
  approverId: string | null;
  status: TaskStatus;
  isExempt: boolean;
  exemptReason: string | null;
  indicatorSetAt: Date | null;
  indicatorConfirmedAt: Date | null;
  selfEvalSubmittedAt: Date | null;
  managerScoredAt: Date | null;
  deptReviewedAt: Date | null;
  hrCalibratedAt: Date | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  employeeConfirmedAt: Date | null;
  closedAt: Date | null;
}

export interface GoalTrackingDemoIndicatorCreate {
  id: string;
  taskId: string;
  templateIndicatorId: string | null;
  name: string;
  description: string | null;
  scoringStandard: string | null;
  dataSource: string | null;
  dataCaliber: string | null;
  targetValue: Prisma.Decimal | null;
  targetValueText: string | null;
  unit: string | null;
  weight: Prisma.Decimal;
  indicatorType: DemoIndicator["indicatorType"];
  dimensionName: string | null;
  dimensionWeight: Prisma.Decimal;
  visibilityScope: IndicatorVisibilityScope;
  actualValue: Prisma.Decimal | null;
  actualNote: string | null;
  selfScore: Prisma.Decimal | null;
  selfComment: string | null;
  managerScore: Prisma.Decimal | null;
  managerComment: string | null;
  extraScores: Prisma.InputJsonValue;
  finalScore: Prisma.Decimal | null;
  sortOrder: number;
}

export interface GoalTrackingDemoPlanTask {
  employeeNo: string;
  sourceEmployeeNo: string;
  create: GoalTrackingDemoTaskCreate;
  indicators: Array<{
    sourceIndicatorId: string;
    create: GoalTrackingDemoIndicatorCreate;
  }>;
}

export interface GoalTrackingDemoPlan {
  cycleName: string;
  tasks: GoalTrackingDemoPlanTask[];
}

export function goalTrackingDemoId(kind: "task" | "indicator", key: string) {
  const bytes = createHash("sha1")
    .update(DEMO_NAMESPACE)
    .update(`${kind}:${key}`, "utf8")
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildGoalTrackingDemoPlan(
  input: GoalTrackingDemoInput,
): GoalTrackingDemoPlan {
  if (input.cycle.name !== "2026-Q3") {
    throw new Error(
      `expected formal cycle 2026-Q3, received ${input.cycle.name}`,
    );
  }

  const users = new Map(input.users.map((user) => [user.employeeNo, user]));
  const sources = new Map(
    input.sourceTasks.map((task) => [task.employee.employeeNo, task]),
  );

  const tasks = TARGET_MAPPINGS.map((mapping) => {
    const target = users.get(mapping.employeeNo);
    const source = sources.get(mapping.sourceEmployeeNo);
    if (!target) throw new Error(`missing target user ${mapping.employeeNo}`);
    if (!source) {
      throw new Error(`missing source task for ${mapping.sourceEmployeeNo}`);
    }
    if (source.cycleId !== input.cycle.id) {
      throw new Error(
        `${mapping.sourceEmployeeNo} is not in ${input.cycle.name}`,
      );
    }
    if (!target.deptId || target.deptId !== source.deptId) {
      throw new Error(
        `${mapping.employeeNo} and ${mapping.sourceEmployeeNo} must use the same department`,
      );
    }
    if (source.indicatorInstances.length === 0) {
      throw new Error(
        `${mapping.sourceEmployeeNo} has no real indicators to clone`,
      );
    }

    const taskId = goalTrackingDemoId(
      "task",
      `${input.cycle.name}:${mapping.employeeNo}`,
    );
    const create: GoalTrackingDemoTaskCreate = {
      id: taskId,
      cycleId: input.cycle.id,
      snapshotId: source.snapshotId,
      employeeId: target.id,
      deptId: target.deptId,
      managerId: target.directManagerId,
      deptHeadId: source.deptHeadId,
      approverId: source.approverId,
      status: source.status,
      isExempt: source.isExempt,
      exemptReason: source.exemptReason,
      indicatorSetAt: source.indicatorSetAt,
      indicatorConfirmedAt: source.indicatorConfirmedAt,
      selfEvalSubmittedAt: source.selfEvalSubmittedAt,
      managerScoredAt: source.managerScoredAt,
      deptReviewedAt: source.deptReviewedAt,
      hrCalibratedAt: source.hrCalibratedAt,
      approvedAt: source.approvedAt,
      publishedAt: source.publishedAt,
      employeeConfirmedAt: source.employeeConfirmedAt,
      closedAt: source.closedAt,
    };

    return {
      employeeNo: mapping.employeeNo,
      sourceEmployeeNo: mapping.sourceEmployeeNo,
      create,
      indicators: source.indicatorInstances.map((indicator) => ({
        sourceIndicatorId: indicator.id,
        create: {
          id: goalTrackingDemoId("indicator", `${taskId}:${indicator.id}`),
          taskId,
          templateIndicatorId: indicator.templateIndicatorId,
          name: indicator.name,
          description: indicator.description,
          scoringStandard: indicator.scoringStandard,
          dataSource: indicator.dataSource,
          dataCaliber: indicator.dataCaliber,
          targetValue: indicator.targetValue,
          targetValueText: indicator.targetValueText,
          unit: indicator.unit,
          weight: indicator.weight,
          indicatorType: indicator.indicatorType,
          dimensionName: indicator.dimensionName,
          dimensionWeight: indicator.dimensionWeight,
          visibilityScope: mapping.visibilityScope,
          actualValue: indicator.actualValue,
          actualNote: indicator.actualNote,
          selfScore: indicator.selfScore,
          selfComment: indicator.selfComment,
          managerScore: indicator.managerScore,
          managerComment: indicator.managerComment,
          extraScores:
            indicator.extraScores === null
              ? []
              : (indicator.extraScores as Prisma.InputJsonValue),
          finalScore: indicator.finalScore,
          sortOrder: indicator.sortOrder,
        },
      })),
    };
  });

  return { cycleName: input.cycle.name, tasks };
}
