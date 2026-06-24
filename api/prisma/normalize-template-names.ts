import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEGACY_PATTERNS = [
  { prefix: 'E2E full path template ', quarter: '二', scenario: '全流程验证' },
  { prefix: 'E2E pre-publish mask template ', quarter: '一', scenario: '公示前权限验证' },
  { prefix: 'debug template ', quarter: '二', scenario: '调试验证' },
  { prefix: 'E2E模板', quarter: '一', scenario: '自动化验证' },
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toShanghaiParts(date: Date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function toRunLabel(date: Date, index: number): string {
  const part = toShanghaiParts(date);
  return `${part.year}${pad(part.month)}${pad(part.day)}-${pad(part.hour)}${pad(part.minute)}-${pad(index + 1)}`;
}

async function main() {
  const legacyTemplates = await prisma.assessmentTemplate.findMany({
    where: {
      OR: LEGACY_PATTERNS.map(({ prefix }) => ({ name: { startsWith: prefix } })),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, createdAt: true },
  });

  let renamed = 0;
  for (const [index, template] of legacyTemplates.entries()) {
    const match = LEGACY_PATTERNS.find(({ prefix }) => template.name.startsWith(prefix));
    if (!match) continue;

    const name = `2026年${match.quarter}季度绩效模板（${match.scenario} ${toRunLabel(template.createdAt, index)}）`;
    await prisma.assessmentTemplate.update({
      where: { id: template.id },
      data: { name },
    });
    renamed += 1;
  }

  console.log(`已规范化 ${renamed} 个考核模板名称`);
}

main()
  .catch((error) => {
    console.error('规范化考核模板名称失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
