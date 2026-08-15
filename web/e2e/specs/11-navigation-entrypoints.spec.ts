import { test, expect } from "@playwright/test";
import { buildNavigation } from "../../src/router/navigation";
import { isPerformanceWorkspacePath } from "../../src/router/performance-workspace";
import {
  navigateNotificationTarget,
  resolveNotificationTarget,
} from "../../src/components/layout/notification-target";
import { routes } from "../../src/router/routes";
import { DashboardPage } from "../page-objects/dashboard.page";
import type {
  Paginated,
  TaskListItem,
  TeamTaskListItem,
  TeamTaskPage,
  Notification,
} from "../../src/types/api.types";

const apiResponse = (data: unknown) => ({
  code: 0,
  message: "success",
  data,
  timestamp: Date.now(),
});

const E2E_ACTIONABLE_NOTIFICATION_ID = "00000000-0000-4000-8000-000000000411";

const taskItem = (overrides: Partial<TaskListItem> = {}): TaskListItem => ({
  id: "task-default",
  cycleId: "cycle-default",
  cycleName: "2026 Q3",
  snapshotId: "snapshot-default",
  employeeId: "employee-1",
  employeeName: "Employee",
  status: "indicator_confirming",
  isExempt: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const taskPage = (items: TaskListItem[]): Paginated<TaskListItem> => ({
  total: items.length,
  page: 1,
  pageSize: 20,
  items,
});

const teamTaskItem = (
  overrides: Partial<TeamTaskListItem> = {},
): TeamTaskListItem => ({
  id: "team-task-default",
  cycleId: "cycle-default",
  cycleName: "2026 Q3",
  employeeId: "employee-1",
  employeeName: "Employee",
  deptId: "dept-1",
  deptName: "Engineering",
  managerId: "manager-1",
  status: "indicator_reviewing",
  totalScore: null,
  rawGrade: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  employeeNo: "E-1",
  avatarUrl: null,
  position: "Engineer",
  stageState: "pending",
  ...overrides,
});

const teamPage = (
  pending: number,
  stage: "goal-review" | "manager-eval" = "goal-review",
): TeamTaskPage => ({
  total: pending,
  page: 1,
  pageSize: 1,
  items:
    pending > 0
      ? [
          teamTaskItem({
            id: `${stage}-task-1`,
            status:
              stage === "goal-review"
                ? "indicator_reviewing"
                : "manager_scoring",
          }),
        ]
      : [],
  counts: { all: pending, notStarted: 0, pending, completed: 0, exempted: 0 },
  facets: { departments: [], employees: [] },
});

const notificationItem = (
  overrides: Partial<Notification> = {},
): Notification => ({
  id: "notification-default",
  userId: "manager-1",
  senderId: null,
  senderName: null,
  taskId: "task-default",
  cycleId: null,
  type: "task_reminder",
  title: "Performance task",
  content: "Please review the task",
  channel: "dingtalk",
  status: "sent",
  isRead: false,
  readAt: null,
  sentAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

test.describe("11-navigation-entrypoints navigation tree", () => {
  test("employee navigation excludes administration and unopened modules", () => {
    const modules = buildNavigation(routes, {
      sysRole: "employee",
      canViewAll: false,
    });

    expect(modules.map((module) => module.label)).toEqual([
      "工作台",
      "绩效",
      "人员流程",
    ]);
    expect(JSON.stringify(modules)).not.toContain("团队绩效");
    expect(JSON.stringify(modules)).not.toContain("考勤");
    expect(JSON.stringify(modules)).not.toContain("目标跟进");
  });

  test("HR navigation exposes analysis and settings pages in configured order", () => {
    const modules = buildNavigation(routes, {
      sysRole: "hr",
      canViewAll: false,
    });

    expect(modules.map((module) => module.label)).toEqual([
      "工作台",
      "绩效",
      "人员流程",
      "分析与设置",
    ]);
    const analysis = modules.find((module) => module.key === "analysis");
    expect(analysis?.defaultPath).toBe("/reports");
    expect(
      analysis?.groups.flatMap((group) =>
        group.items.map((item) => item.label),
      ),
    ).toEqual(["报表分析", "指标库", "考核模板", "用户管理"]);
    expect(
      analysis?.groups
        .find((group) => group.key === "indicator-config")
        ?.items.map((item) => item.label),
    ).toEqual(["指标库", "考核模板"]);
  });

  test("does not expose route records without navigation metadata", () => {
    const modules = buildNavigation(routes, {
      sysRole: "manager",
      canViewAll: false,
    });

    expect(JSON.stringify(modules)).not.toContain("目标地图");
    expect(JSON.stringify(modules)).not.toContain("目标跟进");
    expect(JSON.stringify(modules)).not.toContain("任务详情");
  });
});

test.describe("11-navigation-entrypoints navigation active state", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("manager performance entry exposes stacked personal and team stages without a scope filter", async ({
    page,
  }) => {
    await page.goto("/tasks");

    await expect(page).toHaveURL(
      /scope=team.*stage=goal-review.*stageState=pending/,
    );
    const navigation = page.getByTestId("manager-task-navigation");
    const groups = navigation.locator(".manager-task-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText("我的绩效待办");
    await expect(groups.nth(1)).toContainText("我团队的绩效待办");
    await expect(page.getByTestId("task-scope-mine")).toHaveCount(0);
    await expect(page.getByTestId("task-scope-team")).toHaveCount(0);

    await page.getByTestId("task-stage-self-eval").click();
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page.getByTestId("task-stage-self-eval")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByTestId("manager-team-stage-manager-eval").click();
    await expect(page).toHaveURL(
      /scope=team.*stage=manager-eval.*stageState=pending/,
    );
    await expect(
      page.getByTestId("manager-team-stage-manager-eval"),
    ).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("team performance deep link remains active in the performance workspace", async ({
    page,
  }) => {
    await page.goto("/tasks?scope=team&stage=manager-eval");
    const dashboard = new DashboardPage(page);

    await expect(dashboard.module("performance")).toBeVisible();
    await expect(dashboard.menuItem("绩效工作台")).toHaveClass(/is-active/);
    await expect(page.locator(".app-main")).toHaveClass(/app-main--workspace/);
    await expect(page.getByTestId("performance-workspace-title")).toHaveText(
      "绩效待办",
    );
  });

  test("preserves a performance collapse across refresh and removes stale persisted keys", async ({
    page,
  }) => {
    await page.goto("/tasks");
    await page.evaluate(() => {
      localStorage.setItem(
        "kayford.sidebar.collapsedGroups",
        JSON.stringify({ performance: true, retired: true }),
      );
    });
    await page.reload();

    const performanceGroup = page.locator(".menu-group__title", {
      hasText: "绩效管理",
    });
    await expect(performanceGroup).toHaveAttribute("aria-expanded", "false");
    const persisted = await page.evaluate(() =>
      localStorage.getItem("kayford.sidebar.collapsedGroups"),
    );
    expect(persisted).toBe(JSON.stringify({ performance: true }));

    await page.reload();
    await expect(performanceGroup).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("11-navigation-entrypoints dashboard task entry points", () => {
  test.use({ storageState: "e2e/auth-state/employee.json" });

  test("employee skips newer terminal tasks and opens the latest active personal task", async ({
    page,
  }) => {
    const items = [
      taskItem({
        id: "task-confirmed",
        cycleId: "cycle-3",
        cycleName: "2026 Q4",
        status: "confirmed",
      }),
      taskItem({
        id: "task-active",
        cycleId: "cycle-2",
        cycleName: "2026 Q3",
        status: "indicator_confirming",
      }),
      taskItem({
        id: "task-closed",
        cycleId: "cycle-1",
        cycleName: "2026 Q2",
        status: "closed",
      }),
      taskItem({
        id: "task-exempted",
        cycleId: "cycle-0",
        cycleName: "2026 Q1",
        status: "exempted",
        isExempt: true,
      }),
    ];
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(taskPage(items))),
      }),
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.currentEmployeeTask()).toContainText("目标确认");
    await dashboard.currentEmployeeTaskOpen().click();
    await expect(page).toHaveURL(/\/tasks\/task-active\?returnTo=\/tasks$/);
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tasks/task-active");
    expect([...destination.searchParams.entries()]).toEqual([
      ["returnTo", "/tasks"],
    ]);
  });
});

test.describe("11-navigation-entrypoints manager dashboard task entry points", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("manager sees true pending counts and opens the matching team workspace", async ({
    page,
  }) => {
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(taskPage([]))),
      }),
    );
    await page.route("**/api/v1/tasks/team**", (route) => {
      const stage = new URL(route.request().url()).searchParams.get("stage");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse(
            teamPage(
              stage === "goal-review" ? 3 : 2,
              stage === "manager-eval" ? "manager-eval" : "goal-review",
            ),
          ),
        ),
      });
    });
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managerGoalReviewCount()).toHaveText("3");
    await expect(dashboard.managerEvaluationCount()).toHaveText("2");
    await dashboard.managerGoalReviewOpen().click();
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tasks");
    expect([...destination.searchParams.entries()]).toEqual([
      ["scope", "team"],
      ["stage", "goal-review"],
    ]);
  });

  test("each manager task request settles independently when another request is slow or fails", async ({
    page,
  }) => {
    let releaseManagerEvaluation!: () => void;
    const managerEvaluationGate = new Promise<void>((resolve) => {
      releaseManagerEvaluation = resolve;
    });
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({ status: 500 }),
    );
    await page.route("**/api/v1/tasks/team**", async (route) => {
      const stage = new URL(route.request().url()).searchParams.get("stage");
      if (stage === "manager-eval") await managerEvaluationGate;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse(
            teamPage(
              stage === "goal-review" ? 4 : 2,
              stage === "manager-eval" ? "manager-eval" : "goal-review",
            ),
          ),
        ),
      });
    });
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managerGoalReviewCount()).toHaveText("4", {
      timeout: 1_500,
    });
    await expect(dashboard.managerPersonalTask()).toHaveAttribute(
      "data-state",
      "error",
    );
    await expect(dashboard.managerEvaluationCard()).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(dashboard.managerEvaluationCount()).toHaveCount(0);

    releaseManagerEvaluation();
    await expect(dashboard.managerEvaluationCount()).toHaveText("2");
  });

  test("role identity changes ignore late responses from the previous request generation", async ({
    page,
  }) => {
    let releaseFirstGeneration!: () => void;
    const firstGenerationGate = new Promise<void>((resolve) => {
      releaseFirstGeneration = resolve;
    });
    let personalCalls = 0;
    const teamCalls: Record<string, number> = {
      "goal-review": 0,
      "manager-eval": 0,
    };

    await page.route("**/api/v1/tasks/mine**", async (route) => {
      personalCalls += 1;
      const firstGeneration = personalCalls === 1;
      if (firstGeneration) await firstGenerationGate;
      const item = taskItem({
        id: firstGeneration ? "task-old" : "task-new",
        cycleName: firstGeneration ? "Old cycle" : "New cycle",
        status: "self_eval",
      });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(taskPage([item]))),
      });
    });
    await page.route("**/api/v1/tasks/team**", async (route) => {
      const stage = new URL(route.request().url()).searchParams.get("stage") as
        | "goal-review"
        | "manager-eval";
      teamCalls[stage] += 1;
      const firstGeneration = teamCalls[stage] === 1;
      if (firstGeneration) await firstGenerationGate;
      const pending = firstGeneration
        ? stage === "goal-review"
          ? 1
          : 2
        : stage === "goal-review"
          ? 22
          : 33;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(teamPage(pending, stage))),
      });
    });
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect.poll(() => personalCalls).toBe(1);
    await expect.poll(() => teamCalls["goal-review"]).toBe(1);
    await expect.poll(() => teamCalls["manager-eval"]).toBe(1);

    await page.evaluate(async () => {
      const storeModulePath = "/src/stores/auth.store.ts";
      const { useAuthStore } = await import(storeModulePath);
      const store = useAuthStore();
      if (!store.user) throw new Error("Expected a loaded manager identity");
      store.user = { ...store.user, id: "manager-second-generation" };
    });

    await expect(dashboard.managerPersonalTask()).toContainText("New cycle");
    await expect(dashboard.managerGoalReviewCount()).toHaveText("22");
    await expect(dashboard.managerEvaluationCount()).toHaveText("33");

    const oldPersonalResponse = page.waitForResponse((response) =>
      response.url().includes("/api/v1/tasks/mine"),
    );
    releaseFirstGeneration();
    await oldPersonalResponse;
    await expect(dashboard.managerPersonalTask()).toContainText("New cycle");
    await expect(dashboard.managerGoalReviewCount()).toHaveText("22");
    await expect(dashboard.managerEvaluationCount()).toHaveText("33");
  });

  test("management rows expose a detail command only for real task ids", async ({
    page,
  }) => {
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(taskPage([]))),
      }),
    );
    await page.route("**/api/v1/tasks/team**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(teamPage(0))),
      }),
    );
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 50,
            items: [{ id: "cycle-1", name: "2026 Q3", status: "published" }],
          }),
        ),
      }),
    );
    await page.route("**/api/v1/reports/cycle/cycle-1/summary**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            stats: {
              total: 2,
              grades: {
                A: { count: 0, ratio: 0 },
                B: { count: 0, ratio: 0 },
                C: { count: 0, ratio: 0 },
                D: { count: 0, ratio: 0 },
              },
            },
            items: [
              {
                taskId: "task-7",
                employeeName: "Ada",
                employeeNo: "E-7",
                deptName: "Engineering",
                position: "Engineer",
                totalScore: null,
                grade: null,
                managerName: "Manager",
              },
              {
                employeeName: "No task",
                employeeNo: "E-8",
                deptName: "Engineering",
                position: "Engineer",
                totalScore: null,
                grade: null,
                managerName: "Manager",
              },
            ],
          }),
        ),
      }),
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.managementTaskOpen("task-7")).toBeVisible();
    await expect(page.getByTestId("dashboard-task-open-undefined")).toHaveCount(
      0,
    );
    await dashboard.managementTaskOpen("task-7").click();
    await expect(page).toHaveURL(/\/tasks\/task-7\?returnTo=\/tasks$/);
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tasks/task-7");
    expect([...destination.searchParams.entries()]).toEqual([
      ["returnTo", "/tasks"],
    ]);
  });
});

