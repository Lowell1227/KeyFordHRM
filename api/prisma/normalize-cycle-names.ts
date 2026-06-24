import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEGACY_PATTERNS = [
  { prefix: 'E2E full path cycle ', scenario: '全流程验证' },
  { prefix: 'E2E pre-publish mask cycle ', scenario: '公示前权限验证' },
  { prefix: 'debug cycle ', scenario: '调试验证' },
  { prefix: 'E2E周期', scenario: '自动化验证' },
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toQuarterName(date: Date): string {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const quarterNames = ['一', '二', '三', '四'];
  return `${year}年${quarterNames[quarter - 1]}季度绩效考核`;
}

function toRunLabel(date: Date, index: number): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}-${pad(index + 1)}`;
}

async function main() {
  const legacyCycles = await prisma.assessmentCycle.findMany({
    where: {
      OR: LEGACY_PATTERNS.map(({ prefix }) => ({ name: { startsWith: prefix } })),
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, startDate: true, createdAt: true },
  });

  let renamed = 0;
  for (const [index, cycle] of legacyCycles.entries()) {
    const match = LEGACY_PATTERNS.find(({ prefix }) => cycle.name.startsWith(prefix));
    if (!match) continue;

    const name = `${toQuarterName(cycle.startDate)}（${match.scenario} ${toRunLabel(cycle.createdAt, index)}）`;
    await prisma.assessmentCycle.update({
      where: { id: cycle.id },
      data: { name },
    });
    renamed += 1;
  }

  console.log(`已规范化 ${renamed} 个考核周期名称`);
}

main()
  .catch((error) => {
    console.error('规范化考核周期名称失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
