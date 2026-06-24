/**
 * 为当前演示周期补齐约 85% 人员绩效评分。
 *
 * 目的：保留真实花名册、部门、任务关系，只补足评分数据，让首页/报表看板
 * 呈现一般公司更常见的绩效分布，而不是只有极少数人有成绩。
 *
 * 运行：
 *   npx ts-node prisma/seed-hrz-score-85.ts
 * 可选：
 *   $env:CYCLE_NAME='2026年二季度绩效考核 ...'; npx ts-node prisma/seed-hrz-score-85.ts
 */
import { PrismaClient, Prisma, PerfGrade, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

const TARGET_RATIO = 0.85;
const GRADE_RATIO: Record<PerfGrade, number> = {
  A: 0.15,
  B: 0.6,
  C: 0.2,
  D: 0.05,
};

const SCORE_BAND: Record<PerfGrade, [number, number]> = {
  A: [90, 96],
  B: [78, 89],
  C: [62, 74],
  D: [48, 59],
};

function hashText(text: string): number {
  let hash = 0;
  for (const ch of text) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function deterministicScore(seed: string, grade: PerfGrade): number {
  const [min, max] = SCORE_BAND[grade];
  const hash = hashText(seed);
  const spread = max - min;
  const decimal = ((hash >> 4) % 4) * 0.25;
  return Math.min(max, min + (hash % (spread + 1)) + decimal);
}

function buildGradePool(count: number): PerfGrade[] {
  const a = Math.round(count * GRADE_RATIO.A);
  const d = Math.max(1, Math.round(count * GRADE_RATIO.D));
  const c = Math.round(count * GRADE_RATIO.C);
  const b = Math.max(0, count - a - c - d);
  return [
    ...Array(a).fill('A'),
    ...Array(b).fill('B'),
    ...Array(c).fill('C'),
    ...Array(d).fill('D'),
  ] as PerfGrade[];
}

function statusForRank(rank: number, total: number): TaskStatus {
  const ratio = total === 0 ? 0 : rank / total;
  if (ratio < 0.55) return 'published';
  if (ratio < 0.78) return 'approval';
  return 'hr_calibration';
}

async function pickCycle() {
  const cycleName = process.env.CYCLE_NAME?.trim();
  if (cycleName) {
    const cycle = await prisma.assessmentCycle.findFirst({ where: { name: cycleName } });
    if (!cycle) throw new Error(`找不到指定考核周期：${cycleName}`);
    return cycle;
  }

  const cycles = await prisma.assessmentCycle.findMany({
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });
  if (cycles.length === 0) throw new Error('没有找到考核周期');

  const withCounts = await Promise.all(
    cycles.map(async (cycle) => ({
      cycle,
      taskCount: await prisma.assessmentTask.count({ where: { cycleId: cycle.id, isExempt: false } }),
    })),
  );
  withCounts.sort((a, b) => b.taskCount - a.taskCount || b.cycle.updatedAt.getTime() - a.cycle.updatedAt.getTime());
  return withCounts[0].cycle;
}

async function main() {
  const cycle = await pickCycle();
  const tasks = await prisma.assessmentTask.findMany({
    where: { cycleId: cycle.id, isExempt: false },
    include: {
      employee: { select: { id: true, name: true, employeeNo: true, deptId: true } },
      indicatorInstances: { orderBy: { sortOrder: 'asc' } },
      gradeResult: true,
    },
    orderBy: [{ dept: { sortOrder: 'asc' } }, { employee: { employeeNo: 'asc' } }, { employee: { name: 'asc' } }],
  });

  if (tasks.length === 0) throw new Error(`周期「${cycle.name}」没有考核任务`);

  const targetCount = Math.min(tasks.length, Math.round(tasks.length * TARGET_RATIO));
  const gradePool = buildGradePool(targetCount);
  const scoredTasks = tasks.slice(0, targetCount);
  const unscoredTasks = tasks.slice(targetCount);
  const now = new Date();

  const gradeTally: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  let totalScore = 0;

  for (let i = 0; i < scoredTasks.length; i++) {
    const task = scoredTasks[i];
    const grade = gradePool[i % gradePool.length];
    const score = deterministicScore(`${task.employee.employeeNo ?? task.employee.name}-${task.id}`, grade);
    const status = statusForRank(i, scoredTasks.length);
    gradeTally[grade] += 1;
    totalScore += score;

    await prisma.$transaction(async (tx) => {
      await tx.indicatorInstance.updateMany({
        where: { taskId: task.id },
        data: {
          managerScore: D(score),
          finalScore: D(score),
          managerComment: '主管评语：结合岗位目标、交付质量和协作表现综合评分。',
          updatedAt: now,
        },
      });

      await tx.gradeResult.upsert({
        where: { taskId: task.id },
        create: {
          taskId: task.id,
          calculatedScore: D(score),
          rawGrade: grade,
          calibratedGrade: grade,
          calibrationNote: '演示数据：按一般公司绩效分布补齐。',
          coefficient: D(1),
          hrCalibratedAt: now,
        },
        update: {
          calculatedScore: D(score),
          rawGrade: grade,
          calibratedGrade: grade,
          calibrationNote: '演示数据：按一般公司绩效分布补齐。',
          coefficient: D(1),
          hrCalibratedAt: now,
          updatedAt: now,
        },
      });

      await tx.assessmentTask.update({
        where: { id: task.id },
        data: {
          status,
          managerScoredAt: task.managerScoredAt ?? now,
          hrCalibratedAt: task.hrCalibratedAt ?? now,
          updatedAt: now,
        },
      });
    });
  }

  for (const task of unscoredTasks) {
    await prisma.$transaction(async (tx) => {
      await tx.gradeResult.deleteMany({ where: { taskId: task.id } });
      await tx.indicatorInstance.updateMany({
        where: { taskId: task.id },
        data: {
          managerScore: null,
          finalScore: null,
          managerComment: null,
          updatedAt: now,
        },
      });
    });
  }

  const average = scoredTasks.length === 0 ? 0 : totalScore / scoredTasks.length;
  console.log(`考核周期：${cycle.name}`);
  console.log(`任务总数：${tasks.length}`);
  console.log(`已补评分：${scoredTasks.length}（${((scoredTasks.length / tasks.length) * 100).toFixed(1)}%）`);
  console.log(`未评分保留：${unscoredTasks.length}`);
  console.log(`等级分布：A=${gradeTally.A}, B=${gradeTally.B}, C=${gradeTally.C}, D=${gradeTally.D}`);
  console.log(`已评分平均分：${average.toFixed(2)}`);
}

main()
  .catch((error) => {
    console.error('seed-hrz-score-85 失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
