import type { Prisma } from "@prisma/client";
import type { DemoContext } from "./context";
import type {
  CatalogBundle,
  GeneratedTemplate,
  JobFamily,
  PeopleBundle,
} from "./types";

interface IndicatorDefinition {
  name: string;
  unit: string;
  targetValue: number;
  targetValueText: string;
  dataSource: string;
  dataCaliber: string;
  scoringStandard: string;
}

interface FamilyDefinition {
  label: string;
  departmentIds: string[];
  indicators: IndicatorDefinition[];
}

const ATTITUDE_INDICATOR: IndicatorDefinition = {
  name: "工作态度与协作",
  unit: "分",
  targetValue: 100,
  targetValueText: "遵守制度、主动协作并按承诺交付",
  dataSource: "直属主管观察记录、协作方反馈和考勤记录",
  dataCaliber: "考核周期内有效反馈与制度执行记录，剔除无事实依据的主观评价",
  scoringStandard:
    "100分：持续示范；90分：主动可靠；80分：达到要求；70分：需提醒；60分及以下：影响协作或违反要求",
};

const MANAGER_INDICATOR: IndicatorDefinition = {
  name: "人才培养与流程优化",
  unit: "项",
  targetValue: 2,
  targetValueText: "完成至少2项可验证的人才培养或流程优化成果",
  dataSource: "团队培养计划、复盘纪要和流程发布记录",
  dataCaliber: "仅统计已落地且有负责人、验收证据或效果复盘的培养和优化事项",
  scoringStandard:
    "达成2项且成效明显100分；达成2项90分；达成1项80分；无落地成果60分",
};

const MANAGER_SYS_ROLES = new Set(["hr", "manager", "dept_head", "vp"]);

