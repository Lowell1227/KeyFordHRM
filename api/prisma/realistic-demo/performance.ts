import {
  PerfGrade,
  Prisma,
  type FlowNodeType,
  type TaskStatus,
} from "@prisma/client";
import { ExemptService } from "../../src/cycles/exempt.service";
import { DEMO_CONFIG } from "./config";
import type { DemoContext } from "./context";
import { generateNarratives } from "./narratives";
import type {
  CatalogBundle,
  GeneratedTemplate,
  PeopleBundle,
  PerformanceBundle,
} from "./types";

const CYCLES = [
  {
    key: "2025-LEGACY",
    type: "annual",
    status: "closed",
    start: "2025-01-01",
    end: "2025-12-31",
  },
  {
    key: "2026-Q1",
    type: "quarterly",
    status: "closed",
    start: "2026-01-01",
    end: "2026-03-31",
  },
  {
    key: "2026-Q2",
    type: "quarterly",
    status: "appeal",
    start: "2026-04-01",
    end: "2026-06-30",
  },
  {
    key: "2026-Q3",
    type: "quarterly",
    status: "self_eval",
    start: "2026-07-01",
    end: "2026-09-30",
  },
  {
    key: "2026-ANNUAL-LEADERS",
    type: "annual",
    status: "self_eval",
    start: "2026-01-01",
    end: "2026-12-31",
  },
] as const;

type CycleKey = (typeof CYCLES)[number]["key"];
type UserRow = Prisma.UserCreateManyInput;

interface CompletedRecord {
  task: Prisma.AssessmentTaskCreateManyInput;
  employee: UserRow;
  indicators: Prisma.IndicatorInstanceCreateManyInput[];
  calculatedScore: number;
  performanceIndex: number;
}

const TOP_DEPARTMENT_BY_CHILD = new Map<string, string>([
  [
    "00000000-0000-0000-0000-000000001011",
    "00000000-0000-0000-0000-000000000011",
  ],
  [
    "00000000-0000-0000-0000-000000001021",
    "00000000-0000-0000-0000-000000000011",
  ],
  [
    "00000000-0000-0000-0000-000000000103",
    "00000000-0000-0000-0000-000000000010",
  ],
  [
    "00000000-0000-0000-0000-000000000104",
    "00000000-0000-0000-0000-000000000010",
  ],
  [
    "00000000-0000-0000-0000-000000000105",
    "00000000-0000-0000-0000-000000000010",
  ],
  [
    "00000000-0000-0000-0000-000000000106",
    "00000000-0000-0000-0000-000000000010",
  ],
  [
    "00000000-0000-0000-0000-000000000107",
    "00000000-0000-0000-0000-000000000010",
  ],
  [
    "00000000-0000-0000-0000-000000000121",
    "00000000-0000-0000-0000-000000000012",
  ],
  [
    "00000000-0000-0000-0000-000000000122",
    "00000000-0000-0000-0000-000000000012",
  ],
  [
    "00000000-0000-0000-0000-000000000141",
    "00000000-0000-0000-0000-000000000014",
  ],
  [
    "00000000-0000-0000-0000-000000000142",
    "00000000-0000-0000-0000-000000000014",
  ],
]);

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function topDepartment(deptId: string | null | undefined): string | null {
  if (!deptId) return null;
  return TOP_DEPARTMENT_BY_CHILD.get(deptId) ?? deptId;
}

export function calculateIndicatorScore(
  target: number,
  actual: number,
  higherIsBetter = true,
): number {
  const ratio = higherIsBetter
    ? actual / target
    : target / Math.max(actual, 0.0001);
  return Math.max(0, Math.min(100, Math.round(ratio * 10000) / 100));
}

export function rawGrade(score: number): PerfGrade {
  if (score >= 90) return PerfGrade.A;
  if (score >= 75) return PerfGrade.B;
  if (score >= 60) return PerfGrade.C;
  return PerfGrade.D;
}

