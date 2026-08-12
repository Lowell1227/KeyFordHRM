import { Prisma } from "@prisma/client";
import { DEMO_CONFIG } from "./config";
import type { DemoContext } from "./context";
import {
  generateImprovementNarrative,
  generateInterviewNarrative,
} from "./narratives";
import type { PeopleBundle, PerformanceBundle, WorkflowBundle } from "./types";

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(value: string | Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

const OBSERVATION_EVENT_CUTOFF = utcDate("2026-08-10");

function observedEventDate(value: Date): Date {
  return new Date(
    Math.min(value.getTime(), OBSERVATION_EVENT_CUTOFF.getTime()),
  );
}

function cycle(
  performance: PerformanceBundle,
  name: string,
): Prisma.AssessmentCycleCreateManyInput {
  const row = performance.cycles.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`missing cycle ${name}`);
  return row;
}

function userByEmployeeNo(people: PeopleBundle, employeeNo: string) {
  const user = people.users.find(
    (candidate) => candidate.employeeNo === employeeNo,
  );
  if (!user?.id) throw new Error(`missing employee ${employeeNo}`);
  return user;
}

function orderedTasks(
  performance: PerformanceBundle,
  cycleId: string,
): Prisma.AssessmentTaskCreateManyInput[] {
  return performance.tasks
    .filter((task) => task.cycleId === cycleId && !task.isExempt)
    .sort((left, right) =>
      (performance.employeeNoByUserId.get(left.employeeId) ?? "").localeCompare(
        performance.employeeNoByUserId.get(right.employeeId) ?? "",
      ),
    );
}

function taskIndicators(performance: PerformanceBundle, taskId: string) {
  return performance.indicatorInstances.filter((row) => row.taskId === taskId);
}

function createSignature(
  context: DemoContext,
  businessType: "interview" | "probation_task",
  businessRecordId: string,
  role: "assessor" | "assessee" | "hr",
  signerId: string,
  signedAt: Date,
): Prisma.SignatureCreateManyInput {
  const key = `${businessType}:${businessRecordId}:${role}`;
  return {
    id: context.own("signature", context.id("signature", key)),
    businessType,
    businessRecordId,
    role,
    signerId,
    signedAt,
    method: "online_confirm",
    idempotencyKey: context.id("signature", key).replaceAll("-", ""),
    imageUrl: null,
    createdAt: signedAt,
  };
}

function generateInterviews(
  context: DemoContext,
  performance: PerformanceBundle,
): {
  q1: Prisma.PerformanceInterviewCreateManyInput[];
  q2: Prisma.PerformanceInterviewCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
} {
  const signatures: Prisma.SignatureCreateManyInput[] = [];
  const build = (
    cycleName: "2026-Q1" | "2026-Q2",
    closedCount: number,
    filledCount: number,
  ) => {
    const currentCycle = cycle(performance, cycleName);
    const tasks = orderedTasks(performance, currentCycle.id!);
    return tasks.map((task, index) => {
      if (!task.managerId)
        throw new Error(`${cycleName}/${task.id}/interview manager missing`);
      const id = context.own(
        "interview",
        context.id("interview", `${cycleName}:${task.id}`),
      );
      const isClosed = index < closedCount;
      const isFilled = !isClosed && index < closedCount + filledCount;
      const status = isClosed ? "closed" : isFilled ? "filled" : "pending";
      const narrative = generateInterviewNarrative(
        taskIndicators(performance, task.id!),
      );
      const publishedAt = task.publishedAt as Date;
      const interviewTime =
        isClosed || isFilled ? addDays(publishedAt, 2 + (index % 4)) : null;
      const managerSignedAt =
        isClosed || (isFilled && index - closedCount < 9)
          ? addDays(interviewTime!, 1)
          : null;
      const employeeSignedAt = isClosed ? addDays(managerSignedAt!, 1) : null;
      if (managerSignedAt) {
        signatures.push(
          createSignature(
            context,
            "interview",
            id,
            "assessor",
            task.managerId,
            managerSignedAt,
          ),
        );
      }
      if (employeeSignedAt) {
        signatures.push(
          createSignature(
            context,
            "interview",
            id,
            "assessee",
            task.employeeId,
            employeeSignedAt,
          ),
        );
      }
      const updatedAt =
        employeeSignedAt ?? managerSignedAt ?? interviewTime ?? publishedAt;
      return {
        id,
        taskId: task.id!,
        cycleId: task.cycleId,
        employeeId: task.employeeId,
        interviewerId: task.managerId,
        status,
        interviewTime,
        location: isClosed || isFilled ? "会议室（演示）" : null,
        method: isClosed || isFilled ? "one_on_one" : null,
        scoreInformed: isClosed || isFilled,
        ...(isClosed || isFilled ? narrative : {}),
        managerSignedAt,
        employeeSignedAt,
        deadline: addDays(task.approvedAt as Date, 20),
        createdAt: publishedAt,
        updatedAt,
      } satisfies Prisma.PerformanceInterviewCreateManyInput;
    });
  };

  return {
    q1: build("2026-Q1", 118, 0),
    q2: build("2026-Q2", 107, 13),
    signatures,
  };
}