const FAMILY_DEFINITIONS: Record<JobFamily, FamilyDefinition> = {
  projectProduct: {
    label: "项目与产品",
    departmentIds: [
      "00000000-0000-0000-0000-000000000010",
      "00000000-0000-0000-0000-000000000101",
      "00000000-0000-0000-0000-000000000102",
      "00000000-0000-0000-0000-000000000103",
      "00000000-0000-0000-0000-000000000104",
    ],
    indicators: [
      {
        name: "项目里程碑按期率",
        unit: "%",
        targetValue: 95,
        targetValueText: "按期完成率不低于95%",
        dataSource: "项目计划、里程碑台账和验收记录",
        dataCaliber: "考核期应完成里程碑中按计划日期完成的占比",
        scoringStandard: "≥100%目标100分；95%–99%90分；90%–94%80分；<90%60分",
      },
      {
        name: "项目毛利达成率",
        unit: "%",
        targetValue: 100,
        targetValueText: "项目毛利达成预算的100%",
        dataSource: "项目损益表和财务结算数据",
        dataCaliber: "已确认收入减可归集成本后毛利与预算毛利的比率",
        scoringStandard: "≥110%100分；100%–109%90分；90%–99%80分；<90%60分",
      },
      {
        name: "客户验收通过率",
        unit: "%",
        targetValue: 98,
        targetValueText: "一次验收通过率不低于98%",
        dataSource: "客户验收单和项目交付记录",
        dataCaliber: "考核期首次提交并获客户验收通过的项目占比",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "库存清理目标",
        unit: "元",
        targetValue: 200000,
        targetValueText: "完成20万元呆滞库存清理",
        dataSource: "库存台账、调拨单和销售出库单",
        dataCaliber: "仅计入考核期内已出库或已完成处置结算的呆滞库存金额",
        scoringStandard: "≥120%目标100分；100%–119%90分；80%–99%80分；<80%60分",
      },
      {
        name: "跨团队协作",
        unit: "分",
        targetValue: 90,
        targetValueText: "协作交付评价不低于90分",
        dataSource: "项目周报、协作方反馈和风险闭环记录",
        dataCaliber: "按承诺响应、问题闭环和协作方有效反馈综合评分",
        scoringStandard: "≥95分100分；90–94分90分；80–89分80分；<80分60分",
      },
    ],
  },
  supplyChain: {
    label: "供应链与仓储",
    departmentIds: [
      "00000000-0000-0000-0000-000000000012",
      "00000000-0000-0000-0000-000000000121",
      "00000000-0000-0000-0000-000000000122",
    ],
    indicators: [
      {
        name: "采购降本率",
        unit: "%",
        targetValue: 5,
        targetValueText: "可比口径采购降本率不低于5%",
        dataSource: "采购订单、合同和财务价格台账",
        dataCaliber:
          "同规格同条件采购的基准价格与实际成交价格差额占基准价格比例",
        scoringStandard: "≥8%100分；5%–7.99%90分；3%–4.99%80分；<3%60分",
      },
      {
        name: "供应商准交率",
        unit: "%",
        targetValue: 96,
        targetValueText: "供应商按承诺日期交付率不低于96%",
        dataSource: "采购订单、收货单和供应商交期台账",
        dataCaliber: "按订单行统计，在确认交期内足量到货的行数占比",
        scoringStandard: "≥98%100分；96%–97%90分；92%–95%80分；<92%60分",
      },
      {
        name: "质量问题关闭率",
        unit: "%",
        targetValue: 95,
        targetValueText: "当期质量问题闭环率不低于95%",
        dataSource: "来料检验报告、质量问题单和关闭记录",
        dataCaliber: "考核期登记问题中已完成验证关闭的问题占比",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "库存准确率",
        unit: "%",
        targetValue: 99,
        targetValueText: "账实库存准确率不低于99%",
        dataSource: "WMS盘点表和库存台账",
        dataCaliber: "盘点无差异SKU数占盘点SKU总数的比例",
        scoringStandard:
          "≥99.5%100分；99%–99.49%90分；98%–98.99%80分；<98%60分",
      },
      {
        name: "重大项目保障",
        unit: "项",
        targetValue: 3,
        targetValueText: "保障3项重大项目按计划供货",
        dataSource: "重大项目清单、供货计划和异常处理单",
        dataCaliber: "仅统计已列入重大项目清单且无责任性断供的项目",
        scoringStandard:
          "全部保障并提前预警100分；全部保障90分；出现1次可控延误80分；责任性断供60分",
      },
    ],
  },
  salesRetail: {
    label: "销售、门店与B2B",
    departmentIds: [
      "00000000-0000-0000-0000-000000000014",
      "00000000-0000-0000-0000-000000000011",
      "00000000-0000-0000-0000-000000000141",
      "00000000-0000-0000-0000-000000000142",
      "00000000-0000-0000-0000-000000001011",
      "00000000-0000-0000-0000-000000001021",
    ],
    indicators: [
      {
        name: "净销售额",
        unit: "元",
        targetValue: 1000000,
        targetValueText: "完成100万元净销售额",
        dataSource: "ERP销售订单、退货单和财务确认收入",
        dataCaliber: "含税销售额扣除退货、折让和取消订单后的净额",
        scoringStandard: "≥120%目标100分；100%–119%90分；80%–99%80分；<80%60分",
      },
      {
        name: "回款率",
        unit: "%",
        targetValue: 95,
        targetValueText: "到期应收回款率不低于95%",
        dataSource: "应收账款台账和银行回单",
        dataCaliber: "到期应收中在考核期内实际到账金额占比",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "新渠道销售占比",
        unit: "%",
        targetValue: 15,
        targetValueText: "新渠道销售额占比不低于15%",
        dataSource: "渠道销售报表和渠道准入台账",
        dataCaliber: "本年度新开或新激活渠道的净销售额占总净销售额比例",
        scoringStandard: "≥20%100分；15%–19%90分；10%–14%80分；<10%60分",
      },
      {
        name: "坏账控制",
        unit: "%",
        targetValue: 1,
        targetValueText: "责任坏账率不高于1%",
        dataSource: "应收账龄表、核销单和法务确认单",
        dataCaliber: "责任归属销售的核销坏账金额占对应确认收入比例",
        scoringStandard: "≤0.5%100分；0.51%–1%90分；1.01%–2%80分；>2%60分",
      },
      {
        name: "库存清理",
        unit: "元",
        targetValue: 150000,
        targetValueText: "完成15万元门店或渠道库存清理",
        dataSource: "库存台账、促销方案和出库单",
        dataCaliber: "仅计入已实现销售或完成合规处置的指定库存金额",
        scoringStandard: "≥120%目标100分；100%–119%90分；80%–99%80分；<80%60分",
      },
    ],
  },
  ecommerce: {
    label: "电商、直播与新媒体",
    departmentIds: [
      "00000000-0000-0000-0000-000000000015",
      "00000000-0000-0000-0000-000000000105",
    ],
    indicators: [
      {
        name: "GMV 达成率",
        unit: "%",
        targetValue: 100,
        targetValueText: "GMV完成预算目标的100%",
        dataSource: "电商平台后台、订单系统和财务对账单",
        dataCaliber: "已支付且未退款订单的成交总额与预算GMV的比率",
        scoringStandard: "≥120%100分；100%–119%90分；80%–99%80分；<80%60分",
      },
      {
        name: "投产比",
        unit: "倍",
        targetValue: 3,
        targetValueText: "营销投产比不低于3.0",
        dataSource: "广告投放后台、平台订单数据和财务费用台账",
        dataCaliber: "归因成交毛利或GMV除以可核验投放费用，口径在期初锁定",
        scoringStandard:
          "≥4.0倍100分；3.0–3.99倍90分；2.5–2.99倍80分；<2.5倍60分",
      },
      {
        name: "转化率",
        unit: "%",
        targetValue: 4,
        targetValueText: "访客成交转化率不低于4%",
        dataSource: "店铺数据后台和埋点分析报表",
        dataCaliber: "支付买家数除以有效访客数，剔除机器人及异常流量",
        scoringStandard: "≥5%100分；4%–4.99%90分；3%–3.99%80分；<3%60分",
      },
      {
        name: "直播或内容交付",
        unit: "场/条",
        targetValue: 20,
        targetValueText: "完成20场直播或内容交付",
        dataSource: "直播排期、内容发布记录和复盘报告",
        dataCaliber: "仅统计按排期上线且完成数据复盘的直播场次或内容条目",
        scoringStandard: "≥120%目标100分；100%–119%90分；80%–99%80分；<80%60分",
      },
      {
        name: "粉丝有效增长",
        unit: "人",
        targetValue: 5000,
        targetValueText: "新增5000名有效粉丝",
        dataSource: "平台粉丝后台和用户增长报表",
        dataCaliber: "新增后7日仍关注且非异常账号的粉丝净增量",
        scoringStandard: "≥120%目标100分；100%–119%90分；80%–99%80分；<80%60分",
      },
    ],
  },
  creative: {
    label: "创意、视觉与产品设计",
    departmentIds: [
      "00000000-0000-0000-0000-000000000013",
      "00000000-0000-0000-0000-000000000106",
    ],
    indicators: [
      {
        name: "设计交付及时率",
        unit: "%",
        targetValue: 95,
        targetValueText: "设计任务按期交付率不低于95%",
        dataSource: "需求排期、设计任务单和交付记录",
        dataCaliber: "在确认需求和截止日期后按期完成交付的任务占比",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "作品准确率",
        unit: "%",
        targetValue: 98,
        targetValueText: "一次审核准确率不低于98%",
        dataSource: "设计审核单、修改记录和发布清单",
        dataCaliber: "首次审核无品牌、文案、规格或素材错误的作品占比",
        scoringStandard: "≥99%100分；98%–98.99%90分；95%–97.99%80分；<95%60分",
      },
      {
        name: "审核留痕",
        unit: "%",
        targetValue: 100,
        targetValueText: "审核留痕完整率100%",
        dataSource: "审核系统、版本库和需求单",
        dataCaliber: "应审核项目中留存审批意见、版本和最终确认记录的占比",
        scoringStandard: "100%100分；98%–99%90分；95%–97%80分；<95%60分",
      },
      {
        name: "视觉升级成果",
        unit: "项",
        targetValue: 2,
        targetValueText: "完成2项可验收视觉升级成果",
        dataSource: "品牌项目立项书、发布记录和效果复盘",
        dataCaliber: "仅统计已上线并经业务或品牌负责人验收的视觉升级项目",
        scoringStandard: "≥3项100分；2项90分；1项80分；0项60分",
      },
      {
        name: "AI 工具应用",
        unit: "项",
        targetValue: 2,
        targetValueText: "形成2项可复用的AI工具应用",
        dataSource: "工具使用台账、素材库和效率复盘",
        dataCaliber: "仅统计有使用说明、复用记录并通过质量审核的AI应用",
        scoringStandard: "≥3项100分；2项90分；1项80分；0项60分",
      },
    ],
  },
  customerSupport: {
    label: "客服及业务支持",
    departmentIds: ["00000000-0000-0000-0000-000000000107"],
    indicators: [
      {
        name: "首次响应时效",
        unit: "分钟",
        targetValue: 10,
        targetValueText: "客户咨询首次响应中位时长不高于10分钟",
        dataSource: "客服工单系统和会话日志",
        dataCaliber: "工作时段内从客户发起到人工首次有效回复的中位时长",
        scoringStandard:
          "≤5分钟100分；6–10分钟90分；11–15分钟80分；>15分钟60分",
      },
      {
        name: "一次解决率",
        unit: "%",
        targetValue: 85,
        targetValueText: "一次解决率不低于85%",
        dataSource: "客服工单、回访记录和转派日志",
        dataCaliber: "无需二次转派或重复来访即关闭的有效工单占比",
        scoringStandard: "≥90%100分；85%–89%90分；80%–84%80分；<80%60分",
      },
      {
        name: "客户满意度",
        unit: "%",
        targetValue: 95,
        targetValueText: "客户满意度不低于95%",
        dataSource: "满意度问卷、客服回访和平台评价",
        dataCaliber: "有效满意及非常满意评价数占有效评价总数的比例",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "投诉升级控制",
        unit: "%",
        targetValue: 2,
        targetValueText: "责任性升级投诉率不高于2%",
        dataSource: "投诉系统、工单升级记录和质检报告",
        dataCaliber: "因服务责任升级至主管及以上的工单占有效工单比例",
        scoringStandard: "≤1%100分；1.01%–2%90分；2.01%–3%80分；>3%60分",
      },
      {
        name: "数据准确率",
        unit: "%",
        targetValue: 99,
        targetValueText: "客户与工单数据准确率不低于99%",
        dataSource: "CRM抽检、工单系统和质检记录",
        dataCaliber: "抽检字段中填写正确且可追溯的字段数占抽检字段总数比例",
        scoringStandard:
          "≥99.5%100分；99%–99.49%90分；98%–98.99%80分；<98%60分",
      },
    ],
  },
  functions: {
    label: "财务、人事与行政",
    departmentIds: [
      "00000000-0000-0000-0000-000000000016",
      "00000000-0000-0000-0000-000000000018",
    ],
    indicators: [
      {
        name: "结算或招聘交付及时率",
        unit: "%",
        targetValue: 95,
        targetValueText: "结算或招聘任务按期交付率不低于95%",
        dataSource: "结算台账、招聘系统和任务排期",
        dataCaliber: "在承诺截止日前完成且资料齐全的结算或招聘交付任务占比",
        scoringStandard: "≥98%100分；95%–97%90分；90%–94%80分；<90%60分",
      },
      {
        name: "数据准确率",
        unit: "%",
        targetValue: 99,
        targetValueText: "报表或人事数据准确率不低于99%",
        dataSource: "财务报表、人事系统和抽检记录",
        dataCaliber: "抽检字段中与原始凭证或审批记录一致的字段占比",
        scoringStandard:
          "≥99.5%100分；99%–99.49%90分；98%–98.99%80分；<98%60分",
      },
      {
        name: "预算或编制控制",
        unit: "%",
        targetValue: 100,
        targetValueText: "预算或编制执行保持在批准额度内",
        dataSource: "预算执行表、编制台账和审批记录",
        dataCaliber: "实际发生额或在岗编制与已批准额度的符合率",
        scoringStandard:
          "完全合规100分；轻微偏差且及时纠正90分；出现未纠正偏差80分；重大超额60分",
      },
      {
        name: "制度交付",
        unit: "项",
        targetValue: 2,
        targetValueText: "完成2项制度或流程交付",
        dataSource: "制度发布记录、审批流和培训签到",
        dataCaliber: "仅统计已审批发布且完成宣导或可执行配置的制度流程",
        scoringStandard: "≥3项100分；2项90分；1项80分；0项60分",
      },
      {
        name: "内部服务满意度",
        unit: "%",
        targetValue: 90,
        targetValueText: "内部服务满意度不低于90%",
        dataSource: "内部服务工单、满意度问卷和回访记录",
        dataCaliber: "有效评价中满意及非常满意评价占比",
        scoringStandard: "≥95%100分；90%–94%90分；85%–89%80分；<85%60分",
      },
    ],
  },
};

