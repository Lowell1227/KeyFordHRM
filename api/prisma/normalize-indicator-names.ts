import { IndicatorType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INDICATOR_FIXTURES = [
  {
    name: '季度销售回款达成率',
    code: 'KPI-SALES-COLLECTION-Q',
    category: '经营结果',
    groupName: '销售管理',
    description: '衡量季度实际回款金额相对计划回款金额的完成情况。',
    scoringStandard: '实际回款金额 / 计划回款金额 * 100%，低于 80% 需说明原因。',
    dataSource: '财务回款台账',
    dataCaliber: '以财务确认入账日期为准，剔除内部往来与退款冲正。',
    targetValue: 100,
    unit: '%',
  },
  {
    name: '客户交付准时率',
    code: 'KPI-DELIVERY-ONTIME',
    category: '客户交付',
    groupName: '运营交付',
    description: '衡量承诺交付日期内完成客户交付的订单占比。',
    scoringStandard: '准时交付订单数 / 应交付订单数 * 100%，延期订单需有原因归档。',
    dataSource: '订单交付系统',
    dataCaliber: '按客户确认的承诺交付日期统计，异常订单以审批后的调整日期为准。',
    targetValue: 95,
    unit: '%',
  },
] as const;

async function main() {
  const legacyIndicators = await prisma.indicator.findMany({
    where: { name: { startsWith: 'E2E UI indicator ' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  let renamed = 0;
  for (const [index, indicator] of legacyIndicators.entries()) {
    const fixture = INDICATOR_FIXTURES[index % INDICATOR_FIXTURES.length];
    const suffix = index >= INDICATOR_FIXTURES.length ? `-${index + 1}` : '';
    await prisma.indicator.update({
      where: { id: indicator.id },
      data: {
        ...fixture,
        code: `${fixture.code}${suffix}`,
        type: IndicatorType.kpi,
      },
    });
    renamed += 1;
  }

  console.log(`已规范化 ${renamed} 个指标名称`);
}

main()
  .catch((error) => {
    console.error('规范化指标名称失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