interface AppealDefinition {
  task: Prisma.AssessmentTaskCreateManyInput;
  status: "resolved" | "dept_processing" | "hr_processing";
  result: "maintained" | "modified" | null;
  createdAt: Date;
  deptResolvedAt: Date | null;
  hrResolvedAt: Date | null;
  previousGrade?: "A" | "B" | "C" | "D";
}

function appendAppealFlow(
  context: DemoContext,
  performance: PerformanceBundle,
  appealId: string,
  task: Prisma.AssessmentTaskCreateManyInput,
  actorId: string,
  action: "submit" | "approve",
  createdAt: Date,
  phase: string,
): void {
  performance.flowRecords.push({
    id: context.own("flow", context.id("flow", `${appealId}:${phase}`)),
    taskId: task.id!,
    cycleId: task.cycleId,
    nodeType: "appeal",
    actorId,
    action,
    comment:
      phase === "submit"
        ? "员工在申诉期内提交复核申请。"
        : phase === "department"
          ? "部门已核验业务事实与评分证据。"
          : "HR 已复核评分口径并记录处理意见。",
    extraData: { source: DEMO_CONFIG.source, appealId, phase },
    createdAt,
  });
}

function gradeForTask(performance: PerformanceBundle, taskId: string) {
  const grade = performance.gradeResults.find((row) => row.taskId === taskId);
  if (!grade) throw new Error(`missing grade for ${taskId}`);
  return grade;
}

function findStoryTask(
  performance: PerformanceBundle,
  story: string,
  cycleId: string,
) {
  const employeeId = performance.storyUserIds[story];
  const task = performance.tasks.find(
    (row) => row.cycleId === cycleId && row.employeeId === employeeId,
  );
  if (!task) throw new Error(`missing ${story} task`);
  return task;
}