function stableNumber(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cycleNoise(employeeId: string, cycleKey: CycleKey): number {
  return (stableNumber(`${employeeId}:${cycleKey}`) % 13) - 6;
}

function basePerformance(
  employee: UserRow,
  cycleKey: "2026-Q1" | "2026-Q2",
  storyUserIds: Record<string, string>,
): number {
  const employeeId = employee.id!;
  const fixed: Record<string, [number, number]> = {
    excellentManager: [95, 94],
    stableContributor: [82, 78],
    lowPerformer: [68, 55],
    consecutiveLowPerformerA: [54, 52],
    consecutiveLowPerformerB: [56, 53],
    appealModified: [72, 70],
    appealMaintained: [79, 77],
  };
  for (const [story, scores] of Object.entries(fixed)) {
    if (storyUserIds[story] === employeeId)
      return scores[cycleKey === "2026-Q1" ? 0 : 1];
  }
  const stableFactor = 64 + (stableNumber(employeeId) % 32);
  return clamp(stableFactor + cycleNoise(employeeId, cycleKey), 52, 99);
}

function templateForEmployee(
  catalog: CatalogBundle,
  employee: UserRow,
  cycleKey: CycleKey,
  transferredEmployeeId: string,
): GeneratedTemplate {
  if (cycleKey === "2026-Q3" && employee.id === transferredEmployeeId)
    return catalog.templateForFamily("supplyChain");
  const template = catalog.templates.find((row) => {
    const applicableUsers = Array.isArray(row.applicableUsers)
      ? row.applicableUsers
      : ((row.applicableUsers as { set?: string[] } | undefined)?.set ?? []);
    return applicableUsers.includes(employee.id!);
  });
  if (!template)
    throw new Error(`${cycleKey}/${employee.employeeNo}/template missing`);
  const dimensions = catalog.dimensions.filter(
    (row) => row.templateId === template.id,
  );
  const dimensionIds = new Set(dimensions.map((row) => row.id));
  return {
    template,
    dimensions,
    indicators: catalog.templateIndicators.filter((row) =>
      dimensionIds.has(row.dimensionId),
    ),
  };
}

function snapshotJson(template: GeneratedTemplate): Prisma.InputJsonValue {
  return {
    templateId: template.template.id!,
    name: template.template.name,
    description: template.template.description ?? null,
    maxScore: Number(template.template.maxScore ?? 100),
    version: template.template.version ?? 1,
    dimensions: template.dimensions.map((dimension) => ({
      id: dimension.id!,
      name: dimension.name,
      weight: Number(dimension.weight),
      type: dimension.type,
      sortOrder: dimension.sortOrder ?? 0,
      indicators: template.indicators
        .filter((indicator) => indicator.dimensionId === dimension.id)
        .map((indicator) => ({
          id: indicator.id!,
          indicatorId: indicator.indicatorId ?? null,
          name: indicator.name,
          description: indicator.description ?? null,
          scoringStandard: indicator.scoringStandard ?? null,
          targetValue:
            indicator.targetValue == null
              ? null
              : Number(indicator.targetValue),
          targetValueText: indicator.targetValueText ?? null,
          unit: indicator.unit ?? null,
          weight: Number(indicator.weight),
          sortOrder: indicator.sortOrder ?? 0,
          indicatorType: dimension.type,
        })),
    })),
  };
}

function taskStatus(
  cycleKey: CycleKey,
  employeeIndex: number,
  nonExemptIndex: number,
  employeeId: string,
  q3SettingIds: Set<string>,
  q3ConfirmingIds: Set<string>,
): TaskStatus {
  if (cycleKey === "2026-Q1") return "closed";
  if (cycleKey === "2026-Q2") {
    if (nonExemptIndex < 115) return "confirmed";
    if (nonExemptIndex < 117) return "appealing";
    return "published";
  }
  if (cycleKey === "2026-Q3") {
    if (q3SettingIds.has(employeeId)) return "indicator_setting";
    if (q3ConfirmingIds.has(employeeId)) return "indicator_confirming";
    return "self_eval";
  }
  void employeeIndex;
  return "self_eval";
}

function stageTimes(cycleKey: CycleKey) {
  if (cycleKey === "2026-Q1")
    return {
      set: utcDate("2026-01-08"),
      confirm: utcDate("2026-01-12"),
      self: utcDate("2026-04-02"),
      manager: utcDate("2026-04-05"),
      dept: utcDate("2026-04-08"),
      hr: utcDate("2026-04-10"),
      approve: utcDate("2026-04-12"),
      publish: utcDate("2026-04-15"),
      employee: utcDate("2026-04-16"),
      close: utcDate("2026-04-20"),
    };
  if (cycleKey === "2026-Q2")
    return {
      set: utcDate("2026-04-08"),
      confirm: utcDate("2026-04-12"),
      self: utcDate("2026-07-02"),
      manager: utcDate("2026-07-05"),
      dept: utcDate("2026-07-08"),
      hr: utcDate("2026-07-10"),
      approve: utcDate("2026-07-12"),
      publish: utcDate("2026-07-15"),
      employee: utcDate("2026-07-18"),
      close: null,
    };
  return {
    set: utcDate(cycleKey === "2026-Q3" ? "2026-07-08" : "2026-07-01"),
    confirm: utcDate(cycleKey === "2026-Q3" ? "2026-07-12" : "2026-07-05"),
    self: null,
    manager: null,
    dept: null,
    hr: null,
    approve: null,
    publish: null,
    employee: null,
    close: null,
  };
}

function createIndicatorRows(
  context: DemoContext,
  taskId: string,
  template: GeneratedTemplate,
  score: number | null,
  createdAt: Date,
): Prisma.IndicatorInstanceCreateManyInput[] {
  const dimensionById = new Map(
    template.dimensions.map((dimension) => [dimension.id!, dimension]),
  );
  const offsets = [-5, -2, 0, 2, 4, 1];
  return template.indicators.map((indicator, index) => {
    const dimension = dimensionById.get(indicator.dimensionId);
    if (!dimension)
      throw new Error(`${taskId}/${indicator.id}/dimension missing`);
    const target = Number(indicator.targetValue ?? 100);
    const desired =
      score == null
        ? null
        : clamp(score + offsets[index % offsets.length], 0, 100);
    const actual = desired == null ? null : round2((target * desired) / 100);
    const finalScore =
      actual == null || target <= 0
        ? null
        : calculateIndicatorScore(target, actual);
    return {
      id: context.own(
        "indicator-instance",
        context.id("indicator-instance", `${taskId}:${indicator.id}`),
      ),
      taskId,
      templateIndicatorId: indicator.id,
      name: indicator.name,
      description: indicator.description ?? null,
      scoringStandard: indicator.scoringStandard ?? null,
      dataSource: indicator.dataSource ?? null,
      dataCaliber: indicator.dataCaliber ?? null,
      targetValue:
        indicator.targetValue == null
          ? null
          : new Prisma.Decimal(indicator.targetValue.toString()),
      targetValueText: indicator.targetValueText ?? null,
      unit: indicator.unit ?? null,
      weight: new Prisma.Decimal(indicator.weight.toString()),
      indicatorType: dimension.type,
      dimensionName: dimension.name,
      dimensionWeight: new Prisma.Decimal(dimension.weight.toString()),
      actualValue: actual == null ? null : new Prisma.Decimal(actual),
      actualNote:
        actual == null ? null : `${indicator.name}按模板数据口径完成周期核验。`,
      selfScore:
        finalScore == null
          ? null
          : new Prisma.Decimal(clamp(finalScore + 1, 0, 100)),
      selfComment:
        finalScore == null ? null : `${indicator.name}已完成自评并附交付说明。`,
      managerScore: finalScore == null ? null : new Prisma.Decimal(finalScore),
      managerComment:
        finalScore == null ? null : `${indicator.name}评分依据与数据证据一致。`,
      extraScores: [],
      finalScore: finalScore == null ? null : new Prisma.Decimal(finalScore),
      sortOrder: indicator.sortOrder ?? index,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function addFlow(
  context: DemoContext,
  rows: Prisma.FlowRecordCreateManyInput[],
  task: Prisma.AssessmentTaskCreateManyInput,
  nodeType: FlowNodeType,
  actorId: string | null | undefined,
  createdAt: Date | null | undefined,
  sequence: number,
): void {
  if (!createdAt) return;
  rows.push({
    id: context.own(
      "flow",
      context.id(
        "flow",
        `${task.id}:${String(sequence).padStart(2, "0")}:${nodeType}`,
      ),
    ),
    taskId: task.id!,
    cycleId: task.cycleId,
    nodeType,
    actorId: actorId ?? null,
    action: nodeType === "publish" ? "approve" : "submit",
    comment: `${nodeType}节点已按演示业务路径完成。`,
    extraData: { source: DEMO_CONFIG.source },
    createdAt,
  });
}

function createTaskFlows(
  context: DemoContext,
  rows: Prisma.FlowRecordCreateManyInput[],
  task: Prisma.AssessmentTaskCreateManyInput,
  hrId: string,
): void {
  addFlow(
    context,
    rows,
    task,
    "indicator_setting",
    task.managerId,
    task.indicatorSetAt as Date | null,
    1,
  );
  addFlow(
    context,
    rows,
    task,
    "indicator_confirm",
    task.employeeId,
    task.indicatorConfirmedAt as Date | null,
    2,
  );
  addFlow(
    context,
    rows,
    task,
    "self_eval",
    task.employeeId,
    task.selfEvalSubmittedAt as Date | null,
    3,
  );
  addFlow(
    context,
    rows,
    task,
    "manager_score",
    task.managerId,
    task.managerScoredAt as Date | null,
    4,
  );
  addFlow(
    context,
    rows,
    task,
    "dept_review",
    task.deptHeadId,
    task.deptReviewedAt as Date | null,
    5,
  );
  addFlow(
    context,
    rows,
    task,
    "hr_calibration",
    hrId,
    task.hrCalibratedAt as Date | null,
    6,
  );
  addFlow(
    context,
    rows,
    task,
    "approval",
    task.approverId,
    task.approvedAt as Date | null,
    7,
  );
  addFlow(
    context,
    rows,
    task,
    "publish",
    hrId,
    task.publishedAt as Date | null,
    8,
  );
  addFlow(
    context,
    rows,
    task,
    "employee_confirm",
    task.employeeId,
    task.employeeConfirmedAt as Date | null,
    9,
  );
}

function forcedGrades(
  cycleKey: "2026-Q1" | "2026-Q2",
  storyUserIds: Record<string, string>,
): Map<string, PerfGrade> {
  const values: Array<[string, PerfGrade, PerfGrade]> = [
    ["excellentManager", PerfGrade.A, PerfGrade.A],
    ["stableContributor", PerfGrade.B, PerfGrade.B],
    ["lowPerformer", PerfGrade.C, PerfGrade.D],
    ["consecutiveLowPerformerA", PerfGrade.D, PerfGrade.D],
    ["consecutiveLowPerformerB", PerfGrade.D, PerfGrade.D],
    ["appealModified", PerfGrade.C, PerfGrade.B],
    ["appealMaintained", PerfGrade.B, PerfGrade.B],
  ];
  return new Map(
    values.map(([story, q1, q2]) => [
      storyUserIds[story],
      cycleKey === "2026-Q1" ? q1 : q2,
    ]),
  );
}

function calibratedGrades(
  records: CompletedRecord[],
  cycleKey: "2026-Q1" | "2026-Q2",
  storyUserIds: Record<string, string>,
): Map<string, PerfGrade> {
  const configured =
    cycleKey === "2026-Q1"
      ? DEMO_CONFIG.q1.gradeCount
      : DEMO_CONFIG.q2.gradeCount;
  const remaining: Record<PerfGrade, number> = { ...configured };
  const result = new Map<string, PerfGrade>();
  for (const [employeeId, grade] of forcedGrades(cycleKey, storyUserIds)) {
    const record = records.find(
      (candidate) => candidate.employee.id === employeeId,
    );
    if (!record) continue;
    if (remaining[grade] <= 0)
      throw new Error(`${cycleKey}/${grade}/fixed quota exhausted`);
    result.set(record.task.id!, grade);
    remaining[grade] -= 1;
  }
  const ordered = records
    .filter((record) => !result.has(record.task.id!))
    .sort(
      (left, right) =>
        right.performanceIndex - left.performanceIndex ||
        String(left.employee.employeeNo).localeCompare(
          String(right.employee.employeeNo),
        ),
    );
  let cursor = 0;
  for (const grade of [PerfGrade.A, PerfGrade.B, PerfGrade.C, PerfGrade.D]) {
    for (let count = 0; count < remaining[grade]; count += 1) {
      const record = ordered[cursor++];
      if (!record)
        throw new Error(`${cycleKey}/${grade}/insufficient grade candidates`);
      result.set(record.task.id!, grade);
    }
  }
  if (cursor !== ordered.length)
    throw new Error(`${cycleKey}/unassigned grade candidates`);
  return result;
}

function cycleRows(context: DemoContext, hrId: string) {
  return CYCLES.map((definition) => {
    const id = context.own("cycle", context.id("cycle", definition.key));
    const completed = definition.key === "2026-Q1";
    const published =
      definition.key === "2026-Q1" || definition.key === "2026-Q2";
    return {
      id,
      name: definition.key,
      type: definition.type,
      startDate: utcDate(definition.start),
      endDate: utcDate(definition.end),
      deadlineIndicatorSetting: utcDate(
        definition.key === "2026-Q2" ? "2026-04-10" : "2026-01-10",
      ),
      deadlineIndicatorConfirm: utcDate(
        definition.key === "2026-Q2" ? "2026-04-15" : "2026-01-15",
      ),
      deadlineSelfEval: utcDate(
        definition.key === "2026-Q1" ? "2026-04-03" : "2026-07-03",
      ),
      deadlineManagerScore: utcDate(
        definition.key === "2026-Q1" ? "2026-04-06" : "2026-07-06",
      ),
      deadlineHrCalibration: utcDate(
        definition.key === "2026-Q1" ? "2026-04-11" : "2026-07-11",
      ),
      deadlineApproval: utcDate(
        definition.key === "2026-Q1" ? "2026-04-13" : "2026-07-13",
      ),
      deadlinePublish: utcDate(
        definition.key === "2026-Q1" ? "2026-04-15" : "2026-07-15",
      ),
      deadlineAppeal: utcDate(
        definition.key === "2026-Q1" ? "2026-04-30" : "2026-07-31",
      ),
      status: definition.status,
      publishVisibleFields: {
        total_score: true,
        grade: true,
        indicator_scores: true,
        manager_comment: true,
        coefficient: true,
      },
      gradeAMaxRatio: new Prisma.Decimal(0.2),
      gradeBMaxRatio: new Prisma.Decimal(0.4),
      gradeCMaxRatio: new Prisma.Decimal(0.3),
      gradeDMaxRatio: new Prisma.Decimal(0.1),
      createdBy: hrId,
      publishedAt: published
        ? utcDate(definition.key === "2026-Q1" ? "2026-04-15" : "2026-07-15")
        : null,
      closedAt: completed ? utcDate("2026-04-20") : null,
      createdAt: utcDate("2025-12-15"),
      updatedAt: published
        ? utcDate(definition.key === "2026-Q1" ? "2026-04-20" : "2026-07-15")
        : utcDate("2026-07-15"),
    } satisfies Prisma.AssessmentCycleCreateManyInput;
  });
}

function createObjectives(
  context: DemoContext,
  people: PeopleBundle,
  catalog: CatalogBundle,
  cycleIdByKey: Map<CycleKey, string>,
  annualLeaders: UserRow[],
  currentUsers: UserRow[],
): Pick<PerformanceBundle, "objectives" | "actionItems"> {
  const objectives: Prisma.ObjectiveCreateManyInput[] = [];
  const actionItems: Prisma.ActionItemCreateManyInput[] = [];
  const vpId = people.users.find((user) => user.sysRole === "vp")!.id!;
  const q3Id = cycleIdByKey.get("2026-Q3")!;
  const annualId = cycleIdByKey.get("2026-ANNUAL-LEADERS")!;
  const companyId = context.own(
    "objective",
    context.id("objective", "company-2026"),
  );
  objectives.push({
    id: companyId,
    title: "提升年度经营质量与组织交付能力",
    description: "聚焦客户价值、经营质量、人才培养和跨部门协同。",
    level: "company",
    ownerId: vpId,
    cycleId: q3Id,
    weight: new Prisma.Decimal(100),
    priority: 1,
    progress: 58,
    status: "active",
    relatedIndicatorId: catalog.indicators[0].id,
    createdBy: vpId,
    createdAt: utcDate("2026-07-01"),
    updatedAt: utcDate("2026-08-08"),
  });
  const departmentObjectives = people.departmentLeadership.map(
    (leadership, index) => {
      const id = context.own(
        "objective",
        context.id("objective", `department-${leadership.id}-2026`),
      );
      const row: Prisma.ObjectiveCreateManyInput = {
        id,
        title: `部门目标${index + 1}：提升关键业务交付质量`,
        description: "承接公司目标并形成可量化的季度里程碑。",
        level: "department",
        deptId: leadership.id,
        ownerId: leadership.leaderId,
        parentId: companyId,
        cycleId: q3Id,
        weight: new Prisma.Decimal(100),
        priority: index + 1,
        progress: 40 + (index % 5) * 8,
        status: "active",
        relatedIndicatorId:
          catalog.indicators[index % catalog.indicators.length].id,
        createdBy: vpId,
        createdAt: utcDate("2026-07-02"),
        updatedAt: utcDate("2026-08-08"),
      };
      objectives.push(row);
      return row;
    },
  );
  const departmentObjectiveByDept = new Map(
    departmentObjectives.map((row) => [row.deptId!, row.id!]),
  );
  const individualOwners = [
    ...annualLeaders,
    ...currentUsers.filter(
      (user) => !annualLeaders.some((leader) => leader.id === user.id),
    ),
  ].slice(0, DEMO_CONFIG.objectiveCount.individual);
  for (const [index, owner] of individualOwners.entries()) {
    const parentDept =
      topDepartment(owner.deptId) ?? people.departmentLeadership[0].id;
    const parentId =
      departmentObjectiveByDept.get(parentDept) ?? departmentObjectives[0].id!;
    objectives.push({
      id: context.own(
        "objective",
        context.id("objective", `individual-${owner.id}-2026`),
      ),
      title: `${owner.name}个人关键成果目标`,
      description: "将部门目标拆解为可验证的个人交付和改善动作。",
      level: "individual",
      deptId: owner.deptId,
      ownerId: owner.id,
      parentId,
      cycleId: index < annualLeaders.length ? annualId : q3Id,
      weight: new Prisma.Decimal(100),
      priority: (index % 3) + 1,
      progress: 35 + (index % 6) * 9,
      status: "active",
      relatedIndicatorId:
        catalog.indicators[index % catalog.indicators.length].id,
      createdBy: owner.id,
      createdAt: utcDate("2026-07-03"),
      updatedAt: utcDate("2026-08-09"),
    });
  }
  for (const [objectiveIndex, objective] of objectives.entries()) {
    for (let itemIndex = 0; itemIndex < 2; itemIndex += 1) {
      actionItems.push({
        id: context.own(
          "action-item",
          context.id("action-item", `${objective.id}:${itemIndex + 1}`),
        ),
        objectiveId: objective.id!,
        title:
          itemIndex === 0
            ? "完成关键里程碑与证据归档"
            : "组织复盘并落实下一步改善",
        description: "行动项须保留负责人、时间点和可核验结果。",
        assigneeId: objective.ownerId ?? vpId,
        startDate: utcDate("2026-07-05"),
        dueDate: utcDate(itemIndex === 0 ? "2026-08-31" : "2026-09-30"),
        status: objectiveIndex % 3 === 0 ? "in_progress" : "todo",
        progress: objectiveIndex % 3 === 0 ? 45 : 0,
        createdBy: objective.createdBy ?? vpId,
        createdAt: utcDate("2026-07-05"),
        updatedAt: utcDate("2026-08-09"),
      });
    }
  }
  const expectedObjectiveTotal =
    DEMO_CONFIG.objectiveCount.company +
    DEMO_CONFIG.objectiveCount.department +
    DEMO_CONFIG.objectiveCount.individual;
  if (objectives.length !== expectedObjectiveTotal)
    throw new Error(
      `objectives expected ${expectedObjectiveTotal}, received ${objectives.length}`,
    );
  if (actionItems.length !== DEMO_CONFIG.actionItemCount)
    throw new Error(
      `action items expected ${DEMO_CONFIG.actionItemCount}, received ${actionItems.length}`,
    );
  return { objectives, actionItems };
}

export function generatePerformance(
  context: DemoContext,
  people: PeopleBundle,
  catalog: CatalogBundle,
): PerformanceBundle {
  const currentUsers = people.users.filter(
    (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
  );
  if (currentUsers.length !== 128)
    throw new Error(
      `performance/current-users expected 128, received ${currentUsers.length}`,
    );
  const hrId = people.users.find((user) => user.sysRole === "hr")!.id!;
  const vpId = people.users.find((user) => user.sysRole === "vp")!.id!;
  const employeeNoByUserId = new Map(
    people.users.map((user) => [user.id!, user.employeeNo!]),
  );
  const cycles = cycleRows(context, hrId);
  const cycleIdByKey = new Map(
    cycles.map((cycle) => [cycle.name as CycleKey, cycle.id!]),
  );
  const snapshots: Prisma.AssessmentTemplateSnapshotCreateManyInput[] = [];
  const tasks: Prisma.AssessmentTaskCreateManyInput[] = [];
  const indicatorInstances: Prisma.IndicatorInstanceCreateManyInput[] = [];
  const selfEvaluations: Prisma.SelfEvalSummaryCreateManyInput[] = [];
  const managerEvaluations: Prisma.ManagerEvalSummaryCreateManyInput[] = [];
  const gradeResults: Prisma.GradeResultCreateManyInput[] = [];
  const flowRecords: Prisma.FlowRecordCreateManyInput[] = [];
  const archives: Prisma.PerformanceArchiveCreateManyInput[] = [];
  const completedByCycle = new Map<string, CompletedRecord[]>();
  const exemption = new ExemptService();
  const transferredEmployeeId = people.storyUserIds.transferredEmployee;
  const q3SettingIds = new Set([
    ...currentUsers.slice(-4).map((user) => user.id!),
    transferredEmployeeId,
    currentUsers[123].id!,
  ]);
  const q3ConfirmingIds = new Set(
    currentUsers
      .slice(114, 123)
      .map((user) => user.id!)
      .filter((id) => !q3SettingIds.has(id)),
  );
  while (q3ConfirmingIds.size < 9) {
    const candidate = currentUsers[113 - q3ConfirmingIds.size]?.id;
    if (!candidate) throw new Error("Q3 confirming quota cannot be filled");
    if (!q3SettingIds.has(candidate)) q3ConfirmingIds.add(candidate);
  }

  const leadershipIds = people.departmentLeadership
    .map((row) => row.leaderId)
    .filter((id): id is string => Boolean(id) && id !== vpId);
  const firstLevelLeaderIds = [...new Set(leadershipIds)];
  for (const managerId of people.managerIds) {
    if (firstLevelLeaderIds.length >= 9) break;
    if (managerId !== vpId && !firstLevelLeaderIds.includes(managerId))
      firstLevelLeaderIds.push(managerId);
  }
  const keyBusinessLeaderIds = people.managerIds
    .filter((id) => id !== vpId && !firstLevelLeaderIds.includes(id))
    .slice(0, 2);
  const annualLeaderIds = [
    vpId,
    ...firstLevelLeaderIds.slice(0, 9),
    ...keyBusinessLeaderIds,
  ];
  const annualLeaders = annualLeaderIds.map((id) => {
    const user = currentUsers.find((candidate) => candidate.id === id);
    if (!user) throw new Error(`annual leader ${id} is not a current user`);
    return user;
  });
  if (new Set(annualLeaderIds).size !== DEMO_CONFIG.annualLeaderTaskCount)
    throw new Error("annual leader selection must contain 12 unique users");

  for (const definition of CYCLES.filter((row) => row.key !== "2025-LEGACY")) {
    const cycleId = cycleIdByKey.get(definition.key)!;
    const candidates =
      definition.key === "2026-ANNUAL-LEADERS"
        ? annualLeaders
        : currentUsers.filter(
            (user) => user.entryDate! <= utcDate(definition.end),
          );
    const snapshotByTemplateId = new Map<string, string>();
    let nonExemptIndex = 0;
    for (const [employeeIndex, employee] of candidates.entries()) {
      const effectiveDeptId =
        definition.key === "2026-Q3" && employee.id === transferredEmployeeId
          ? "00000000-0000-0000-0000-000000000121"
          : employee.deptId;
      const template = templateForEmployee(
        catalog,
        employee,
        definition.key,
        transferredEmployeeId,
      );
      let snapshotId = snapshotByTemplateId.get(template.template.id!);
      if (!snapshotId) {
        snapshotId = context.own(
          "snapshot",
          context.id("snapshot", `${definition.key}:${template.template.id}`),
        );
        snapshotByTemplateId.set(template.template.id!, snapshotId);
        snapshots.push({
          id: snapshotId,
          cycleId,
          templateId: template.template.id!,
          snapshotData: snapshotJson(template),
          createdAt: utcDate(definition.start),
        });
      }
      const exemptResult =
        definition.key === "2026-Q1" || definition.key === "2026-Q2"
          ? exemption.calcExempt(
              {
                entryDate: employee.entryDate as Date,
                leaveDate: employee.leaveDate as Date | null,
              },
              {
                startDate: utcDate(definition.start),
                endDate: utcDate(definition.end),
              },
              0.3333,
            )
          : { isExempt: false, onJobDays: 0 };
      const status = exemptResult.isExempt
        ? "exempted"
        : taskStatus(
            definition.key,
            employeeIndex,
            nonExemptIndex,
            employee.id!,
            q3SettingIds,
            q3ConfirmingIds,
          );
      const times = stageTimes(definition.key);
      const completed =
        definition.key === "2026-Q1" || definition.key === "2026-Q2";
      const taskCreatedAt = new Date(
        Math.max(
          utcDate(definition.start).getTime(),
          new Date(employee.entryDate!).getTime(),
        ),
      );
      const effectiveSetAt = new Date(
        Math.max(times.set.getTime(), taskCreatedAt.getTime()),
      );
      const effectiveConfirmAt = new Date(
        Math.max(
          times.confirm.getTime(),
          effectiveSetAt.getTime() + 24 * 60 * 60 * 1000,
        ),
      );
      const indicatorSetAt =
        !exemptResult.isExempt && status !== "indicator_setting"
          ? effectiveSetAt
          : null;
      const indicatorConfirmedAt =
        !exemptResult.isExempt &&
        status !== "indicator_setting" &&
        status !== "indicator_confirming"
          ? effectiveConfirmAt
          : null;
      const taskId = context.own(
        "task",
        context.id("task", `${definition.key}:${employee.id}`),
      );
      const leadershipDept = topDepartment(effectiveDeptId);
      const deptHeadId = leadershipDept
        ? (people.deptHeadByDepartmentId.get(leadershipDept) ?? null)
        : null;
      const approverId = leadershipDept
        ? (people.approverByDepartmentId.get(leadershipDept) ?? vpId)
        : vpId;
      const lastBusinessTimestamp =
        (completed && !exemptResult.isExempt
          ? times.publish
          : indicatorConfirmedAt) ??
        indicatorSetAt ??
        taskCreatedAt;
      const task: Prisma.AssessmentTaskCreateManyInput = {
        id: taskId,
        cycleId,
        snapshotId,
        employeeId: employee.id!,
        deptId: effectiveDeptId ?? null,
        managerId:
          people.managerByUserId.get(employee.id!) ??
          employee.directManagerId ??
          null,
        deptHeadId,
        approverId,
        status,
        isExempt: exemptResult.isExempt,
        exemptReason: exemptResult.isExempt
          ? `周期在岗${exemptResult.onJobDays}天，不足周期三分之一`
          : null,
        indicatorSetAt,
        indicatorConfirmedAt,
        selfEvalSubmittedAt:
          completed && !exemptResult.isExempt ? times.self : null,
        managerScoredAt:
          completed && !exemptResult.isExempt ? times.manager : null,
        deptReviewedAt: completed && !exemptResult.isExempt ? times.dept : null,
        hrCalibratedAt: completed && !exemptResult.isExempt ? times.hr : null,
        approvedAt: completed && !exemptResult.isExempt ? times.approve : null,
        publishedAt: completed && !exemptResult.isExempt ? times.publish : null,
        employeeConfirmedAt:
          !exemptResult.isExempt &&
          (definition.key === "2026-Q1" || status === "confirmed")
            ? times.employee
            : null,
        closedAt:
          definition.key === "2026-Q1" && !exemptResult.isExempt
            ? times.close
            : null,
        createdAt: taskCreatedAt,
        updatedAt: new Date(
          Math.max(taskCreatedAt.getTime(), lastBusinessTimestamp.getTime()),
        ),
      };
      tasks.push(task);
      if (exemptResult.isExempt) continue;
      const performanceScore = completed
        ? basePerformance(employee, definition.key, people.storyUserIds)
        : null;
      const instances = createIndicatorRows(
        context,
        taskId,
        template,
        performanceScore,
        taskCreatedAt,
      );
      indicatorInstances.push(...instances);
      createTaskFlows(context, flowRecords, task, hrId);
      if (completed && performanceScore != null) {
        const calculatedScore = round2(
          instances.reduce(
            (sum, indicator) =>
              sum + Number(indicator.finalScore) * Number(indicator.weight),
            0,
          ),
        );
        const narrative = generateNarratives(
          context,
          taskId,
          instances,
          times.self!,
        );
        selfEvaluations.push(narrative.selfEvaluation);
        managerEvaluations.push(narrative.managerEvaluation);
        const record: CompletedRecord = {
          task,
          employee,
          indicators: instances,
          calculatedScore,
          performanceIndex: performanceScore,
        };
        const records = completedByCycle.get(definition.key) ?? [];
        records.push(record);
        completedByCycle.set(definition.key, records);
      }
      nonExemptIndex += 1;
    }
  }

  const departmentNameById = new Map([
    ...DEMO_CONFIG.baseDepartments.map(
      (row) => [row.id, row.expectedName] as const,
    ),
    ...people.departments.map((row) => [row.id!, row.name] as const),
  ]);
  for (const cycleKey of ["2026-Q1", "2026-Q2"] as const) {
    const records = completedByCycle.get(cycleKey) ?? [];
    const grades = calibratedGrades(records, cycleKey, people.storyUserIds);
    for (const record of records) {
      const calibratedGrade = grades.get(record.task.id!)!;
      const calculatedRawGrade = rawGrade(record.calculatedScore);
      const publishedAt = record.task.publishedAt as Date;
      gradeResults.push({
        id: context.own("grade", context.id("grade", record.task.id!)),
        taskId: record.task.id!,
        calculatedScore: new Prisma.Decimal(record.calculatedScore),
        rawGrade: calculatedRawGrade,
        calibratedGrade,
        calibrationNote:
          calculatedRawGrade === calibratedGrade
            ? null
            : `依据${cycleKey}强制分布与同岗横向校准，由${calculatedRawGrade}调整为${calibratedGrade}。`,
        isVeto: false,
        coefficient: new Prisma.Decimal(
          DEMO_CONFIG.gradeCoefficient[calibratedGrade],
        ),
        isPublished: true,
        publishedAt,
        hrCalibratorId: hrId,
        hrCalibratedAt: record.task.hrCalibratedAt,
        approverId: record.task.approverId,
        approvedAt: record.task.approvedAt,
        employeeConfirmedAt: record.task.employeeConfirmedAt,
        createdAt: record.task.createdAt,
        updatedAt: publishedAt,
      });
      archives.push({
        id: context.own("archive", context.id("archive", record.task.id!)),
        employeeId: record.employee.id!,
        cycleId: record.task.cycleId,
        employeeName: record.employee.name,
        deptName:
          departmentNameById.get(topDepartment(record.task.deptId) ?? "") ??
          null,
        grade: calibratedGrade,
        totalScore: new Prisma.Decimal(record.calculatedScore),
        coefficient: new Prisma.Decimal(
          DEMO_CONFIG.gradeCoefficient[calibratedGrade],
        ),
        summary: {
          source: DEMO_CONFIG.source,
          taskId: record.task.id!,
          rawGrade: calculatedRawGrade,
          calibratedGrade,
        },
        archivedAt: publishedAt,
      });
    }
  }

  const legacyCycleId = cycleIdByKey.get("2025-LEGACY")!;
  const legacyUsers = [
    ...currentUsers
      .filter((user) => user.entryDate! < utcDate("2026-01-01"))
      .slice(0, 116),
    ...people.users.filter((user) => user.status === "resigned"),
  ];
  for (const [index, employee] of legacyUsers.entries()) {
    const score = 58 + (stableNumber(employee.id!) % 41);
    const grade = rawGrade(score);
    archives.unshift({
      id: context.own(
        "archive",
        context.id("archive", `2025-LEGACY:${employee.id}`),
      ),
      employeeId: employee.id!,
      cycleId: legacyCycleId,
      employeeName: employee.name,
      deptName:
        departmentNameById.get(topDepartment(employee.deptId) ?? "") ?? null,
      grade,
      totalScore: new Prisma.Decimal(score),
      coefficient: new Prisma.Decimal(DEMO_CONFIG.gradeCoefficient[grade]),
      summary: {
        source: DEMO_CONFIG.source,
        legacySequence: index + 1,
        note: "旧制历史绩效档案，仅用于连续趋势查询。",
      },
      archivedAt: utcDate("2026-01-10"),
    });
  }

  const objectiveRows = createObjectives(
    context,
    people,
    catalog,
    cycleIdByKey,
    annualLeaders,
    currentUsers,
  );
  Object.assign(context.manifest.expectedCounts, {
    cycles: cycles.length,
    tasks: tasks.length,
    q1Tasks: tasks.filter(
      (task) => task.cycleId === cycleIdByKey.get("2026-Q1"),
    ).length,
    q2Tasks: tasks.filter(
      (task) => task.cycleId === cycleIdByKey.get("2026-Q2"),
    ).length,
    q3Tasks: tasks.filter(
      (task) => task.cycleId === cycleIdByKey.get("2026-Q3"),
    ).length,
    annualLeaderTasks: annualLeaders.length,
    objectives: objectiveRows.objectives.length,
    actionItems: objectiveRows.actionItems.length,
  });

  return {
    cycles,
    snapshots,
    tasks,
    indicatorInstances,
    selfEvaluations,
    managerEvaluations,
    gradeResults,
    flowRecords,
    archives,
    objectives: objectiveRows.objectives,
    actionItems: objectiveRows.actionItems,
    storyUserIds: { ...people.storyUserIds },
    employeeNoByUserId,
  };
}
