import { test, expect, type Page } from '@playwright/test';

// Synthetic API responses verify presentation only; they do not establish employee business state.
const original = { id: 'employment-candidate', name: '虚构任职状态人才', phone: '17000000000', editVersion: 'v1',
  status: 'hired', convertedUserId: 'linked-employee', convertedAt: '2026-01-01T00:00:00Z', employmentStatus: 'resigned',
  latestApplication: { positionName: '虚构历史岗位', stage: 'hired' },
  sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], updatedAt: '2026-11-20T00:00:00Z' };
const historicalApplication = { id: 'historical-application', candidateId: original.id, positionName: '虚构历史岗位', stage: 'hired',
  ownerId: 'hr', ownerName: '虚构HR', revision: 0, allowedActions: [], events: [], onboardingRequest: null };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });

async function install(page: Page) {
  let candidate: Record<string, unknown> = { ...original };
  await page.addInitScript(() => { localStorage.setItem('token', 'fictional-employment-ui'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr', name: '虚构HR', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [candidate], total: 1 }));
    if (path.endsWith(`/talents/${original.id}`)) return route.fulfill(envelope(candidate));
    if (path.endsWith('/applications')) return route.fulfill(envelope([historicalApplication]));
    return route.fulfill(envelope([]));
  });
  return (changes: Record<string, unknown>) => { candidate = { ...candidate, ...changes }; };
}

async function openDetail(page: Page, width: number, employeeLabel: string | null) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/talents');
  const rows = width <= 768 ? page.locator('.mobile-result-card') : page.locator('.app-table');
  if (employeeLabel) await expect(rows.getByText(employeeLabel, { exact: true })).toBeVisible();
  else await expect(rows.getByText(/^员工(已离职|在职|关联待核对|试用|待入职)$/)).toHaveCount(0);
  if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(original.name, { exact: true }).first().click();
  return page.locator('.talent-detail-drawer');
}

for (const width of [1440, 390]) {
  test(`current employment changes after reentry while the hired history remains at ${width}px (mock)`, async ({ page }, info) => {
    const change = await install(page);
    let detail = await openDetail(page, width, '员工已离职');
    await expect(detail.getByTestId('talent-current-employment')).toHaveText('员工当前：已离职');
    await expect(detail.locator('.talent-detail__badges').getByText('人才库状态：已入职', { exact: true })).toBeVisible();
    await expect(detail.locator('.application-panel__stage')).toHaveText('已入职');
    await expect(detail).toContainText('办理入职');
    expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('current-employment.png'), fullPage: true, animations: 'disabled' });
    change({ employmentStatus: 'active' });
    await page.reload();
    detail = await openDetail(page, width, '员工在职');
    await expect(detail.getByTestId('talent-current-employment')).toHaveText('员工当前：在职');
    await expect(detail.locator('.talent-detail__badges').getByText('人才库状态：已入职', { exact: true })).toBeVisible();
    await expect(detail.locator('.application-panel__stage')).toHaveText('已入职');
  });

  test(`a hired record with an unavailable link requires review and an ordinary candidate has no employee badge at ${width}px (mock)`, async ({ page }) => {
    const change = await install(page);
    change({ convertedUserId: null, employmentStatus: 'unknown' });
    let detail = await openDetail(page, width, '员工关联待核对');
    await expect(detail.getByTestId('talent-current-employment')).toHaveText('员工当前：关联待核对');
    await expect(detail.locator('.talent-detail__badges').getByText('人才库状态：已入职', { exact: true })).toBeVisible();
    change({ status: 'new', employmentStatus: null });
    await page.reload();
    detail = await openDetail(page, width, null);
    await expect(detail.getByTestId('talent-current-employment')).toHaveCount(0);
  });
}