function generateAppeals(
  context: DemoContext,
  people: PeopleBundle,
  performance: PerformanceBundle,
): {
  q1: Prisma.AppealCreateManyInput[];
  q2: Prisma.AppealCreateManyInput[];
  audits: Prisma.AuditLogCreateManyInput[];
} {
  const q1Cycle = cycle(performance, "2026-Q1");
  const q2Cycle = cycle(performance, "2026-Q2");
  const hrId = userByEmployeeNo(
    people,
    DEMO_CONFIG.acceptanceEmployeeNos.hr,
  ).id!;
  const q1Tasks = orderedTasks(performance, q1Cycle.id!);
  const q1Modified = q1Tasks.find((task) => {
    const grade = gradeForTask(performance, task.id!);
    return grade.calibratedGrade === "B";
  });
  if (!q1Modified)
    throw new Error("2026-Q1 requires a final-B appeal candidate");
  const q1Maintained = findStoryTask(
    performance,
    "appealMaintained",
    q1Cycle.id!,
  );
  const q1Other = q1Tasks.find(
    (task) => task.id !== q1Modified.id && task.id !== q1Maintained.id,
  )!;
  const q2Modified = findStoryTask(performance, "appealModified", q2Cycle.id!);
  const q2Maintained = findStoryTask(
    performance,
    "appealMaintained",
    q2Cycle.id!,
  );
  const active = q2TasksWithStatus(performance, "appealing");
  if (active.length !== 2)
    throw new Error(
      `2026-Q2 expected 2 appealing tasks, received ${active.length}`,
    );

  const q1Definitions: AppealDefinition[] = [
    {
      task: q1Maintained,
      status: "resolved",
      result: "maintained",
      createdAt: utcDate("2026-04-18"),
      deptResolvedAt: utcDate("2026-04-20"),
      hrResolvedAt: utcDate("2026-04-23"),
    },
    {
      task: q1Other,
      status: "resolved",
      result: "maintained",
      createdAt: utcDate("2026-04-19"),
      deptResolvedAt: utcDate("2026-04-21"),
      hrResolvedAt: utcDate("2026-04-24"),
    },
    {
      task: q1Modified,
      status: "resolved",
      result: "modified",
      createdAt: utcDate("2026-04-20"),
      deptResolvedAt: utcDate("2026-04-22"),
      hrResolvedAt: utcDate("2026-04-25"),
      previousGrade: "C",
    },
  ];
  const q2Definitions: AppealDefinition[] = [
    {
      task: q2Maintained,
      status: "resolved",
      result: "maintained",
      createdAt: utcDate("2026-07-20"),
      deptResolvedAt: utcDate("2026-07-22"),
      hrResolvedAt: utcDate("2026-07-25"),
    },
    {
      task: q2Modified,
      status: "resolved",
      result: "modified",
      createdAt: utcDate("2026-07-21"),
      deptResolvedAt: utcDate("2026-07-23"),
      hrResolvedAt: utcDate("2026-07-26"),
      previousGrade: "C",
    },
    {
      task: active[0],
      status: "dept_processing",
      result: null,
      createdAt: utcDate("2026-07-29"),
      deptResolvedAt: null,
      hrResolvedAt: null,
    },
    {
      task: active[1],
      status: "hr_processing",
      result: null,
      createdAt: utcDate("2026-07-25"),
      deptResolvedAt: utcDate("2026-07-28"),
      hrResolvedAt: null,
    },
  ];
  const audits: Prisma.AuditLogCreateManyInput[] = [];

  const build = (
    currentCycle: Prisma.AssessmentCycleCreateManyInput,
    definitions: AppealDefinition[],
  ) =>
    definitions.map((definition, index) => {
      const task = definition.task;
      const id = context.own(
        "appeal",
        context.id("appeal", `${currentCycle.name}:${task.id}:${index}`),
      );
      const deptResolverId = task.deptHeadId ?? task.approverId ?? hrId;
      const finalGrade = gradeForTask(performance, task.id!).calibratedGrade!;
      const updatedAt =
        definition.hrResolvedAt ??
        definition.deptResolvedAt ??
        addDays(definition.createdAt, 1);
      const row: Prisma.AppealCreateManyInput = {
        id,
        taskId: task.id!,
        cycleId: task.cycleId,
        appellantId: task.employeeId,
        reason:
          definition.status !== "resolved"
            ? `本记录为历史迁移中间状态；${
                definition.status === "dept_processing"
                  ? "部门正在复核业务事实与评分证据。"
                  : "部门复核已完成，HR 正在复核评分口径。"
              }`
            : definition.result === "modified"
              ? "业务数据归集口径存在偏差，申请按原始凭证复核。"
              : "对部分评分依据存在疑问，申请复核证据与评价标准。",
        attachments: [],
        status: definition.status,
        deptResolution: definition.deptResolvedAt
          ? "部门已核对原始交付证据和岗位评分标准。"
          : null,
        deptResolvedAt: definition.deptResolvedAt,
        deptResolverId: definition.deptResolvedAt ? deptResolverId : null,
        hrResolution: definition.hrResolvedAt
          ? definition.result === "modified"
            ? definition.previousGrade === finalGrade
              ? `复核后修订评分说明，最终等级保持${finalGrade}。`
              : `复核后确认原等级${definition.previousGrade}需调整为${finalGrade}。`
            : `证据完整，维持最终等级${finalGrade}。`
          : null,
        hrResolvedAt: definition.hrResolvedAt,
        hrResolverId: definition.hrResolvedAt ? hrId : null,
        finalResult: definition.result,
        appealDeadline: currentCycle.deadlineAppeal,
        createdAt: definition.createdAt,
        updatedAt,
      };

      appendAppealFlow(
        context,
        performance,
        id,
        task,
        task.employeeId,
        "submit",
        definition.createdAt,
        "submit",
      );
      if (definition.deptResolvedAt) {
        appendAppealFlow(
          context,
          performance,
          id,
          task,
          deptResolverId,
          "approve",
          definition.deptResolvedAt,
          "department",
        );
      }
      if (definition.hrResolvedAt) {
        appendAppealFlow(
          context,
          performance,
          id,
          task,
          hrId,
          "approve",
          definition.hrResolvedAt,
          "hr",
        );
      }

      if (definition.status === "resolved") {
        task.status = currentCycle.name === "2026-Q1" ? "closed" : "confirmed";
        task.updatedAt = updatedAt;
      } else {
        task.status = "appealing";
        task.updatedAt = updatedAt;
      }

      const grade = gradeForTask(performance, task.id!);
      const archive = performance.archives.find(
        (candidate) =>
          candidate.employeeId === task.employeeId &&
          candidate.cycleId === task.cycleId,
      );
      if (!archive)
        throw new Error(`missing archive for appeal task ${task.id}`);
      if (definition.result === "modified") {
        grade.calibratedGrade = finalGrade;
        grade.coefficient = new Prisma.Decimal(
          DEMO_CONFIG.gradeCoefficient[finalGrade],
        );
        grade.calibrationNote =
          definition.previousGrade === finalGrade
            ? `申诉复核：已修订评分证据说明，最终等级保持${finalGrade}。`
            : `申诉复核：由${definition.previousGrade}调整为${finalGrade}，已核验业务数据口径。`;
        grade.updatedAt = updatedAt;
        archive.grade = finalGrade;
        archive.coefficient = new Prisma.Decimal(
          DEMO_CONFIG.gradeCoefficient[finalGrade],
        );
        const existingSummary =
          archive.summary &&
          typeof archive.summary === "object" &&
          !Array.isArray(archive.summary)
            ? (archive.summary as Record<string, Prisma.InputJsonValue>)
            : {};
        archive.summary = {
          ...existingSummary,
          appealId: id,
          appealResult: "modified",
          appealPreviousGrade: definition.previousGrade!,
          calibratedGrade: finalGrade,
        };
        archive.archivedAt = updatedAt;
      }

      audits.push({
        id: context.own("audit-log", context.id("audit-log", `appeal:${id}`)),
        userId: hrId,
        action:
          definition.status === "resolved" ? "resolve_appeal" : "create_appeal",
        entityType: "appeal",
        entityId: id,
        ...(definition.result === "modified"
          ? {
              oldValue: {
                calibratedGrade: definition.previousGrade!,
                coefficient:
                  DEMO_CONFIG.gradeCoefficient[definition.previousGrade!],
              },
            }
          : {}),
        newValue: {
          source: DEMO_CONFIG.source,
          actor: "realistic-demo-seed",
          appellantId: task.employeeId,
          status: definition.status,
          result: definition.result,
          calibratedGrade: finalGrade,
          ...(definition.status === "resolved"
            ? {}
            : { stateOrigin: "historical_migration" }),
        },
        ipAddress: "127.0.0.1",
        userAgent: "realistic-demo-seed",
        createdAt: updatedAt,
      });
      return row;
    });

  return {
    q1: build(q1Cycle, q1Definitions),
    q2: build(q2Cycle, q2Definitions),
    audits,
  };
}

