import { PrismaClient } from '@prisma/client';
import { TEST_ACCOUNT_MANIFEST } from '../src/auth/test-accounts';
import { ACCEPTANCE_TASK_PLAN, TEST_ACCEPTANCE_CYCLE_NAME } from './demo-history/acceptance-plan';

const prisma = new PrismaClient();
const HISTORY_CYCLE_NAMES = [
  '测试·2025 Q3 绩效考核（历史）',
  '测试·2025 Q4 绩效考核（历史）',
  '测试·2026 Q1 绩效考核（历史）',
];

async function main() {
  const errors: string[] = [];
  const employeeNos = TEST_ACCOUNT_MANIFEST.map((account) => account.employeeNo);
  const accounts = await prisma.user.findMany({
    where: { employeeNo: { in: employeeNos } },
    include: { dept: { include: { parent: true } } },
  });

  if (accounts.length !== TEST_ACCOUNT_MANIFEST.length) {
    errors.push(`fixed account count expected=8 actual=${accounts.length}`);
  }
  for (const expected of TEST_ACCOUNT_MANIFEST) {
    const actual = accounts.find((account) => account.employeeNo === expected.employeeNo);
    if (!actual) {
      errors.push(`missing account ${expected.employeeNo}`);
      continue;
    }
    if (actual.name !== expected.name || actual.sysRole !== expected.sysRole) {
      errors.push(`identity mismatch ${expected.employeeNo}`);
    }
    if (actual.dingtalkId || actual.dingtalkUnionId) {
      errors.push(`DingTalk identity must be empty ${expected.employeeNo}`);
    }
    if (!actual.passwordHash || actual.deletedAt || actual.status === 'resigned') {
      errors.push(`account unavailable ${expected.employeeNo}`);
    }
    if (!actual.dept?.name.startsWith('测试') || actual.dept.parent?.name !== '测试组织（演示）') {
      errors.push(`department isolation mismatch ${expected.employeeNo}`);
    }
  }

  const acceptanceCycles = await prisma.assessmentCycle.findMany({
    where: { name: TEST_ACCEPTANCE_CYCLE_NAME },
    include: {
      tasks: {
        include: {
          employee: { select: { employeeNo: true } },
          manager: { select: { employeeNo: true } },
          _count: { select: { indicatorInstances: true } },
        },
      },
    },
  });
  if (acceptanceCycles.length !== 1) {
    errors.push(`acceptance cycle count expected=1 actual=${acceptanceCycles.length}`);
  } else {
    const cycle = acceptanceCycles[0];
    if (cycle.tasks.length !== ACCEPTANCE_TASK_PLAN.length) {
      errors.push(`acceptance task count expected=7 actual=${cycle.tasks.length}`);
    }
    for (const expected of ACCEPTANCE_TASK_PLAN) {
      const task = cycle.tasks.find((item) => item.employee.employeeNo === expected.employeeNo);
      if (!task) {
        errors.push(`missing acceptance task ${expected.employeeNo}`);
        continue;
      }
      if (task.manager?.employeeNo !== expected.managerNo) {
        errors.push(`manager mismatch ${expected.employeeNo}`);
      }
      if (task.status !== expected.status) {
        errors.push(`status mismatch ${expected.employeeNo} expected=${expected.status} actual=${task.status}`);
      }
      if (task._count.indicatorInstances < 2) {
        errors.push(`indicator data missing ${expected.employeeNo}`);
      }
    }
  }

  const historyCycles = await prisma.assessmentCycle.findMany({
    where: { name: { in: HISTORY_CYCLE_NAMES } },
    include: { _count: { select: { tasks: true } } },
  });
  if (historyCycles.length !== HISTORY_CYCLE_NAMES.length) {
    errors.push(`history cycle count expected=3 actual=${historyCycles.length}`);
  }
  for (const name of HISTORY_CYCLE_NAMES) {
    const cycle = historyCycles.find((item) => item.name === name);
    if (!cycle || cycle._count.tasks !== 4) {
      errors.push(`history task count mismatch ${name}`);
    }
  }

  const accountIds = accounts.map((account) => account.id);
  const foreignTaskCount = await prisma.assessmentTask.count({
    where: {
      employeeId: { in: accountIds },
      cycle: { name: { not: { startsWith: '测试·' } } },
    },
  });
  if (foreignTaskCount !== 0) {
    errors.push(`fixed accounts leak into non-test cycles count=${foreignTaskCount}`);
  }

  const objectiveCount = await prisma.objective.count({
    where: { title: { startsWith: '测试演示-' } },
  });
  if (objectiveCount < 3) errors.push(`test objective data expected>=3 actual=${objectiveCount}`);

  if (errors.length) {
    console.error(`Demo history verification failed (${errors.length})`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('Demo history verification passed: 8 accounts, 1 current cycle, 7 workflow tasks, 3 history cycles, isolated from real cycles.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