function familyCode(family: JobFamily): string {
  return family.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}

function templateRows(
  context: DemoContext,
  people: PeopleBundle,
  family: JobFamily,
  definition: FamilyDefinition,
  indicatorIds: string[],
  attitudeIndicatorId: string,
  managerIndicatorId: string,
  manager: boolean,
  libraryById: Map<string, Prisma.IndicatorCreateManyInput>,
): GeneratedTemplate {
  const variant = manager ? "manager" : "employee";
  const applicableDepts = [
    ...definition.departmentIds,
    ...(family === "projectProduct"
      ? people.departments.flatMap((department) =>
          department.id ? [department.id] : [],
        )
      : []),
  ];
  const templateId = context.own(
    "template",
    context.id("template", `${family}-${variant}`),
  );
  const eligibleUsers = people.users
    .filter(
      (user) =>
        user.id &&
        user.status !== "resigned" &&
        user.sysRole !== "system_admin" &&
        user.deptId !== null &&
        user.deptId !== undefined &&
        applicableDepts.includes(user.deptId) &&
        MANAGER_SYS_ROLES.has(user.sysRole ?? "") === manager,
    )
    .map((user) => user.id!);
  const template: Prisma.AssessmentTemplateCreateManyInput = {
    id: templateId,
    name: `2026真实演示-${definition.label}-${manager ? "管理者" : "员工"}`,
    description: `realistic-demo-v1；${definition.label}${manager ? "管理者" : "员工"}绩效模板`,
    applicableDepts,
    applicableUsers: eligibleUsers,
    maxScore: 100,
    isActive: true,
    version: 1,
    createdBy: context.id("user", people.acceptanceEmployeeNos.hr),
  };
  const kpiDimensionId = context.own(
    "dimension",
    context.id("dimension", `${family}-${variant}-kpi`),
  );
  const attitudeDimensionId = context.own(
    "dimension",
    context.id("dimension", `${family}-${variant}-attitude`),
  );
  const dimensions: Prisma.TemplateDimensionCreateManyInput[] = [
    {
      id: kpiDimensionId,
      templateId,
      name: "工作目标",
      weight: 0.8,
      type: "kpi",
      sortOrder: 1,
    },
    {
      id: attitudeDimensionId,
      templateId,
      name: "工作态度",
      weight: 0.2,
      type: "attitude",
      sortOrder: 2,
    },
  ];
  const selectedKpiIds = manager
    ? [...indicatorIds.slice(0, 4), managerIndicatorId]
    : indicatorIds;
  const templateIndicators = selectedKpiIds.map((indicatorId, index) => {
    const id = context.own(
      "template-indicator",
      context.id("template-indicator", `${family}-${variant}-kpi-${index + 1}`),
    );
    return {
      id,
      dimensionId: kpiDimensionId,
      indicatorId,
      weight: 0.16,
      sortOrder: index + 1,
    };
  });
  templateIndicators.push({
    id: context.own(
      "template-indicator",
      context.id("template-indicator", `${family}-${variant}-attitude`),
    ),
    dimensionId: attitudeDimensionId,
    indicatorId: attitudeIndicatorId,
    weight: 0.2,
    sortOrder: 1,
  });

  return {
    template,
    dimensions,
    indicators: templateIndicators.map((row) => {
      const library = libraryById.get(row.indicatorId!);
      if (!library)
        throw new Error(`missing indicator library row ${row.indicatorId}`);
      return {
        id: row.id,
        dimensionId: row.dimensionId,
        indicatorId: row.indicatorId,
        name: library.name,
        description: library.description,
        scoringStandard: library.scoringStandard,
        dataSource: library.dataSource,
        dataCaliber: library.dataCaliber,
        targetValue: library.targetValue,
        targetValueText: library.targetValueText,
        unit: library.unit,
        weight: row.weight,
        sortOrder: row.sortOrder,
      } satisfies Prisma.TemplateIndicatorCreateManyInput;
    }),
  };
}