function q2TasksWithStatus(
  performance: PerformanceBundle,
  status: Prisma.AssessmentTaskCreateManyInput["status"],
) {
  const q2Cycle = cycle(performance, "2026-Q2");
  return performance.tasks
    .filter((task) => task.cycleId === q2Cycle.id && task.status === status)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function generateImprovementPlans(
  context: DemoContext,
  performance: PerformanceBundle,
): {
  q1: Prisma.ImprovementPlanCreateManyInput[];
  q2: Prisma.ImprovementPlanCreateManyInput[];
} {
  const build = (
    cycleName: "2026-Q1" | "2026-Q2",
    completedCount: number,
    draftCount: number,
  ) => {
    const cycleId = cycle(performance, cycleName).id!;
    const taskIds = new Set(
      performance.gradeResults
        .filter((grade) => grade.calibratedGrade === "D")
        .map((grade) => grade.taskId),
    );
    const tasks = orderedTasks(performance, cycleId).filter((task) =>
      taskIds.has(task.id!),
    );
    return tasks.map((task, index) => {
      const isCompleted = index < completedCount;
      const isDraft = index >= tasks.length - draftCount;
      const status = isCompleted
        ? "completed"
        : isDraft
          ? "draft"
          : "in_progress";
      const createdAt =
        cycleName === "2026-Q1" ? utcDate("2026-04-16") : utcDate("2026-07-16");
      const targetDate =
        status === "draft"
          ? null
          : cycleName === "2026-Q1"
            ? utcDate("2026-06-30")
            : utcDate("2026-10-15");
      const narrative = targetDate
        ? generateImprovementNarrative(
            taskIndicators(performance, task.id!),
            targetDate,
          )
        : null;
      return {
        id: context.own(
          "improvement-plan",
          context.id("improvement-plan", `${cycleName}:${task.id}`),
        ),
        employeeId: task.employeeId,
        cycleId: task.cycleId,
        taskId: task.id!,
        creatorId: isDraft ? null : task.managerId,
        improvementNeed: narrative?.improvementNeed ?? null,
        importance: narrative?.importance ?? null,
        improvementGoal: narrative?.improvementGoal ?? null,
        targetDate,
        measures: narrative?.measures ?? [],
        finalScore: isCompleted ? 6 + (index % 5) : null,
        status,
        createdAt,
        updatedAt: isCompleted ? utcDate("2026-06-30") : createdAt,
      } satisfies Prisma.ImprovementPlanCreateManyInput;
    });
  };
  return { q1: build("2026-Q1", 7, 0), q2: build("2026-Q2", 0, 2) };
}

function generateProbation(
  context: DemoContext,
  people: PeopleBundle,
): {
  reviews: Prisma.ProbationReviewCreateManyInput[];
  indicators: Prisma.ProbationReviewIndicatorCreateManyInput[];
  confirmations: Prisma.ConfirmationApplicationCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
  audits: Prisma.AuditLogCreateManyInput[];
} {
  const hrId = userByEmployeeNo(
    people,
    DEMO_CONFIG.acceptanceEmployeeNos.hr,
  ).id!;
  const companyApproverId = userByEmployeeNo(
    people,
    DEMO_CONFIG.acceptanceEmployeeNos.vp,
  ).id!;
  const fallbackManagerId = userByEmployeeNo(
    people,
    DEMO_CONFIG.acceptanceEmployeeNos.manager,
  ).id!;
  const currentProbation = people.users
    .filter((user) => user.status === "probation")
    .sort(
      (left, right) =>
        new Date(left.entryDate!).getTime() -
        new Date(right.entryDate!).getTime(),
    );
  if (currentProbation.length !== 7)
    throw new Error(
      `expected 7 current probation users, received ${currentProbation.length}`,
    );
  const historicalPass = people.users
    .filter(
      (user) =>
        user.status === "active" &&
        user.sysRole === "employee" &&
        user.entryDate! < utcDate("2026-01-01"),
    )
    .slice(12, 15);
  const historicalFail = people.users.find(
    (user) => user.status === "resigned",
  );
  if (historicalPass.length !== 3 || !historicalFail)
    throw new Error("historical probation personas missing");

  const definitions = [
    ...currentProbation.map((employee, index) => ({
      employee,
      status:
        index < 3
          ? ("closed" as const)
          : index === 3
            ? ("manager_scoring" as const)
            : index === 4
              ? ("self_eval" as const)
              : ("indicator_setting" as const),
      voteResult: index < 3 ? ("extend" as const) : null,
      createdAt: observedEventDate(addDays(employee.entryDate!, 7)),
      plannedRegularDate: addDays(employee.entryDate!, 90),
      completedAt: index < 3 ? addDays(employee.entryDate!, 86) : null,
    })),
    ...historicalPass.map((employee) => ({
      employee,
      status: "closed" as const,
      voteResult: "pass" as const,
      createdAt: addDays(employee.entryDate!, 7),
      plannedRegularDate: addDays(employee.entryDate!, 90),
      completedAt: addDays(employee.entryDate!, 83),
    })),
    {
      employee: historicalFail,
      status: "closed" as const,
      voteResult: "fail" as const,
      createdAt: utcDate("2025-01-10"),
      plannedRegularDate: utcDate("2025-04-01"),
      completedAt: utcDate("2025-03-20"),
    },
  ];
  const reviews: Prisma.ProbationReviewCreateManyInput[] = [];
  const indicators: Prisma.ProbationReviewIndicatorCreateManyInput[] = [];
  const confirmations: Prisma.ConfirmationApplicationCreateManyInput[] = [];
  const signatures: Prisma.SignatureCreateManyInput[] = [];
  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const indicatorDefinitions = [
    {
      name: "岗位重点工作完成度",
      type: "work_objective" as const,
      weight: 0.3,
    },
    { name: "交付质量与及时性", type: "work_objective" as const, weight: 0.25 },
    { name: "问题分析与闭环", type: "work_objective" as const, weight: 0.25 },
    { name: "价值观与团队协作", type: "values" as const, weight: 0.2 },
  ];

  definitions.forEach((definition, reviewIndex) => {
    const employeeId = definition.employee.id!;
    const managerId =
      people.managerByUserId.get(employeeId) ??
      definition.employee.directManagerId ??
      fallbackManagerId;
    const id = context.own(
      "probation-review",
      context.id("probation-review", employeeId),
    );
    const isClosed = definition.status === "closed";
    const hasSelfScores = isClosed || definition.status === "manager_scoring";
    const hasManagerScores = isClosed;
    const employeeSignedAt = definition.completedAt
      ? addDays(definition.completedAt, -2)
      : null;
    const managerSignedAt = definition.completedAt
      ? addDays(definition.completedAt, -1)
      : null;
    const hrSignedAt = definition.completedAt;
    reviews.push({
      id,
      employeeId,
      managerId,
      hrId,
      status: definition.status,
      plannedRegularDate: definition.plannedRegularDate,
      strengths: hasManagerScores
        ? "工作态度稳定，能够按要求完成阶段任务。"
        : null,
      improvements: hasManagerScores
        ? "需继续提升计划前置和跨团队沟通效率。"
        : null,
      employeeSignedAt,
      managerSignedAt,
      hrSignedAt,
      completedAt: definition.completedAt,
      createdBy: hrId,
      createdAt: definition.createdAt,
      updatedAt:
        definition.completedAt ??
        observedEventDate(addDays(definition.createdAt, reviewIndex % 4)),
    });
    indicatorDefinitions.forEach((indicator, indicatorIndex) => {
      indicators.push({
        id: context.own(
          "probation-indicator",
          context.id("probation-indicator", `${id}:${indicatorIndex}`),
        ),
        probationReviewId: id,
        name: indicator.name,
        type: indicator.type,
        weight: new Prisma.Decimal(indicator.weight),
        description: "依据试用期岗位要求和可核验交付进行评价。",
        targetValue: "达到岗位试用期合格标准",
        selfScore: hasSelfScores
          ? new Prisma.Decimal(78 + indicatorIndex * 3)
          : null,
        selfComment: hasSelfScores ? "已提交对应成果及过程记录。" : null,
        managerScore: hasManagerScores
          ? new Prisma.Decimal(76 + indicatorIndex * 3)
          : null,
        managerComment: hasManagerScores
          ? "评分依据与阶段交付证据一致。"
          : null,
        sortOrder: indicatorIndex,
        createdAt: definition.createdAt,
        updatedAt:
          definition.completedAt ?? observedEventDate(definition.createdAt),
      });
    });
    if (isClosed) {
      signatures.push(
        createSignature(
          context,
          "probation_task",
          id,
          "assessee",
          employeeId,
          employeeSignedAt!,
        ),
        createSignature(
          context,
          "probation_task",
          id,
          "assessor",
          managerId,
          managerSignedAt!,
        ),
        createSignature(context, "probation_task", id, "hr", hrId, hrSignedAt!),
      );
    }
    definition.employee.plannedRegularDate = definition.plannedRegularDate;

    if (!definition.voteResult) return;
    const confirmationId = context.own(
      "confirmation",
      context.id("confirmation", employeeId),
    );
    const isPass = definition.voteResult === "pass";
    const decisionAt = addDays(definition.completedAt!, 3);
    const status = isPass ? "approved" : "rejected";
    const actualRegularDate = isPass ? decisionAt : null;
    if (isPass) definition.employee.actualRegularDate = actualRegularDate;
    if (definition.voteResult === "extend") {
      definition.employee.plannedRegularDate = addDays(
        definition.plannedRegularDate,
        60,
      );
    }
    confirmations.push({
      id: confirmationId,
      employeeId,
      probationReviewId: id,
      managerId,
      hrId,
      companyApproverId,
      status,
      summary: "结合试用期目标、阶段交付和三方评价提交转正确认。",
      salary: null,
      voteResult: definition.voteResult,
      voteParticipants: [managerId, hrId, companyApproverId],
      voteComment:
        definition.voteResult === "pass"
          ? "达到岗位要求，同意转正。"
          : definition.voteResult === "extend"
            ? "部分能力仍需观察，延长试用考察期。"
            : "未达到岗位试用要求，不予转正。",
      voteMeetingTime: definition.completedAt,
      managerComment: "已核对试用期工作成果。",
      managerApprovedAt: addDays(definition.completedAt!, 1),
      hrComment: "已核对考核记录与签字。",
      hrApprovedAt: addDays(definition.completedAt!, 2),
      companyComment: isPass ? "同意转正。" : null,
      companyApprovedAt: isPass ? decisionAt : null,
      rejectedById: isPass ? null : companyApproverId,
      rejectedAt: isPass ? null : decisionAt,
      rejectReason:
        definition.voteResult === "extend"
          ? "延期考察：部分岗位能力需继续验证。"
          : definition.voteResult === "fail"
            ? "未达到试用期岗位要求。"
            : null,
      actualRegularDate,
      createdBy: hrId,
      createdAt: addDays(definition.completedAt!, -7),
      updatedAt: decisionAt,
    });
    audits.push({
      id: context.own(
        "audit-log",
        context.id("audit-log", `confirmation:${confirmationId}`),
      ),
      userId: companyApproverId,
      action: isPass ? "approve_confirmation" : "reject_confirmation",
      entityType: "confirmation_application",
      entityId: confirmationId,
      oldValue: { status: "hr_approved" },
      newValue: {
        source: DEMO_CONFIG.source,
        actor: "realistic-demo-seed",
        status,
        voteResult: definition.voteResult,
        actualRegularDate: actualRegularDate?.toISOString() ?? null,
      },
      ipAddress: "127.0.0.1",
      userAgent: "realistic-demo-seed",
      createdAt: decisionAt,
    });
  });

  return { reviews, indicators, confirmations, signatures, audits };
}

function generateNotifications(
  context: DemoContext,
  people: PeopleBundle,
  performance: PerformanceBundle,
): Prisma.NotificationLogCreateManyInput[] {
  const hrId = userByEmployeeNo(
    people,
    DEMO_CONFIG.acceptanceEmployeeNos.hr,
  ).id!;
  const q3Cycle = cycle(performance, "2026-Q3");
  const q3Tasks = performance.tasks.filter(
    (task) => task.cycleId === q3Cycle.id,
  );
  const acceptanceUsers = Object.values(DEMO_CONFIG.acceptanceEmployeeNos).map(
    (employeeNo) => userByEmployeeNo(people, employeeNo),
  );
  return acceptanceUsers.flatMap((user, userIndex) => {
    const ownTask = q3Tasks.find((task) => task.employeeId === user.id);
    const primaryTask = ownTask ?? q3Tasks[userIndex];
    const secondaryTask = primaryTask;
    const definitions = [
      {
        type: "task_reminder",
        title: "待处理：绩效任务",
        content: "请根据当前任务状态完成待办操作，并保存进展。",
        task: primaryTask,
        isRead: false,
        status: "sent",
        createdAt: utcDate("2026-08-10"),
      },
      {
        type: "task_evidence",
        title: "待处理：补充阶段证据",
        content: "请核对当前阶段成果，并补充进展说明或交付证据。",
        task: secondaryTask,
        isRead: false,
        status: "sent",
        createdAt: utcDate("2026-08-09"),
      },
      {
        type: "workflow",
        title: "流程节点已更新",
        content: "相关审批节点已完成，请查看详情。",
        task: primaryTask,
        isRead: true,
        status: "sent",
        createdAt: utcDate("2026-08-08"),
      },
      {
        type: "workflow",
        title: "申诉或面谈流程提醒",
        content: "流程记录已更新并保留处理意见。",
        task: secondaryTask,
        isRead: true,
        status: "sent",
        createdAt: utcDate("2026-08-07"),
      },
      {
        type: "info",
        title: "绩效制度提示",
        content: "请按页面展示的截止日完成对应工作。",
        task: null,
        isRead: true,
        status: "sent",
        createdAt: utcDate("2026-08-06"),
      },
      {
        type: "delivery_test",
        title: "消息投递记录",
        content: "该记录用于演示非阻断式消息失败。",
        task: null,
        isRead: false,
        status: "failed",
        createdAt: utcDate("2026-08-05"),
      },
    ] as const;
    return definitions.map((definition, index) => ({
      id: context.own(
        "notification",
        context.id("notification", `${user.id}:${index}`),
      ),
      userId: user.id!,
      senderId: hrId,
      taskId: definition.task?.id ?? null,
      cycleId: definition.task?.cycleId ?? q3Cycle.id!,
      type: definition.type,
      title: definition.title,
      content: definition.content,
      channel: "dingtalk",
      status: definition.status,
      isRead: definition.isRead,
      readAt: definition.isRead ? addDays(definition.createdAt, 1) : null,
      extraData: {
        source: DEMO_CONFIG.source,
        route: definition.task ? `/tasks/${definition.task.id}` : "/dashboard",
      },
      sentAt: definition.status === "sent" ? definition.createdAt : null,
      errorMsg:
        definition.status === "failed"
          ? "DingTalk delivery unavailable (demo)"
          : null,
      createdAt: definition.createdAt,
    }));
  });
}

export function generateWorkflows(
  context: DemoContext,
  people: PeopleBundle,
  performance: PerformanceBundle,
): WorkflowBundle {
  const interviews = generateInterviews(context, performance);
  const appeals = generateAppeals(context, people, performance);
  const improvementPlans = generateImprovementPlans(context, performance);
  const probation = generateProbation(context, people);
  const notifications = generateNotifications(context, people, performance);
  const result: WorkflowBundle = {
    interviews: [...interviews.q1, ...interviews.q2],
    q1Interviews: interviews.q1,
    q2Interviews: interviews.q2,
    appeals: [...appeals.q1, ...appeals.q2],
    q1Appeals: appeals.q1,
    q2Appeals: appeals.q2,
    improvementPlans: [...improvementPlans.q1, ...improvementPlans.q2],
    q1ImprovementPlans: improvementPlans.q1,
    q2ImprovementPlans: improvementPlans.q2,
    probationReviews: probation.reviews,
    probationIndicators: probation.indicators,
    confirmations: probation.confirmations,
    signatures: [...interviews.signatures, ...probation.signatures],
    notifications,
    auditLogs: [...appeals.audits, ...probation.audits],
  };
  Object.assign(context.manifest.expectedCounts, {
    interviews: result.interviews.length,
    appeals: result.appeals.length,
    improvementPlans: result.improvementPlans.length,
    probationReviews: result.probationReviews.length,
    confirmations: result.confirmations.length,
    notifications: result.notifications.length,
    auditLogs: result.auditLogs.length,
  });
  return result;
}
