import { DimensionType, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LibraryIndicator = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  scoringStandard: string | null;
  dataSource: string | null;
  dataCaliber: string | null;
  targetValue: Prisma.Decimal | null;
  unit: string | null;
};

const codeByKeyword: Array<[RegExp, string]> = [
  [/回款|销售业绩|净销售额|销售额|成交额|销售达成/, 'KPI-SALES-COLLECTION-Q'],
  [/B2B|重点客户/, 'KPI-SALES-B2B-GMV'],
  [/线下|门店销售/, 'KPI-SALES-RETAIL-ACH'],
  [/新客|新客户|客户开发/, 'KPI-SALES-NEW-CUSTOMERS'],
  [/采购|供应商|准交/, 'KPI-SC-PO-ONTIME'],
  [/库存|周转/, 'KPI-SC-INVENTORY-DAYS'],
  [/仓储|发货|错漏发/, 'KPI-SC-WAREHOUSE-ACCURACY'],
  [/外贸|出运/, 'KPI-SC-FOREIGN-ONTIME'],
  [/项目进度|节点|里程碑|进度管控/, 'KPI-PROJECT-MILESTONE-ONTIME'],
  [/毛利|净利润|利润/, 'KPI-PROJECT-GROSS-MARGIN'],
  [/项目变更|变更闭环/, 'KPI-PROJECT-CHANGE-CLOSE'],
  [/活动落地|门店活动/, 'KPI-STORE-CAMPAIGN-EXEC'],
  [/会员|复购/, 'KPI-STORE-MEMBER-REPURCHASE'],
  [/直播.*GMV|GMV|直播运营效能/, 'KPI-LIVE-GMV-ACH'],
  [/直播间|转化率/, 'KPI-LIVE-CONVERSION'],
  [/客服|首次响应|响应及时/, 'KPI-CS-FIRST-RESPONSE'],
  [/投诉|客诉|服务质量/, 'KPI-CS-COMPLAINT-CLOSE'],
  [/设计效率|设计需求/, 'KPI-DESIGN-ONTIME'],
  [/设计准确率|一次通过|视觉素材/, 'KPI-DESIGN-FIRST-PASS'],
  [/短视频|视频素材|素材产出/, 'KPI-VIDEO-OUTPUT-ACH'],
  [/系统需求|上线|发布/, 'KPI-DIGITAL-RELEASE-ONTIME'],
  [/系统可用|稳定|SLA/, 'KPI-DIGITAL-SLA'],
  [/研发|缺陷|bug/i, 'KPI-RD-BUG-FIX-ONTIME'],
  [/运营活动|ROI/, 'KPI-OPS-CAMPAIGN-ROI'],
  [/运营效率|运营任务|任务闭环/, 'KPI-OPS-TASK-CLOSE'],
  [/招聘|到岗/, 'KPI-HR-HIRING-ONTIME'],
  [/试用期|转正/, 'KPI-HR-PROBATION-CLOSE'],
  [/行政|响应/, 'KPI-ADMIN-RESPONSE'],
  [/报销|费用/, 'KPI-FIN-REIMBURSE-ONTIME'],
  [/结账|月结/, 'KPI-FIN-CLOSE-ONTIME'],
  [/决策事项|经营会议|管理决策/, 'KPI-GMO-DECISION-CLOSE'],
  [/创新|创新项目|业务验证/, 'KPI-INNOVATION-VALIDATION'],
  [/外援.*验收|一次验收/, 'KPI-OUTSOURCE-ACCEPTANCE'],
  [/吉客云|数据同步/, 'KPI-JKY-SYNC-SUCCESS'],
  [/协泰/, 'KPI-XIETAI-DELIVERY-ONTIME'],
];