test.describe("11-navigation-entrypoints dashboard task access boundaries", () => {
  test.use({ storageState: "e2e/auth-state/hr.json" });

  test("HR dashboard does not request supervisor-only team work", async ({
    page,
  }) => {
    let teamRequests = 0;
    await page.route("**/api/v1/tasks/team**", (route) => {
      teamRequests += 1;
      return route.fulfill({ status: 500 });
    });
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    await page.goto("/dashboard");
    await expect(page.locator(".dashboard-admin")).toBeVisible();
    expect(teamRequests).toBe(0);
  });
});

test.describe("11-navigation-entrypoints dashboard task layout", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("manager task entry stays compact without horizontal overflow at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse(
            taskPage([
              taskItem({
                id: "task-1",
                cycleId: "cycle-1",
                cycleName: "2026 Q3",
                employeeId: "manager-1",
                status: "self_eval",
              }),
            ]),
          ),
        ),
      }),
    );
    await page.route("**/api/v1/tasks/team**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(teamPage(12))),
      }),
    );
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    await page.goto("/dashboard");
    await expect(page.getByTestId("manager-goal-review-count")).toHaveText(
      "12",
    );

    const layout = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      cards: Array.from(
        document.querySelectorAll(".manager-task-entry .task-entry-card"),
      ).map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    }));
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(
      layout.cards.every((card) => card.left >= 0 && card.right <= 390),
    ).toBe(true);

    await page.screenshot({
      path: "../.superpowers/sdd/2026-08-08-navigation-dashboard-notifications/task-3-mobile.png",
      fullPage: true,
    });
  });

  test("manager task navigation stays stacked and filters fit at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v1/tasks/mine**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(taskPage([]))),
      }),
    );
    await page.route("**/api/v1/tasks/team**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse(teamPage(2))),
      }),
    );
    await page.route("**/api/v1/cycles**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 50, items: [] }),
        ),
      }),
    );

    await page.goto("/tasks");
    const groups = page
      .getByTestId("manager-task-navigation")
      .locator(".manager-task-group");
    await expect(groups).toHaveCount(2);
    await expect(page.getByTestId("task-scope-mine")).toHaveCount(0);
    await expect(page.getByTestId("task-scope-team")).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const groupRects = Array.from(
        document.querySelectorAll<HTMLElement>(".manager-task-group"),
      ).map((group) => group.getBoundingClientRect());
      const department = document
        .querySelector<HTMLElement>("[data-testid='team-department-filter']")
        ?.getBoundingClientRect();
      const employee = document
        .querySelector<HTMLElement>("[data-testid='team-employee-filter']")
        ?.getBoundingClientRect();
      return {
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        groupTops: groupRects.map((rect) => rect.top),
        filterWidths: [department?.width ?? 0, employee?.width ?? 0],
      };
    });
    expect(layout.groupTops[1]).toBeGreaterThan(layout.groupTops[0] ?? 0);
    expect(layout.filterWidths.every((width) => width >= 320)).toBe(true);
    expect(layout.overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("11-navigation-entrypoints header", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("classifies canonical and trailing-slash workspace paths exactly", () => {
    for (const path of [
      "/tasks",
      "/tasks////",
      "/objectives",
      "/objectives//",
      "/action-items",
      "/action-items///",
    ]) {
      expect(isPerformanceWorkspacePath(path)).toBe(true);
    }

    for (const path of [
      "/tasks/task-1",
      "/tasks-extra",
      "/performance/tasks",
    ]) {
      expect(isPerformanceWorkspacePath(path)).toBe(false);
    }
  });

  test("performance workspace keeps one local title and only working header actions", async ({
    page,
  }) => {
    await page.goto("/tasks");

    await expect(
      page.locator(".app-header").getByPlaceholder("搜索"),
    ).toHaveCount(0);
    await expect(page.locator(".app-header .header-action")).toHaveCount(0);
    await expect(page.getByTestId("performance-workspace-title")).toHaveCount(
      1,
    );
    await expect(page.getByTestId("app-route-title")).toHaveCount(0);
    await expect(page.getByTestId("app-notifications")).toBeVisible();
    await expect(page.getByTestId("header-user-menu")).toBeVisible();
  });

  test("normalizes trailing slashes without treating task details or prefixes as workspaces", async ({
    page,
  }) => {
    for (const path of ["/tasks/", "/objectives/", "/action-items/"]) {
      await page.goto(path);

      await expect(page.locator(".app-main")).toHaveClass(
        /app-main--workspace/,
      );
      await expect(page.getByTestId("performance-workspace-title")).toHaveCount(
        1,
      );
      await expect(page.getByTestId("app-route-title")).toHaveCount(0);
    }

    await page.goto("/tasks/not-a-workspace");

    await expect(page.locator(".app-main")).not.toHaveClass(
      /app-main--workspace/,
    );
    await expect(page.getByTestId("performance-workspace-title")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("app-route-title")).toHaveCount(1);
  });

  test("keeps notifications and user menu right-aligned without overlap at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tasks/");

    await expect(page.getByTestId("app-notifications")).toBeVisible();
    await expect(page.getByTestId("header-user-menu")).toBeVisible();

    const layout = await page.evaluate(() => {
      const header = document
        .querySelector(".app-header")
        ?.getBoundingClientRect();
      const actions = document
        .querySelector(".app-header__right")
        ?.getBoundingClientRect();
      const notifications = document
        .querySelector('[data-testid="app-notifications"]')
        ?.getBoundingClientRect();
      const userMenu = document
        .querySelector('[data-testid="header-user-menu"]')
        ?.getBoundingClientRect();

      if (!header || !actions || !notifications || !userMenu) return null;

      return {
        rightGap: header.right - actions.right,
        controlsOverlap: notifications.right > userMenu.left,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.rightGap).toBeGreaterThanOrEqual(0);
    expect(layout?.rightGap).toBeLessThanOrEqual(12);
    expect(layout?.controlsOverlap).toBe(false);
    expect(layout?.overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("11-navigation-entrypoints non-workspace header", () => {
  test.use({ storageState: "e2e/auth-state/hr.json" });

  test("non-workspace pages retain one plain route title", async ({ page }) => {
    await page.goto("/reports");

    await expect(page.getByTestId("app-route-title")).toHaveText("报表分析");
    await expect(page.getByTestId("app-route-title")).toHaveCount(1);
  });
});

test.describe("11-navigation-entrypoints notification task links", () => {
  test("resolves supervisor notifications only for direct-manager workspace roles", () => {
    expect(
      resolveNotificationTarget(
        notificationItem({
          id: "indicator",
          taskId: "task-1",
          type: "indicator_setting_notice",
        }),
        "manager",
      ),
    ).toEqual({
      path: "/tasks",
      query: { scope: "team", stage: "goal-review", taskId: "task-1" },
    });
    expect(
      resolveNotificationTarget(
        notificationItem({
          id: "self-eval",
          taskId: "task-2",
          type: "self_eval_submitted",
        }),
        "dept_head",
      ),
    ).toEqual({
      path: "/tasks",
      query: { scope: "team", stage: "manager-eval", taskId: "task-2" },
    });
    expect(
      resolveNotificationTarget(
        notificationItem({
          id: "hr-indicator",
          taskId: "task-3",
          type: "indicator_setting_notice",
        }),
        "hr",
      ),
    ).toEqual({ name: "TaskDetail", params: { id: "task-3" } });
    expect(
      resolveNotificationTarget(
        notificationItem({
          id: "unknown",
          taskId: "task-4",
          type: "future_notification_type",
        }),
        "manager",
      ),
    ).toEqual({ name: "TaskDetail", params: { id: "task-4" } });
  });

  test("returns no command when a notification has no task", () => {
    expect(
      resolveNotificationTarget(notificationItem({ taskId: null }), "manager"),
    ).toBeNull();
  });

  test.use({ storageState: "e2e/auth-state/manager.json" });

  test("marks an unread notification then opens the matching goal review workspace", async ({
    page,
  }) => {
    let marked = 0;
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [
              notificationItem({
                id: "notification-goal",
                taskId: "task-goal",
                type: "indicator_setting_notice",
              }),
            ],
          }),
        ),
      }),
    );
    await page.route(
      "**/api/v1/notifications/notification-goal/read",
      (route) => {
        marked += 1;
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            apiResponse({
              ...notificationItem({
                id: "notification-goal",
                taskId: "task-goal",
                type: "indicator_setting_notice",
                isRead: true,
                readAt: "2026-08-09T09:00:00.000Z",
              }),
              unreadCount: 0,
            }),
          ),
        });
      },
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    const row = page.getByTestId("notification-item-notification-goal");
    await expect(row).toHaveAttribute("role", "button");
    await row.click();

    expect(marked).toBe(1);
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tasks");
    expect([...destination.searchParams.entries()]).toEqual([
      ["scope", "team"],
      ["stage", "goal-review"],
      ["taskId", "task-goal"],
    ]);
    const notificationState = await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      return {
        unreadCount: store.unreadCount,
        item: store.notifications.find(
          (notification: Notification) =>
            notification.id === "notification-goal",
        ),
      };
    });
    expect(notificationState.unreadCount).toBe(0);
    expect(notificationState.item).toMatchObject({
      status: "sent",
      isRead: true,
      readAt: "2026-08-09T09:00:00.000Z",
    });
    await expect(row).toBeHidden();
  });

  test("continues navigation after an unread-mark failure and ignores duplicate activation", async ({
    page,
  }) => {
    let markAttempts = 0;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [
              notificationItem({
                id: "notification-evaluation",
                taskId: "task-evaluation",
                type: "self_eval_submitted",
              }),
            ],
          }),
        ),
      }),
    );
    await page.route(
      "**/api/v1/notifications/notification-evaluation/read",
      async (route) => {
        markAttempts += 1;
        await readGate;
        await route.fulfill({ status: 500, body: "read failed" });
      },
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    const row = page.getByTestId("notification-item-notification-evaluation");
    await row.click();
    await row.press("Enter");
    expect(markAttempts).toBe(1);

    releaseRead();
    await expect(page.locator(".el-message--warning")).toContainText(
      "仍将继续跳转",
    );
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tasks");
    expect([...destination.searchParams.entries()]).toEqual([
      ["scope", "team"],
      ["stage", "manager-eval"],
      ["taskId", "task-evaluation"],
    ]);
  });

  test("keeps notifications without a task non-actionable", async ({
    page,
  }) => {
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [
              notificationItem({
                id: "notification-info",
                taskId: null,
                type: "system_notice",
              }),
            ],
          }),
        ),
      }),
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    const row = page.getByTestId("notification-item-notification-info");
    await expect(row).not.toHaveAttribute("role");
    await expect(row).not.toHaveAttribute("tabindex");
    await row.click({ force: true });
    expect(new URL(page.url()).pathname).toBe("/tasks");
  });

  test("supports single Enter and Space activation for a readable task notification", async ({
    page,
  }) => {
    let markAttempts = 0;
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [
              notificationItem({
                id: "notification-detail",
                taskId: "task-detail",
                type: "result_published",
                isRead: true,
                readAt: "2026-08-01T01:00:00.000Z",
              }),
            ],
          }),
        ),
      }),
    );
    await page.route(
      "**/api/v1/notifications/notification-detail/read",
      (route) => {
        markAttempts += 1;
        return route.fulfill({ status: 500 });
      },
    );

    for (const key of ["Enter", "Space"]) {
      await page.goto("/tasks");
      await page.getByTestId("app-notifications").click();
      const row = page.getByTestId("notification-item-notification-detail");
      await row.press(key);
      await expect(page).toHaveURL(/\/tasks\/task-detail$/);
    }

    expect(markAttempts).toBe(0);
  });

  test("reports a rejected router call as a failed notification navigation", async () => {
    const target = resolveNotificationTarget(
      notificationItem({ taskId: "task-error" }),
      "employee",
    );
    expect(target).not.toBeNull();
    if (!target) return;

    await expect(
      navigateNotificationTarget(target, () =>
        Promise.reject(new Error("route failed")),
      ),
    ).resolves.toBe(false);
  });

  test("exposes a focusable notification button for Enter and Space", async ({
    page,
  }) => {
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 10, items: [] }),
        ),
      }),
    );

    await page.goto("/tasks");
    const trigger = page.getByTestId("app-notifications");
    await expect(trigger).toHaveRole("button");
    await expect(trigger).toHaveAttribute("aria-label", "通知");
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.locator(".notification-popover")).toBeVisible();
    await trigger.press("Space");
    await expect(page.locator(".notification-popover")).toBeHidden();
  });

  test("serializes activation globally so a later row cannot replace an in-flight target", async ({
    page,
  }) => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const marked: string[] = [];
    const items = [
      notificationItem({
        id: "notification-first",
        taskId: "task-first",
        type: "indicator_setting_notice",
      }),
      notificationItem({
        id: "notification-second",
        taskId: "task-second",
        type: "self_eval_submitted",
      }),
    ];
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 2 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 2, page: 1, pageSize: 10, items }),
        ),
      }),
    );
    await page.route("**/api/v1/notifications/*/read", async (route) => {
      const pathParts = new URL(route.request().url()).pathname.split("/");
      const id = pathParts[pathParts.length - 2] ?? "";
      marked.push(id);
      if (id === "notification-first") await firstGate;
      const source = items.find((item) => item.id === id);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            ...source,
            isRead: true,
            readAt: "2026-08-09T09:00:00.000Z",
            unreadCount: 1,
          }),
        ),
      });
    });

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    const first = page.getByTestId("notification-item-notification-first");
    const second = page.getByTestId("notification-item-notification-second");
    await first.click();
    await expect(first).toBeDisabled();
    await expect(second).toBeDisabled();
    await second.click({ force: true });
    expect(marked).toEqual(["notification-first"]);

    releaseFirst();
    await expect(page).toHaveURL(
      /scope=team&stage=goal-review&taskId=task-first/,
    );
    expect(marked).toEqual(["notification-first"]);
  });

  test("does not navigate or warn when an old activation settles after unmount", async ({
    page,
  }) => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const item = notificationItem({
      id: "notification-unmount",
      taskId: "task-unmount",
    });
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 1, page: 1, pageSize: 10, items: [item] }),
        ),
      }),
    );
    await page.route(
      "**/api/v1/notifications/notification-unmount/read",
      async (route) => {
        await readGate;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            apiResponse({
              ...item,
              isRead: true,
              readAt: "2026-08-09T09:00:00.000Z",
              unreadCount: 0,
            }),
          ),
        });
      },
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    await page.getByTestId("notification-item-notification-unmount").click();
    await page.getByTestId("header-user-menu").click();
    await page.getByTestId("header-logout").click();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByTestId("app-notifications")).toBeHidden();

    releaseRead();
    await page.waitForTimeout(100);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.locator(".el-message")).toHaveCount(0);
  });

  test("clears the global busy state and closes the popover when routing fails", async ({
    page,
  }) => {
    const item = notificationItem({
      id: "notification-route-failure",
      taskId: "task-route-failure",
      type: "result_published",
      isRead: true,
      readAt: "2026-08-09T09:00:00.000Z",
    });
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 1, page: 1, pageSize: 10, items: [item] }),
        ),
      }),
    );
    await page.route("**/*TaskDetailView*", (route) => route.abort());

    await page.goto("/tasks");
    const currentWorkspaceUrl = page.url();
    const trigger = page.getByTestId("app-notifications");
    await trigger.click();
    await page
      .getByTestId("notification-item-notification-route-failure")
      .click();

    await expect(page).toHaveURL(currentWorkspaceUrl);
    await expect(page.locator(".el-message--warning")).toBeVisible();
    await expect(page.locator(".notification-popover")).toBeHidden();
    await expect(trigger).toBeEnabled();
  });

  test("isolates delayed list responses across notification user sessions", async ({
    page,
  }) => {
    let releaseFirst!: () => void;
    let announceFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstRequested = new Promise<void>((resolve) => {
      announceFirst = resolve;
    });
    let requestNumber = 0;
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", async (route) => {
      const currentRequest = ++requestNumber;
      if (currentRequest === 1) {
        announceFirst();
        await firstGate;
      }
      const userId = currentRequest === 1 ? "user-a" : "user-b";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [notificationItem({ id: `notification-${userId}`, userId })],
          }),
        ),
      });
    });

    await page.goto("/tasks");
    await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      store.setSession("user-a");
      const state = window as typeof window & {
        __oldNotificationFetch?: Promise<void>;
      };
      state.__oldNotificationFetch = store.fetchRecent();
    });
    await firstRequested;

    await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      store.setSession("user-b");
      await store.fetchRecent();
    });
    releaseFirst();
    await page.evaluate(async () => {
      const state = window as typeof window & {
        __oldNotificationFetch?: Promise<void>;
      };
      await state.__oldNotificationFetch;
    });

    const state = await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      return {
        sessionUserId: store.sessionUserId,
        ids: store.notifications.map((item: Notification) => item.id),
      };
    });
    expect(state).toEqual({
      sessionUserId: "user-b",
      ids: ["notification-user-b"],
    });
  });

  test("resets notification state synchronously when auth logs out", async ({
    page,
  }) => {
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [notificationItem({ id: "logout-notification" })],
          }),
        ),
      }),
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    await expect(
      page.getByTestId("notification-item-logout-notification"),
    ).toBeVisible();

    const state = await page.evaluate(async () => {
      const authModulePath = "/src/stores/auth.store.ts";
      const notificationModulePath = "/src/stores/notification.store.ts";
      const [{ useAuthStore }, { useNotificationStore }] = await Promise.all([
        import(authModulePath),
        import(notificationModulePath),
      ]);
      const auth = useAuthStore();
      const store = useNotificationStore();
      const beforeGeneration = store.generation;
      auth.logout();
      return {
        beforeGeneration,
        generation: store.generation,
        sessionUserId: store.sessionUserId,
        unreadCount: store.unreadCount,
        notifications: store.notifications.length,
      };
    });
    expect(state.sessionUserId).toBeNull();
    expect(state.generation).toBeGreaterThan(state.beforeGeneration);
    expect(state).toMatchObject({ unreadCount: 0, notifications: 0 });
  });

  test("does not let an old unread poll overwrite an authoritative mark response", async ({
    page,
  }) => {
    const item = notificationItem({ id: "poll-race", userId: "poll-user" });
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 2 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ total: 0, page: 1, pageSize: 10, items: [] }),
        ),
      }),
    );
    await page.route("**/api/v1/notifications/poll-race/read", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            ...item,
            isRead: true,
            readAt: "2026-08-09T12:00:00.000Z",
            unreadCount: 1,
          }),
        ),
      }),
    );
    await page.goto("/tasks");

    await page.unroute("**/api/v1/notifications/unread-count");
    let releasePoll!: () => void;
    let announcePoll!: () => void;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const pollRequested = new Promise<void>((resolve) => {
      announcePoll = resolve;
    });
    await page.route("**/api/v1/notifications/unread-count", async (route) => {
      announcePoll();
      await pollGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 8 })),
      });
    });

    await page.evaluate(async (seed) => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      store.setSession(seed.userId);
      store.$patch({ unreadCount: 2, notifications: [seed] });
      const state = window as typeof window & {
        __oldUnreadPoll?: Promise<number>;
      };
      state.__oldUnreadPoll = store.fetchUnreadCount();
    }, item);
    await pollRequested;
    await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      await useNotificationStore().markAsRead("poll-race");
    });
    releasePoll();
    await page.evaluate(async () => {
      const state = window as typeof window & {
        __oldUnreadPoll?: Promise<number>;
      };
      await state.__oldUnreadPoll;
    });

    const state = await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      return { unreadCount: store.unreadCount, item: store.notifications[0] };
    });
    expect(state.unreadCount).toBe(1);
    expect(state.item).toMatchObject({
      isRead: true,
      readAt: "2026-08-09T12:00:00.000Z",
    });
  });

  test("retains the previous unread count and exposes a failed unread request", async ({
    page,
  }) => {
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.goto("/tasks");
    await page.unroute("**/api/v1/notifications/unread-count");
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({ status: 500, body: "failed" }),
    );

    const state = await page.evaluate(async () => {
      const storeModulePath = "/src/stores/notification.store.ts";
      const { useNotificationStore } = await import(storeModulePath);
      const store = useNotificationStore();
      store.unreadCount = 7;
      let rejected = false;
      try {
        await store.fetchUnreadCount();
      } catch {
        rejected = true;
      }
      return {
        rejected,
        unreadCount: store.unreadCount,
        unreadError: store.unreadError,
      };
    });
    expect(state.rejected).toBe(true);
    expect(state.unreadCount).toBe(7);
    expect(state.unreadError).toEqual(expect.any(String));
  });

  test("uses authoritative mark-all time and unread count from the server", async ({
    page,
  }) => {
    const serverReadAt = "2026-08-09T13:00:00.000Z";
    const items = [
      notificationItem({ id: "mark-all-1" }),
      notificationItem({ id: "mark-all-2" }),
    ];
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 0 })),
      }),
    );
    await page.route("**/api/v1/notifications/read-all", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({ marked: 2, readAt: serverReadAt, unreadCount: 1 }),
        ),
      }),
    );
    await page.goto("/tasks");

    const state = await page.evaluate(
      async ({ readAt, seedItems }) => {
        const storeModulePath = "/src/stores/notification.store.ts";
        const { useNotificationStore } = await import(storeModulePath);
        const store = useNotificationStore();
        store.$patch({
          unreadCount: 3,
          notifications: seedItems,
        });
        const result = await store.markAllAsRead();
        return {
          result,
          unreadCount: store.unreadCount,
          rows: store.notifications.map((item: Notification) => ({
            isRead: item.isRead,
            readAt: item.readAt,
          })),
          readAt,
        };
      },
      { readAt: serverReadAt, seedItems: items },
    );
    expect(state.result).toEqual({
      marked: 2,
      readAt: serverReadAt,
      unreadCount: 1,
    });
    expect(state.unreadCount).toBe(1);
    expect(state.rows).toEqual([
      { isRead: true, readAt: serverReadAt },
      { isRead: true, readAt: serverReadAt },
    ]);
  });

  test("smokes the real authenticated list and mark-one API without notification interception", async ({
    page,
  }) => {
    await page.goto("/tasks");
    const listResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/v1/notifications"
      );
    });
    await page.getByTestId("app-notifications").click();
    const listResponse = await listResponsePromise;
    expect(listResponse.ok()).toBe(true);

    const row = page.getByTestId(
      `notification-item-${E2E_ACTIONABLE_NOTIFICATION_ID}`,
    );
    await expect(row).toBeVisible();
    const markResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/v1/notifications/${E2E_ACTIONABLE_NOTIFICATION_ID}/read`,
    );
    await row.click();
    const markResponse = await markResponsePromise;
    expect(markResponse.ok()).toBe(true);
    const body = await markResponse.json();
    expect(body.data).toMatchObject({
      id: E2E_ACTIONABLE_NOTIFICATION_ID,
      channel: "dingtalk",
      status: "sent",
      isRead: true,
    });
  });

  test("keeps the notification popover inside a 390px viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/v1/notifications/unread-count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiResponse({ count: 1 })),
      }),
    );
    await page.route("**/api/v1/notifications?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          apiResponse({
            total: 1,
            page: 1,
            pageSize: 10,
            items: [
              notificationItem({
                id: "notification-mobile",
                taskId: "task-mobile",
                type: "indicator_setting_notice",
              }),
            ],
          }),
        ),
      }),
    );

    await page.goto("/tasks");
    await page.getByTestId("app-notifications").click();
    await expect(
      page.getByTestId("notification-item-notification-mobile"),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const popover = document
        .querySelector(".notification-popover")
        ?.parentElement?.getBoundingClientRect();
      return {
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        left: popover?.left,
        right: popover?.right,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: "../.superpowers/sdd/2026-08-08-navigation-dashboard-notifications/task-4-mobile.png",
      fullPage: true,
    });
  });
});
