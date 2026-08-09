import { expect, test, type Page } from "@playwright/test";

async function expectRedirectedToDashboard(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectMobileHealthy(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => null);

  const bodyText = await page.locator("body").innerText();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

  expect(bodyText.trim().length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(overflow).toBeLessThanOrEqual(8);
  await expect(page.getByTestId("header-user-menu")).toBeVisible();
  await expect(page.getByTestId("app-notifications")).toBeVisible();
}

test.describe("08-rbac-responsive employee RBAC", () => {
  test.use({ storageState: "e2e/auth-state/employee.json" });

  for (const path of [
    "/cycles",
    "/templates",
    "/indicators",
    "/calibration",
    "/publish",
    "/reports",
    "/users",
    "/objectives",
  ]) {
    test(`employee is blocked from ${path}`, async ({ page }) => {
      await expectRedirectedToDashboard(page, path);
    });
  }
});

test.describe("08-rbac-responsive manager RBAC", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  for (const path of [
    "/cycles",
    "/templates",
    "/indicators",
    "/calibration",
    "/publish",
    "/users",
  ]) {
    test(`manager is blocked from ${path}`, async ({ page }) => {
      await expectRedirectedToDashboard(page, path);
    });
  }
});

test.describe("08-rbac-responsive mobile pages", () => {
  test.use({ storageState: "e2e/auth-state/hr.json" });

  for (const path of [
    "/dashboard",
    "/cycles",
    "/templates",
    "/reports",
    "/objectives",
  ]) {
    test(`HR mobile page is usable: ${path}`, async ({ page }) => {
      await expectMobileHealthy(page, path);
    });
  }
});

test.describe("08-rbac-responsive employee mobile pages", () => {
  test.use({ storageState: "e2e/auth-state/employee.json" });

  for (const path of ["/dashboard", "/tasks"]) {
    test(`employee mobile page is usable: ${path}`, async ({ page }) => {
      await expectMobileHealthy(page, path);
    });
  }
});

test.describe("08-rbac-responsive manager mobile pages", () => {
  test.use({ storageState: "e2e/auth-state/manager.json" });

  for (const path of ["/dashboard", "/tasks?scope=team&stage=goal-review"]) {
    test(`manager mobile page is usable: ${path}`, async ({ page }) => {
      await expectMobileHealthy(page, path);
    });
  }
});
