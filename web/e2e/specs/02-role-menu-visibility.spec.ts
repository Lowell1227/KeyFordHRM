import { test, expect } from "@playwright/test";
import { DashboardPage } from "../page-objects/dashboard.page";
import { ReportsPage } from "../page-objects/reports.page";

const unopenedModules = ["任务", "项目", "考勤", "薪酬"];

async function expectModules(page: DashboardPage, labels: string[]) {
  await expect(page.navigationModules()).toHaveText(labels);
  for (const title of unopenedModules) {
    await expect(page.railItem(title)).toHaveCount(0);
  }
}

test.describe("02-role-menu-visibility navigation employee", () => {
  test.use({ storageState: "e2e/auth-state/employee.json" });

  test("employee navigation shows only functional modules", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, ["工作台", "绩效", "试用期与转正"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("绩效工作台")).toBeVisible();
    await expect(dashboard.menuItem("目标跟进")).toHaveCount(0);
    await expect(dashboard.menuItem("目标地图")).toHaveCount(0);
    await expect(dashboard.menuItem("团队绩效")).toHaveCount(0);
    await expect(dashboard.module("analysis")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation manager", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("manager navigation keeps team work inside the performance workspace", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, ["工作台", "绩效", "试用期与转正"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("绩效工作台")).toBeVisible();
    await expect(dashboard.menuItem("绩效面谈")).toBeVisible();
    await expect(dashboard.menuItem("团队绩效")).toHaveCount(0);
    await expect(dashboard.module("analysis")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation HR", () => {
  test.use({ storageState: "e2e/auth-state/hr.json" });

  test("HR navigation shows configuration through analysis and settings", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, [
      "工作台",
      "绩效",
      "试用期与转正",
      "分析与设置",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("周期与计划")).toBeVisible();
    await expect(dashboard.menuItem("绩效校准")).toBeVisible();
    await dashboard.openModule("analysis");
    await expect(dashboard.groupTitle("指标与模板")).toBeVisible();
    await expect(dashboard.menuItem("指标库")).toBeVisible();
    await expect(dashboard.menuItem("考核模板")).toBeVisible();
    await expect(dashboard.menuItem("用户管理")).toBeVisible();
  });
});

test.describe("02-role-menu-visibility navigation approver", () => {
  test.use({ storageState: "e2e/auth-state/approver.json" });

  test("VP sees result approval without HR configuration", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, [
      "工作台",
      "绩效",
      "试用期与转正",
      "分析与设置",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await dashboard.openModule("analysis");
    await expect(dashboard.menuItem("周期与计划")).toHaveCount(0);
    await expect(dashboard.menuItem("指标与模板")).toHaveCount(0);
    await expect(dashboard.menuItem("用户管理")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation chairman", () => {
  test.use({ storageState: "e2e/auth-state/chairman.json" });

  test("chairman sees approval and reports without HR configuration", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, [
      "工作台",
      "绩效",
      "试用期与转正",
      "分析与设置",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await expect(dashboard.menuItem("周期与计划")).toHaveCount(0);
    await expect(dashboard.menuItem("绩效校准")).toHaveCount(0);
    await dashboard.openModule("analysis");
    await expect(dashboard.menuItem("报表分析")).toBeVisible();
    await expect(dashboard.menuItem("指标库")).toHaveCount(0);
    await expect(dashboard.menuItem("考核模板")).toHaveCount(0);
    await expect(dashboard.menuItem("用户管理")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation system administrator", () => {
  test.use({ storageState: "e2e/auth-state/admin.json" });

  test("system administrator sees configuration and result approval", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, [
      "工作台",
      "绩效",
      "试用期与转正",
      "分析与设置",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("周期与计划")).toBeVisible();
    await expect(dashboard.menuItem("绩效校准")).toBeVisible();
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await dashboard.openModule("analysis");
    await expect(dashboard.groupTitle("指标与模板")).toBeVisible();
    await expect(dashboard.menuItem("用户管理")).toBeVisible();
  });
});

test.describe("02-role-menu-visibility VP reports", () => {
  test.use({ storageState: "e2e/auth-state/approver.json" });

  test("VP sees only 汇总 tab in reports", async ({ page }) => {
    const reports = new ReportsPage(page);
    await reports.goto();
    await expect(reports.tab("汇总")).toBeVisible();
    await expect(reports.tab("进度")).not.toBeVisible();
    await expect(reports.tab("A/D名单")).not.toBeVisible();
    await expect(reports.tab("导出")).not.toBeVisible();
  });
});
