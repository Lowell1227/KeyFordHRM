import { createDemoContext } from "./context";
import { generatePeople } from "./people";
import { generateCatalog } from "./catalog";
import { LaunchService } from "../../src/cycles/launch.service";
import type { Prisma } from "@prisma/client";

const KPI_NAMES = {
  projectProduct: [
    "项目里程碑按期率",
    "项目毛利达成率",
    "客户验收通过率",
    "库存清理目标",
    "跨团队协作",
  ],
  supplyChain: [
    "采购降本率",
    "供应商准交率",
    "质量问题关闭率",
    "库存准确率",
    "重大项目保障",
  ],
  salesRetail: ["净销售额", "回款率", "新渠道销售占比", "坏账控制", "库存清理"],
  ecommerce: [
    "GMV 达成率",
    "投产比",
    "转化率",
    "直播或内容交付",
    "粉丝有效增长",
  ],
  creative: [
    "设计交付及时率",
    "作品准确率",
    "审核留痕",
    "视觉升级成果",
    "AI 工具应用",
  ],
  customerSupport: [
    "首次响应时效",
    "一次解决率",
    "客户满意度",
    "投诉升级控制",
    "数据准确率",
  ],
  functions: [
    "结算或招聘交付及时率",
    "数据准确率",
    "预算或编制控制",
    "制度交付",
    "内部服务满意度",
  ],
} as const;

const JOB_FAMILIES = Object.keys(KPI_NAMES).sort();
const TEMPLATE_INDICATOR_KEYS = [
  "id",
  "dimensionId",
  "indicatorId",
  "name",
  "description",
  "scoringStandard",
  "dataSource",
  "dataCaliber",
  "targetValue",
  "targetValueText",
  "unit",
  "weight",
  "sortOrder",
].sort();

// HR is included because the generated HR manager owns a manager-reporting slot.
const MANAGER_ROLES = new Set(["hr", "manager", "dept_head", "vp"]);

function numberWeight(value: unknown): number {
  return Number(value);
}

function userIds(
  applicableUsers: Prisma.AssessmentTemplateCreateManyInput["applicableUsers"],
): string[] {
  return Array.isArray(applicableUsers)
    ? applicableUsers
    : (applicableUsers?.set ?? []);
}