const codeByGroupKeyword: Array<[RegExp, string]> = [
  [/销售部/, 'KPI-SALES-COLLECTION-Q'],
  [/B2B销售组/, 'KPI-SALES-B2B-GMV'],
  [/线下零售组/, 'KPI-SALES-RETAIL-ACH'],
  [/供应链中心/, 'KPI-SC-INVENTORY-DAYS'],
  [/供应链管理部/, 'KPI-SC-PO-ONTIME'],
  [/仓储定制部/, 'KPI-SC-WAREHOUSE-ACCURACY'],
  [/外贸组/, 'KPI-SC-FOREIGN-ONTIME'],
  [/项目中心|项目一部|项目二部|项目三部/, 'KPI-PROJECT-MILESTONE-ONTIME'],
  [/项目管理和运营部/, 'KPI-PROJECT-CHANGE-CLOSE'],
  [/直播电商部/, 'KPI-LIVE-GMV-ACH'],
  [/客服部/, 'KPI-CS-FIRST-RESPONSE'],
  [/创意设计部|视觉设计部/, 'KPI-DESIGN-ONTIME'],
  [/视觉视频组/, 'KPI-VIDEO-OUTPUT-ACH'],
  [/数字化运营部/, 'KPI-DIGITAL-RELEASE-ONTIME'],
  [/研发部/, 'KPI-RD-BUG-FIX-ONTIME'],
  [/运营部/, 'KPI-OPS-TASK-CLOSE'],
  [/人事部|人力资源部/, 'KPI-HR-HIRING-ONTIME'],
  [/行政部/, 'KPI-ADMIN-RESPONSE'],
  [/财务部/, 'KPI-FIN-REIMBURSE-ONTIME'],
  [/总经办/, 'KPI-GMO-DECISION-CLOSE'],
  [/创新业务中心/, 'KPI-INNOVATION-VALIDATION'],
  [/吉客云系统外援/, 'KPI-JKY-SYNC-SUCCESS'],
  [/协泰外援/, 'KPI-XIETAI-DELIVERY-ONTIME'],
  [/外援/, 'KPI-OUTSOURCE-ACCEPTANCE'],
];

function pickLibraryCode(args: {
  templateName: string;
  templateDescription: string | null;
  dimensionName: string;
  dimensionType: DimensionType;
  indicatorName: string;
  sortOrder: number;
}): string {
  const text = [
    args.indicatorName,
    args.dimensionName,
    args.templateName,
    args.templateDescription ?? '',
  ].join(' ');

  if (/全流程验证|公示前权限验证|调试验证|演示绩效模板|通用绩效考核模板/.test(args.templateName)) {
    return args.dimensionType === 'attitude' ? 'KPI-OPS-TASK-CLOSE' : 'KPI-SALES-COLLECTION-Q';
  }

  for (const [pattern, code] of codeByKeyword) {
    if (pattern.test(text)) return code;
  }

  for (const [pattern, code] of codeByGroupKeyword) {
    if (pattern.test(text)) return code;
  }

  if (args.dimensionType === 'attitude') {
    return args.sortOrder % 2 === 0 ? 'KPI-OPS-TASK-CLOSE' : 'KPI-GMO-DECISION-CLOSE';
  }

  return 'KPI-PROJECT-MILESTONE-ONTIME';
}

async function main() {
  const library = await prisma.indicator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      scoringStandard: true,
      dataSource: true,
      dataCaliber: true,
      targetValue: true,
      unit: true,
    },
  });

  const libraryByCode = new Map(library.map((indicator) => [indicator.code, indicator]));

  const templateIndicators = await prisma.templateIndicator.findMany({
    include: {
      dimension: {
        include: {
          template: {
            select: { name: true, description: true },
          },
        },
      },
    },
    orderBy: [{ dimension: { template: { name: 'asc' } } }, { dimension: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  let synced = 0;
  const missingCodes = new Set<string>();

  for (const item of templateIndicators) {
    const code = pickLibraryCode({
      templateName: item.dimension.template.name,
      templateDescription: item.dimension.template.description,
      dimensionName: item.dimension.name,
      dimensionType: item.dimension.type,
      indicatorName: item.name,
      sortOrder: item.sortOrder,
    });
    const target = libraryByCode.get(code) as LibraryIndicator | undefined;
    if (!target) {
      missingCodes.add(code);
      continue;
    }

    await prisma.templateIndicator.update({
      where: { id: item.id },
      data: {
        indicatorId: target.id,
        name: target.name,
        description: item.description ?? target.description,
        scoringStandard: target.scoringStandard,
        dataSource: target.dataSource,
        dataCaliber: target.dataCaliber,
        targetValue: target.targetValue,
        unit: target.unit,
      },
    });
    synced += 1;
  }

  if (missingCodes.size > 0) {
    throw new Error(`指标库缺少编码：${Array.from(missingCodes).join(', ')}`);
  }

  console.log(`已同步 ${synced} 条模板指标为指标库同名指标`);
}

main()
  .catch((error) => {
    console.error('同步模板指标失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