function eventRule(
  context: DemoContext,
  type: "bonus" | "penalty" | "veto",
): Prisma.IndicatorCreateManyInput {
  const definitions = {
    bonus: [
      "重大贡献奖励",
      "重大客户、项目或效率突破经审批后可追加奖励",
      "达成确认的重大贡献，追加0–10分",
    ],
    penalty: [
      "责任事件扣分",
      "因责任性延期、质量事故或品牌影响经认定后扣分",
      "按责任等级扣1–20分",
    ],
    veto: [
      "一票否决",
      "发生重大合规、安全或诚信事件时触发",
      "触发后考核结果按制度否决",
    ],
  } as const;
  const [name, caliber, scoringStandard] = definitions[type];
  return {
    id: context.own(
      "indicator",
      context.id("indicator", `RDMO_${type.toUpperCase()}_01`),
    ),
    name,
    code: `RDMO_${type.toUpperCase()}_01`,
    category: "eventRule",
    type,
    description: `realistic-demo-v1；${name}`,
    unit: type === "veto" ? "次" : "分",
    targetValue: 0,
    targetValueText: "仅在故事事件发生时挂接至指标实例",
    dataSource: "事件认定单、审批记录和审计留痕",
    dataCaliber: caliber,
    scoringStandard,
    isActive: true,
  };
}