describe("generateCatalog", () => {
  it("generates complete, scoreable templates for every approved job family", () => {
    const context = createDemoContext();
    const catalog = generateCatalog(context, generatePeople(context));

    expect([...catalog.templateIdByJobFamily.keys()].sort()).toEqual(
      JOB_FAMILIES,
    );
    for (const family of catalog.templateIdByJobFamily.keys()) {
      const template = catalog.templateForFamily(family);
      expect(template.indicators).toHaveLength(6);
      expect(
        template.dimensions.reduce(
          (total, dimension) => total + numberWeight(dimension.weight),
          0,
        ),
      ).toBeCloseTo(1, 6);
      expect(
        template.dimensions.map((dimension) => [
          dimension.type,
          numberWeight(dimension.weight),
        ]),
      ).toEqual([
        ["kpi", 0.8],
        ["attitude", 0.2],
      ]);
      for (const dimension of template.dimensions) {
        const mappedIndicators = template.indicators.filter(
          (indicator) => indicator.dimensionId === dimension.id,
        );
        expect(mappedIndicators).not.toHaveLength(0);
        expect(
          mappedIndicators.reduce(
            (total, indicator) => total + numberWeight(indicator.weight),
            0,
          ),
        ).toBeCloseTo(numberWeight(dimension.weight), 6);
      }
      for (const indicator of template.indicators) {
        expect(indicator.dataSource).not.toHaveLength(0);
        expect(indicator.dataCaliber).not.toHaveLength(0);
        expect(indicator.scoringStandard).not.toHaveLength(0);
      }
    }
  });

  it("keeps every approved KPI in its job-family library and deterministic rows", () => {
    const context = createDemoContext();
    const people = generatePeople(context);
    const catalog = generateCatalog(context, people);

    for (const [family, names] of Object.entries(KPI_NAMES)) {
      const familyIndicators = catalog.indicators.filter(
        (indicator) =>
          indicator.category === family && indicator.type === "kpi",
      );
      expect(familyIndicators.map((indicator) => indicator.name)).toEqual(
        expect.arrayContaining(names),
      );
      expect(familyIndicators).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expect.stringMatching(/^RDMO_[A-Z_]+_\d{2}$/),
            description: expect.stringContaining("realistic-demo-v1"),
            unit: expect.any(String),
            targetValueText: expect.any(String),
            dataSource: expect.any(String),
            dataCaliber: expect.any(String),
            scoringStandard: expect.any(String),
          }),
        ]),
      );
    }

    expect(catalog.templates).toHaveLength(14);
    for (const template of catalog.templates) {
      expect(template.applicableDepts).toEqual(
        expect.arrayContaining([expect.stringMatching(/^[0-9a-f-]{36}$/)]),
      );
      const applicableUsers = userIds(template.applicableUsers);
      if (applicableUsers.length > 0) {
        expect(applicableUsers).toEqual(
          expect.arrayContaining([expect.stringMatching(/^[0-9a-f-]{36}$/)]),
        );
      }
      expect(template.applicableDepts).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^FD\d+$/)]),
      );
      expect(applicableUsers).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^FD\d+$/)]),
      );
    }
    expect(context.manifest.ownedIds.indicator).toEqual(
      catalog.indicators.map((indicator) => indicator.id),
    );
    expect(context.manifest.ownedIds.template).toEqual(
      catalog.templates.map((template) => template.id),
    );
    expect(context.manifest.ownedIds.dimension).toEqual(
      catalog.dimensions.map((dimension) => dimension.id),
    );
    expect(context.manifest.ownedIds["template-indicator"]).toEqual(
      catalog.templateIndicators.map((indicator) => indicator.id),
    );
  });

  it("emits only Prisma TemplateIndicator create-many fields with copied snapshots", () => {
    const context = createDemoContext();
    const catalog = generateCatalog(context, generatePeople(context));

    for (const row of catalog.templateIndicators) {
      expect(Object.keys(row).sort()).toEqual(TEMPLATE_INDICATOR_KEYS);
      expect(row.name).not.toHaveLength(0);
      expect(row.dataSource).not.toHaveLength(0);
      expect(row.dataCaliber).not.toHaveLength(0);
      expect(row.scoringStandard).not.toHaveLength(0);
    }
  });

  it("repeats every catalog row and mapping identifier across fresh contexts", () => {
    const firstContext = createDemoContext();
    const first = generateCatalog(firstContext, generatePeople(firstContext));
    const secondContext = createDemoContext();
    const second = generateCatalog(
      secondContext,
      generatePeople(secondContext),
    );

    expect(first.indicators).toEqual(second.indicators);
    expect(first.templates).toEqual(second.templates);
    expect(first.dimensions).toEqual(second.dimensions);
    expect(first.templateIndicators).toEqual(second.templateIndicators);
    expect(
      new Set(first.indicators.map((indicator) => indicator.code)).size,
    ).toBe(first.indicators.length);
  });

  it("provides manager variants that replace one KPI without changing dimension weights", () => {
    const context = createDemoContext();
    const catalog = generateCatalog(context, generatePeople(context));

    for (const family of catalog.templateIdByJobFamily.keys()) {
      const managerTemplate = catalog.managerTemplateForFamily(family);
      expect(managerTemplate.indicators).toHaveLength(6);
      expect(
        managerTemplate.indicators.map((indicator) => indicator.name),
      ).toEqual(expect.arrayContaining(["人才培养与流程优化"]));
      expect(
        managerTemplate.dimensions.map((dimension) => [
          dimension.type,
          numberWeight(dimension.weight),
        ]),
      ).toEqual([
        ["kpi", 0.8],
        ["attitude", 0.2],
      ]);
    }
  });

  it("partitions each active person into exactly one role-appropriate template variant", () => {
    const context = createDemoContext();
    const people = generatePeople(context);
    const catalog = generateCatalog(context, people);
    const activePeople = people.users.filter(
      (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
    );

    expect(people.managerIds.sort()).toEqual(
      activePeople
        .filter((user) => MANAGER_ROLES.has(user.sysRole!))
        .map((user) => user.id!)
        .sort(),
    );
    for (const user of activePeople) {
      const matchingTemplates = catalog.templates.filter((template) =>
        userIds(template.applicableUsers).includes(user.id!),
      );
      expect(matchingTemplates).toHaveLength(1);
      expect(matchingTemplates[0].name).toContain(
        MANAGER_ROLES.has(user.sysRole!) ? "管理者" : "员工",
      );
    }
  });

  it("selects the manager variant with LaunchService first-user-match semantics", () => {
    const context = createDemoContext();
    const people = generatePeople(context);
    const catalog = generateCatalog(context, people);
    const managers = people.users.filter((user) =>
      MANAGER_ROLES.has(user.sysRole!),
    );
    const launchService = new LaunchService(
      {} as never,
      {} as never,
      {} as never,
    );
    const matchTemplates = (
      launchService as unknown as {
        matchTemplates(
          candidates: Array<{
            id: string;
            name: string;
            deptId: string | null;
            directManagerId: string | null;
            entryDate: Date | null;
            leaveDate: Date | null;
          }>,
          templates: Array<{
            id: string;
            applicableUsers: string[];
            applicableDepts: string[];
          }>,
        ): {
          matches: Array<{
            candidate: { id: string };
            template: { id: string };
          }>;
        };
      }
    ).matchTemplates.bind(launchService);

    const matches = matchTemplates(
      managers.map((user) => ({
        id: user.id!,
        name: user.name,
        deptId: user.deptId ?? null,
        directManagerId: user.directManagerId ?? null,
        entryDate: user.entryDate ? new Date(user.entryDate) : null,
        leaveDate: user.leaveDate ? new Date(user.leaveDate) : null,
      })),
      catalog.templates.map((template) => ({
        id: template.id!,
        applicableUsers: userIds(template.applicableUsers),
        applicableDepts: template.applicableDepts,
      })),
    );

    expect(matches.matches).toHaveLength(managers.length);
    expect(matches.matches.map((match) => match.template.id).sort()).toEqual(
      managers
        .map(
          (manager) =>
            catalog.templates.find((template) =>
              userIds(template.applicableUsers).includes(manager.id!),
            )!.id,
        )
        .sort(),
    );
    for (const match of matches.matches) {
      expect([...catalog.managerTemplateIdByJobFamily.values()]).toContain(
        match.template.id,
      );
    }
  });

  it("leaves reward, penalty, and veto rules as unassigned indicator-library rows", () => {
    const context = createDemoContext();
    const catalog = generateCatalog(context, generatePeople(context));
    const eventRules = catalog.indicators.filter(
      (indicator) =>
        indicator.type !== undefined &&
        ["bonus", "penalty", "veto"].includes(indicator.type),
    );

    expect(eventRules.map((rule) => rule.type).sort()).toEqual([
      "bonus",
      "penalty",
      "veto",
    ]);
    expect(eventRules.map((rule) => rule.id)).toEqual(
      expect.not.arrayContaining(
        catalog.templateIndicators.map((indicator) => indicator.indicatorId),
      ),
    );
  });
});
