import { test, expect, type Page } from '@playwright/test';
import { routes } from '../../src/router/routes';
import { buildNavigation, canAccessRoute } from '../../src/router/navigation';

const response = (data: unknown) => ({ code: 0, message: 'success', data });
test('one basic-data menu preserves HR boundaries and rejects employee capability spoofing', () => {
  const route = routes.find(row => row.path === '/basic-data');
  expect(route).toBeTruthy();
  const editor = { sysRole: 'hr_user' as const, hrCapabilities: ['employee_archive_edit' as const] };
  expect(canAccessRoute(route!, editor)).toBe(true);
  expect(canAccessRoute(route!, { sysRole: 'employee', hrCapabilities: ['employee_archive_edit'] })).toBe(false);
  const navigation = JSON.stringify(buildNavigation(routes, editor));
  expect(navigation.match(/"label":"基础资料"/g)).toHaveLength(1);
  expect(navigation).not.toContain('"label":"合同主体维护"');
  expect(navigation).not.toContain('"label":"岗位目录"');
});

async function setup(page: Page, capabilities = ['employee_archive_edit'], sysRole = 'hr_user') {
  const requests: string[] = [];
  await page.addInitScript(() => { localStorage.setItem('token', 'synthetic'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 'synthetic-hr', name: '合成HR', sysRole, hrCapabilities: capabilities };
    else if (path.includes('/notifications/')) data = path.endsWith('/unread-count') ? 0 : [];
    else if (path.endsWith('/personnel-reference-data/work_location')) data = [{ id: 'location-1', kind: 'work_location', name: '合成杭州办公点', isActive: true }];
    else if (path.endsWith('/personnel-reference-data/job_family')) data = [{ id: 'family-1', kind: 'job_family', name: '合成运营职系', isActive: true }];
    else if (path.endsWith('/contract-subjects')) data = [{ id: 'subject-1', name: '合成合同主体', isActive: true }];
    return route.fulfill({ json: response(data) });
  });
  return requests;
}

for (const width of [1440, 1024, 390]) test(`basic-data tabs retain filters and support old URLs at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 });
  await setup(page);
  await page.goto('/basic-data?tab=work-locations');
  await expect(page.getByRole('tab', { name: '工作地点', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('合成杭州办公点', { exact: true }).filter({ visible: true })).toBeVisible();
  const search = page.getByRole('textbox').first();
  await search.fill('合成杭州');
  await page.getByRole('tab', { name: '职系', exact: true }).click();
  await expect(page.getByText('合成运营职系', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('合成杭州');
  await expect(page.locator('[data-testid="business-list-page"]:visible')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goto('/contract-subjects');
  await expect(page).toHaveURL(/\/basic-data\?tab=contract-subjects$/);
  await expect(page.getByText('合成合同主体', { exact: true }).filter({ visible: true })).toBeVisible();
  if (width === 390) await expect(page.locator('.mobile-result-card').filter({ hasText: '合成合同主体' }).locator('.mobile-result-card__status')).toContainText('启用');
  await page.screenshot({ path: `../tmp/personnel-basic-data-20261030/basic-data-${width}.png` });
});

test('organization-only HR can read job families and positions without contract or location access', async ({ page }) => {
  const requests = await setup(page, ['organization_edit']);
  await page.goto('/basic-data?tab=contract-subjects');
  await expect(page.getByRole('tab', { name: '职系', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '工作地点', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '合同主体', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增职系', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '岗位', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增岗位', exact: true })).toBeVisible();
  expect(requests).not.toContain('/api/v1/contract-subjects');
  expect(requests).not.toContain('/api/v1/personnel-reference-data/work_location');
});

test('review-only HR sees catalogs without maintenance or position write actions', async ({ page }) => {
  await setup(page, ['employee_archive_review']);
  await page.goto('/positions');
  await expect(page).toHaveURL(/\/basic-data\?tab=positions$/);
  await expect(page.getByRole('button', { name: '新增岗位', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '职系', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增职系', exact: true })).toHaveCount(0);
});