export function generateCatalog(
  context: DemoContext,
  people: PeopleBundle,
): CatalogBundle {
  const indicators: Prisma.IndicatorCreateManyInput[] = [];
  const templates: Prisma.AssessmentTemplateCreateManyInput[] = [];
  const dimensions: Prisma.TemplateDimensionCreateManyInput[] = [];
  const templateIndicators: Prisma.TemplateIndicatorCreateManyInput[] = [];
  const libraryById = new Map<string, Prisma.IndicatorCreateManyInput>();
  const templateIdByJobFamily = new Map<JobFamily, string>();
  const managerTemplateIdByJobFamily = new Map<JobFamily, string>();
  const employeeTemplates = new Map<JobFamily, GeneratedTemplate>();
  const managerTemplates = new Map<JobFamily, GeneratedTemplate>();

  const register = (row: Prisma.IndicatorCreateManyInput) => {
    indicators.push(row);
    libraryById.set(row.id!, row);
    return row.id!;
  };

  for (const [family, definition] of Object.entries(
    FAMILY_DEFINITIONS,
  ) as Array<[JobFamily, FamilyDefinition]>) {
    const code = familyCode(family);
    const kpiIds = definition.indicators.map((indicator, index) =>
      register({
        id: context.own(
          "indicator",
          context.id(
            "indicator",
            `RDMO_${code}_${String(index + 1).padStart(2, "0")}`,
          ),
        ),
        code: `RDMO_${code}_${String(index + 1).padStart(2, "0")}`,
        category: family,
        type: "kpi",
        description: `realistic-demo-v1；${definition.label}：${indicator.name}`,
        ...indicator,
        isActive: true,
      }),
    );
    const attitudeIndicatorId = register({
      id: context.own("indicator", context.id("indicator", `RDMO_${code}_06`)),
      code: `RDMO_${code}_06`,
      category: family,
      type: "attitude",
      description: `realistic-demo-v1；${definition.label}：${ATTITUDE_INDICATOR.name}`,
      ...ATTITUDE_INDICATOR,
      isActive: true,
    });
    const managerIndicatorId = register({
      id: context.own("indicator", context.id("indicator", `RDMO_${code}_07`)),
      code: `RDMO_${code}_07`,
      category: family,
      type: "kpi",
      description: `realistic-demo-v1；${definition.label}：${MANAGER_INDICATOR.name}`,
      ...MANAGER_INDICATOR,
      isActive: true,
    });
    const employee = templateRows(
      context,
      people,
      family,
      definition,
      kpiIds,
      attitudeIndicatorId,
      managerIndicatorId,
      false,
      libraryById,
    );
    const manager = templateRows(
      context,
      people,
      family,
      definition,
      kpiIds,
      attitudeIndicatorId,
      managerIndicatorId,
      true,
      libraryById,
    );
    employeeTemplates.set(family, employee);
    managerTemplates.set(family, manager);
    templateIdByJobFamily.set(family, employee.template.id!);
    managerTemplateIdByJobFamily.set(family, manager.template.id!);
    templates.push(employee.template, manager.template);
    dimensions.push(...employee.dimensions, ...manager.dimensions);
    templateIndicators.push(...employee.indicators, ...manager.indicators);
  }

  indicators.push(
    eventRule(context, "bonus"),
    eventRule(context, "penalty"),
    eventRule(context, "veto"),
  );

  return {
    indicators,
    templates,
    dimensions,
    templateIndicators,
    templateIdByJobFamily,
    managerTemplateIdByJobFamily,
    templateForFamily(family) {
      const template = employeeTemplates.get(family);
      if (!template) throw new Error(`unknown job family ${family}`);
      return template;
    },
    managerTemplateForFamily(family) {
      const template = managerTemplates.get(family);
      if (!template) throw new Error(`unknown job family ${family}`);
      return template;
    },
  };
}
