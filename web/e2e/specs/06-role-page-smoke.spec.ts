import { expect, test, type Page } from '@playwright/test';

async function expectPageHealthy(page: Page, path: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
  const body = await page.locator('body').innerText();

  expect(body.trim().length).toBeGreaterThan(0);
  expect(body).not.toContain('Cannot GET');
  expect(body).not.toContain('Cannot POST');
  expect(body).not.toContain('undefined is not');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => /ElementPlusError|TypeError|ReferenceError/i.test(text))).toEqual([]);
}

test.describe('06-role-page-smoke employee', () => {
  test.use({ storageState: 'e2e/auth-state/employee.json' });

  for (const path of ['/dashboard', '/tasks', '/probation-reviews/mine', '/confirmation-applications/mine', '/improvement-plans']) {
    test(`employee page works: ${path}`, async ({ page }) => {
      await expectPageHealthy(page, path);
    });
  }
});

test.describe('06-role-page-smoke manager', () => {
  test.use({ storageState: 'e2e/auth-state/manager.json' });

  for (const path of ['/dashboard', '/manager/scoring', '/objectives', '/action-items', '/interviews', '/probation-reviews/manager']) {
    test(`manager page works: ${path}`, async ({ page }) => {
      await expectPageHealthy(page, path);
    });
  }
});

test.describe('06-role-page-smoke HR', () => {
  test.use({ storageState: 'e2e/auth-state/hr.json' });

  for (const path of [
    '/dashboard',
    '/cycles',
    '/templates',
    '/indicators',
    '/calibration',
    '/publish',
    '/reports',
    '/appeals',
    '/users',
    '/probation-reviews/manage',
    '/confirmation-applications/manage',
    '/objectives',
  ]) {
    test(`HR page works: ${path}`, async ({ page }) => {
      await expectPageHealthy(page, path);
    });
  }
});

test.describe('06-role-page-smoke approver', () => {
  test.use({ storageState: 'e2e/auth-state/approver.json' });

  for (const path of ['/dashboard', '/approval', '/reports', '/confirmation-applications/approvals']) {
    test(`approver page works: ${path}`, async ({ page }) => {
      await expectPageHealthy(page, path);
    });
  }
});
