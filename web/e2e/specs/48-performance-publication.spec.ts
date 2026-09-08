import { expect, test, type Page, type Route } from "@playwright/test";

const cycleA = "11111111-1111-4111-8111-111111111111";
const cycleB = "22222222-2222-4222-8222-222222222222";

function ok(route: Route, data: unknown) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "success", data }),
  });
}

async function authenticate(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("token", "publication-ui-fixture");
    localStorage.setItem("expiresAt", String(Date.now() + 600_000));
  });
}

for (const width of [1440, 390]) {
  test(`公示台保留历史、遮罩本人结果并按通知开关确认 ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await authenticate(page);
    const requests: Array<{ path: string; query: string; body?: unknown }> = [];
    let finishPublish!: () => void;
    const publishFinished = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });

    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : undefined;
      requests.push({ path: url.pathname, query: url.search, body });
      if (url.pathname.endsWith("/auth/me"))
        return ok(route, {
          id: "admin",
          name: "系统管理员",
          sysRole: "system_admin",
          status: "active",
          canViewAll: true,
          hrCapabilities: ["performance_publish"],
          businessCapabilities: { identities: [] },
        });
      if (url.pathname.endsWith("/notifications/unread-count"))
        return ok(route, 0);
      if (url.pathname === "/api/v1/cycles")
        return ok(route, {
          items: [
            {
              id: cycleA,
              name: "2026 Q3",
              type: "quarterly",
              status: "approval",
              startDate: "2026-07-01",
              endDate: "2026-09-30",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        });
      if (
        url.pathname === `/api/v1/cycles/${cycleA}/publication-records` &&
        route.request().method() === "GET"
      ) {
        return ok(route, {
          total: 5,
          page: 1,
          pageSize: 20,
          items: [
            {
              taskId: "pending",
              cycleId: cycleA,
              cycleName: "2026 Q3",
              employeeId: "employee-1",
              employeeName: "待审批员工",
              employeeNo: "E001",
              deptName: "咨询部",
              position: "顾问",
              status: "approval",
              publicationState: "pending_approval",
              canPublish: false,
              resultMasked: false,
              totalScore: 78,
              rawGrade: "C",
              calibratedGrade: "C",
              approvedAt: null,
              publishedAt: null,
              employeeConfirmedAt: null,
              updatedAt: "2026-09-01T00:00:00Z",
            },
            {
              taskId: "ready",
              cycleId: cycleA,
              cycleName: "2026 Q3",
              employeeId: "employee-2",
              employeeName: "待公示员工",
              employeeNo: "E002",
              deptName: "咨询部",
              position: "经理",
              status: "approval",
              publicationState: "ready_to_publish",
              canPublish: true,
              resultMasked: false,
              totalScore: 88,
              rawGrade: "B",
              calibratedGrade: "A",
              approvedAt: "2026-09-02T00:00:00Z",
              publishedAt: null,
              employeeConfirmedAt: null,
              updatedAt: "2026-09-02T00:00:00Z",
            },
            {
              taskId: "own-ready",
              cycleId: cycleA,
              cycleName: "2026 Q3",
              employeeId: "admin",
              employeeName: "系统管理员",
              employeeNo: "E003",
              deptName: "管理部",
              position: "管理员",
              status: "approval",
              publicationState: "ready_to_publish",
              canPublish: true,
              resultMasked: true,
              totalScore: null,
              rawGrade: null,
              calibratedGrade: null,
              approvedAt: "2026-09-02T00:00:00Z",
              publishedAt: null,
              employeeConfirmedAt: null,
              updatedAt: "2026-09-02T00:00:00Z",
            },
            {
              taskId: "published",
              cycleId: cycleA,
              cycleName: "2026 Q3",
              employeeId: "employee-4",
              employeeName: "已公示员工",
              employeeNo: "E004",
              deptName: "交付部",
              position: "顾问",
              status: "published",
              publicationState: "published",
              canPublish: false,
              resultMasked: false,
              totalScore: 92,
              rawGrade: "A",
              calibratedGrade: "A",
              approvedAt: "2026-09-01T00:00:00Z",
              publishedAt: "2026-09-03T00:00:00Z",
              employeeConfirmedAt: null,
              updatedAt: "2026-09-03T00:00:00Z",
            },
            {
              taskId: "closed",
              cycleId: cycleA,
              cycleName: "2026 Q3",
              employeeId: "employee-5",
              employeeName: "已归档员工",
              employeeNo: "E005",
              deptName: "交付部",
              position: "顾问",
              status: "closed",
              publicationState: "closed",
              canPublish: false,
              resultMasked: false,
              totalScore: 86,
              rawGrade: "B",
              calibratedGrade: "B",
              approvedAt: "2026-09-01T00:00:00Z",
              publishedAt: "2026-09-03T00:00:00Z",
              employeeConfirmedAt: "2026-09-04T00:00:00Z",
              updatedAt: "2026-09-05T00:00:00Z",
            },
          ],
        });
      }
      if (
        url.pathname ===
        `/api/v1/cycles/${cycleA}/publication-records/published`
      )
        return ok(route, {
          taskId: "published",
          cycleId: cycleA,
          cycleName: "2026 Q3",
          employeeId: "employee-4",
          employeeName: "已公示员工",
          employeeNo: "E004",
          deptName: "交付部",
          position: "顾问",
          managerName: "直属上级甲",
          status: "published",
          publicationState: "published",
          canPublish: false,
          resultMasked: false,
          totalScore: 92,
          rawGrade: "A",
          calibratedGrade: "A",
          approvedAt: "2026-09-01T00:00:00Z",
          publishedAt: "2026-09-03T00:00:00Z",
          employeeConfirmedAt: null,
          updatedAt: "2026-09-03T00:00:00Z",
          flowRecords: [
            {
              id: "flow-1",
              nodeType: "approval",
              action: "approve",
              actorName: "审批人乙",
              comment: "同意公示",
              extraData: null,
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
        });
      if (url.pathname === `/api/v1/cycles/${cycleA}/publish`) {
        await publishFinished;
        return ok(route, {
          cycleId: cycleA,
          published: 1,
          publishedAt: "2026-09-08T00:00:00Z",
          deadlineAppeal: "2026-10-08",
        });
      }
      if (url.pathname.endsWith("/tasks/mine"))
        return ok(route, { items: [], total: 0 });
      return ok(route, []);
    });

    await page.goto(`/publish?cycleId=${cycleA}`);
    await expect(page.getByText("待审批员工")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "待审批员工" }),
    ).toContainText("待审批");
    await expect(
      page.getByRole("row").filter({ hasText: "待公示员工" }),
    ).toContainText("待公示");
    await expect(
      page.getByRole("row").filter({ hasText: "已公示员工" }),
    ).toContainText("已公示");
    await expect(
      page.getByRole("row").filter({ hasText: "已归档员工" }),
    ).toContainText("已归档");
    await expect(
      page.getByRole("row").filter({ hasText: "系统管理员" }),
    ).toContainText("公示前不可查看本人结果");
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "待审批员工" })
        .getByRole("checkbox"),
    ).toBeDisabled();
    await page
      .getByRole("row")
      .filter({ hasText: "待公示员工" })
      .locator(".el-checkbox")
      .click();
    await page.getByRole("button", { name: "发布公示", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("不会发送钉钉通知");
    await expect(dialog).toContainText("2026 Q3");
    await expect(
      page.getByTestId("publish-cycle-select").getByRole("combobox"),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "确认公示", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "发布公示", exact: true }),
    ).toBeDisabled();
    finishPublish();
    await expect(dialog).toBeHidden();

    const publishCall = requests.find((request) =>
      request.path.endsWith("/publish"),
    );
    expect(publishCall?.body).toEqual({
      taskIds: ["ready"],
      sendDingtalkNotification: false,
    });
    expect(
      requests.find((request) => request.path === "/api/v1/cycles")?.query,
    ).toContain("purpose=publish");
    expect(
      requests.find((request) => request.path === "/api/v1/cycles")?.query,
    ).toContain("pageSize=100");

    await page
      .getByRole("row")
      .filter({ hasText: "已公示员工" })
      .getByRole("button", { name: "详情", exact: true })
      .click();
    await expect(page.getByTestId("performance-result-summary")).toContainText(
      "92",
    );
    await expect(page.getByTestId("review-history")).toContainText("同意公示");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("performance-publication.png"),
      fullPage: true,
    });
  });
}

test("切换周期后较早请求不会覆盖当前公示列表", async ({ page }) => {
  await authenticate(page);
  let releaseCycleA!: () => void;
  const cycleAReleased = new Promise<void>((resolve) => {
    releaseCycleA = resolve;
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me"))
      return ok(route, {
        id: "hr",
        name: "HR",
        sysRole: "hr",
        status: "active",
        canViewAll: true,
        businessCapabilities: { identities: [] },
      });
    if (url.pathname.endsWith("/notifications/unread-count"))
      return ok(route, 0);
    if (url.pathname === "/api/v1/cycles") {
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      const item =
        requestedPage === 1
          ? {
              id: cycleA,
              name: "周期甲",
              type: "quarterly",
              status: "approval",
              startDate: "2026-01-01",
              endDate: "2026-03-31",
            }
          : {
              id: cycleB,
              name: "周期乙",
              type: "quarterly",
              status: "approval",
              startDate: "2026-04-01",
              endDate: "2026-06-30",
            };
      return ok(route, {
        items: [item],
        total: 2,
        page: requestedPage,
        pageSize: 100,
      });
    }
    if (url.pathname === `/api/v1/cycles/${cycleA}/publication-records`) {
      await cycleAReleased;
      return ok(route, {
        items: [
          {
            taskId: "old",
            cycleId: cycleA,
            cycleName: "周期甲",
            employeeId: "old",
            employeeName: "甲周期旧结果",
            status: "published",
            publicationState: "published",
            canPublish: false,
            resultMasked: false,
            totalScore: 70,
            rawGrade: "C",
            calibratedGrade: "C",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    }
    if (url.pathname === `/api/v1/cycles/${cycleB}/publication-records`)
      return ok(route, {
        items: [
          {
            taskId: "current",
            cycleId: cycleB,
            cycleName: "周期乙",
            employeeId: "current",
            employeeName: "乙周期当前结果",
            status: "published",
            publicationState: "published",
            canPublish: false,
            resultMasked: false,
            totalScore: 90,
            rawGrade: "A",
            calibratedGrade: "A",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    if (url.pathname.endsWith("/tasks/mine"))
      return ok(route, { items: [], total: 0 });
    return ok(route, []);
  });

  await page.goto(`/publish?cycleId=${cycleA}`);
  await page.getByTestId("publish-cycle-select").click();
  await page.getByRole("option", { name: "周期乙" }).click();
  await expect(page.getByText("乙周期当前结果")).toBeVisible();
  releaseCycleA();
  await page.waitForTimeout(100);
  await expect(page.getByText("乙周期当前结果")).toBeVisible();
  await expect(page.getByText("甲周期旧结果")).toHaveCount(0);
});
