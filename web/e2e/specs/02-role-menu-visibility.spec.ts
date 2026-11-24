import { test, expect } from "@playwright/test";
import { DashboardPage } from "../page-objects/dashboard.page";
import { ReportsPage } from "../page-objects/reports.page";

const unopenedModules = ["任务", "项目", "考勤"];

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

    await expectModules(dashboard, ["工作台", "绩效"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("绩效任务")).toBeVisible();
    await expect(dashboard.menuItem("目标跟进")).toHaveCount(0);
    await expect(dashboard.menuItem("目标地图")).toHaveCount(0);
    await expect(dashboard.menuItem("团队绩效")).toHaveCount(0);
    await expect(dashboard.module("compensation")).toHaveCount(0);
    await expect(dashboard.module("recruitment")).toHaveCount(0);
    await expect(dashboard.module("system")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation manager", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("manager navigation keeps team work inside the performance workspace", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, ["工作台", "绩效"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("绩效任务")).toBeVisible();
    await expect(dashboard.menuItem("绩效面谈")).toHaveCount(0);
    await expect(dashboard.menuItem("团队绩效")).toHaveCount(0);
    await expect(dashboard.menuItem("绩效报表")).toBeVisible();
    await expect(dashboard.menuItem("员工档案")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation HR", () => {
  test.use({ storageState: "e2e/auth-state/hr.json" });

  test("HR navigation separates performance, people and recruitment", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, [
      "工作台",
      "绩效",
      "人员",
      "招聘",
      "系统管理",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("周期与计划")).toBeVisible();
    await expect(dashboard.menuItem("绩效校准")).toBeVisible();
    await expect(dashboard.groupTitle("绩效设置")).toBeVisible();
    await expect(dashboard.menuItem("指标库")).toBeVisible();
    await expect(dashboard.menuItem("考核模板")).toBeVisible();
    await expect(dashboard.groupTitle("试用期与转正")).toBeVisible();
    await expect(dashboard.menuItem("转正管理")).toBeVisible();
    await expect(dashboard.menuItem("我的转正申请")).toBeVisible();
    await dashboard.openModule("people");
    await expect(dashboard.groupTitle("人员档案")).toBeVisible();
    await expect(dashboard.menuItem("员工档案")).toBeVisible();
    await expect(dashboard.menuItem("人事基础资料")).toBeVisible();
    await expect(dashboard.menuItem("转正管理")).toHaveCount(0);
    await expect(dashboard.menuItem("我的转正申请")).toHaveCount(0);
    await expect(dashboard.menuItem("人才库")).toHaveCount(0);
    await dashboard.openModule("recruitment");
    await expect(page).toHaveURL(/\/talents(?:\?|$)/);
    await expect(dashboard.menuItem("人才库")).toBeVisible();
    await expect(dashboard.menuItem("应聘与面试")).toBeVisible();
    await expect(dashboard.menuItem("录用确认")).toBeVisible();
    await expect(dashboard.menuItem("建设规划")).toHaveCount(0);
    await expect(dashboard.module("compensation")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility navigation approver", () => {
  test.use({ storageState: "e2e/auth-state/approver.json" });

  test("VP sees result approval without HR configuration", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expectModules(dashboard, ["工作台", "绩效", "人员"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await expect(dashboard.menuItem("周期与计划")).toHaveCount(0);
    await expect(dashboard.groupTitle("绩效设置")).toHaveCount(0);
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

    await expectModules(dashboard, ["工作台", "绩效", "人员"]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await expect(dashboard.menuItem("周期与计划")).toHaveCount(0);
    await expect(dashboard.menuItem("绩效校准")).toHaveCount(0);
    await expect(dashboard.menuItem("绩效报表")).toBeVisible();
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
      "人员",
      "招聘",
      "薪酬规划中",
      "系统管理",
    ]);
    await dashboard.openModule("performance");
    await expect(dashboard.menuItem("周期与计划")).toBeVisible();
    await expect(dashboard.menuItem("绩效校准")).toBeVisible();
    await expect(dashboard.menuItem("结果审批")).toBeVisible();
    await expect(dashboard.groupTitle("绩效设置")).toBeVisible();
    await dashboard.openModule("people");
    await expect(dashboard.menuItem("员工档案")).toBeVisible();
    await expect(dashboard.menuItem("人事基础资料")).toBeVisible();
    await dashboard.openModule("recruitment");
    await expect(page).toHaveURL(/\/talents(?:\?|$)/);
    await expect(dashboard.menuItem("人才库")).toBeVisible();
    await expect(dashboard.menuItem("应聘与面试")).toBeVisible();
    await expect(dashboard.menuItem("建设规划")).toBeVisible();
    await expect(dashboard.menuItem("录用确认")).toHaveCount(0);
  });
});

test.describe("02-role-menu-visibility VP reports", () => {
  test.use({ storageState: "e2e/auth-state/approver.json" });

  test("VP sees only 结果概览 tab in reports", async ({ page }) => {
    const reports = new ReportsPage(page);
    await reports.goto();
    await expect(reports.tab("结果概览")).toBeVisible();
    await expect(reports.tab("流程进度")).not.toBeVisible();
    await expect(reports.tab("重点关注")).not.toBeVisible();
    await expect(reports.tab("导出")).not.toBeVisible();
  });
});
