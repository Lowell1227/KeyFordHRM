import { PrismaClient } from "@prisma/client";
import { buildGoalTrackingDemoPlan, type GoalTrackingDemoPlan } from "./plan";

type Environment = Record<string, string | undefined>;

interface ExistingRows {
  tasks: Array<{ id: string; cycleId: string; employeeId: string }>;
  indicators: Array<{ id: string; taskId: string }>;
}

export function requireGoalTrackingDemoWriteGate(env: Environment): void {
  if (env.ENABLE_GOAL_TRACKING_DEMO_SEED !== "true") {
    throw new Error(
      "goal tracking demo write disabled; set ENABLE_GOAL_TRACKING_DEMO_SEED=true",
    );
  }
}

export function assertGoalTrackingDemoOwnership(
  plan: GoalTrackingDemoPlan,
  existing: ExistingRows,
): void {
  const plannedTaskByEmployee = new Map(
    plan.tasks.map((task) => [task.create.employeeId, task]),
  );
  const plannedTaskById = new Map(
    plan.tasks.map((task) => [task.create.id, task]),
  );
  const plannedIndicators = new Map(
    plan.tasks.flatMap((task) =>
      task.indicators.map(
        (indicator) => [indicator.create.id, indicator] as const,
      ),
    ),
  );

  for (const row of existing.tasks) {
    const target = plannedTaskByEmployee.get(row.employeeId);
    if (
      target &&
      row.cycleId === target.create.cycleId &&
      row.id !== target.create.id
    ) {
      throw new Error(
        `${target.employeeNo} already has non-owned formal-cycle task ${row.id}; refusing overwrite`,
      );
    }
    const idOwner = plannedTaskById.get(row.id);
    if (
      idOwner &&
      (row.employeeId !== idOwner.create.employeeId ||
        row.cycleId !== idOwner.create.cycleId)
    ) {
      throw new Error(
        `owned task ID ${row.id} is already used by another employee`,
      );
    }
  }

  for (const row of existing.indicators) {
    const planned = plannedIndicators.get(row.id);
    if (planned && row.taskId !== planned.create.taskId) {
      throw new Error(
        `owned indicator ID ${row.id} is already used by another task`,
      );
    }
  }
}

export async function loadGoalTrackingDemoPlan(prisma: PrismaClient) {
  const cycles = await prisma.assessmentCycle.findMany({
    where: { name: "2026-Q3" },
    select: { id: true, name: true },
  });
  if (cycles.length !== 1) {
    throw new Error(
      `expected exactly one 2026-Q3 cycle, received ${cycles.length}`,
    );
  }
  const cycle = cycles[0];

  const users = await prisma.user.findMany({
    where: {
      employeeNo: { in: ["MGR001", "EMP001"] },
      deletedAt: null,
    },
    select: {
      id: true,
      employeeNo: true,
      deptId: true,
      directManagerId: true,
    },
  });

  const sourceTasks = await prisma.assessmentTask.findMany({
    where: {
      cycleId: cycle.id,
      employee: { employeeNo: { in: ["FD300125", "FD300126"] } },
    },
    include: {
      employee: { select: { employeeNo: true } },
      indicatorInstances: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });

  return buildGoalTrackingDemoPlan({ cycle, users, sourceTasks });
}

export async function inspectGoalTrackingDemoOwnership(
  prisma: PrismaClient,
  plan: GoalTrackingDemoPlan,
) {
  const taskIds = plan.tasks.map((task) => task.create.id);
  const indicatorIds = plan.tasks.flatMap((task) =>
    task.indicators.map((indicator) => indicator.create.id),
  );
  const targetPairs = plan.tasks.map((task) => ({
    cycleId: task.create.cycleId,
    employeeId: task.create.employeeId,
  }));

  const [tasks, indicators] = await Promise.all([
    prisma.assessmentTask.findMany({
      where: { OR: [...targetPairs, { id: { in: taskIds } }] },
      select: { id: true, cycleId: true, employeeId: true },
    }),
    prisma.indicatorInstance.findMany({
      where: { id: { in: indicatorIds } },
      select: { id: true, taskId: true },
    }),
  ]);
  const existing = { tasks, indicators };
  assertGoalTrackingDemoOwnership(plan, existing);
  return existing;
}

export async function persistGoalTrackingDemo(
  prisma: PrismaClient,
  plan: GoalTrackingDemoPlan,
) {
  await inspectGoalTrackingDemoOwnership(prisma, plan);

  await prisma.$transaction(async (tx) => {
    for (const task of plan.tasks) {
      const { id: taskId, ...taskData } = task.create;
      await tx.assessmentTask.upsert({
        where: { id: taskId },
        create: task.create,
        update: taskData,
      });

      for (const indicator of task.indicators) {
        const { id: indicatorId, ...indicatorData } = indicator.create;
        await tx.indicatorInstance.upsert({
          where: { id: indicatorId },
          create: indicator.create,
          update: indicatorData,
        });
      }
    }
  });

  return summarizeGoalTrackingDemo(plan);
}

export async function verifyGoalTrackingDemo(
  prisma: PrismaClient,
  plan: GoalTrackingDemoPlan,
) {
  await inspectGoalTrackingDemoOwnership(prisma, plan);
  const taskIds = plan.tasks.map((task) => task.create.id);
  const rows = await prisma.assessmentTask.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      employee: { select: { employeeNo: true } },
      indicatorInstances: {
        select: { id: true, name: true, visibilityScope: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });
  if (rows.length !== plan.tasks.length) {
    throw new Error(
      `goal tracking demo verification expected ${plan.tasks.length} tasks, received ${rows.length}`,
    );
  }

  for (const task of plan.tasks) {
    const actual = rows.find(
      (row) =>
        row.id === task.create.id &&
        row.employee.employeeNo === task.employeeNo,
    );
    const expected = task.indicators.map((indicator) => ({
      id: indicator.create.id,
      name: indicator.create.name,
      visibilityScope: indicator.create.visibilityScope,
    }));
    if (
      !actual ||
      JSON.stringify(actual.indicatorInstances) !== JSON.stringify(expected)
    ) {
      throw new Error(
        `${task.employeeNo} goal tracking indicators failed verification`,
      );
    }
  }

  return summarizeGoalTrackingDemo(plan);
}

export function summarizeGoalTrackingDemo(plan: GoalTrackingDemoPlan) {
  return {
    cycle: plan.cycleName,
    tasks: plan.tasks.length,
    indicators: plan.tasks.reduce(
      (total, task) => total + task.indicators.length,
      0,
    ),
    accounts: plan.tasks.map((task) => ({
      employeeNo: task.employeeNo,
      sourceEmployeeNo: task.sourceEmployeeNo,
      indicatorNames: task.indicators.map((indicator) => indicator.create.name),
    })),
  };
}
