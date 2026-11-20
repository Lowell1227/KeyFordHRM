import { test, expect, type Page } from '@playwright/test';

// Synthetic API responses: UI behavior only, never a real sharing/business acceptance.
const token = 'b'.repeat(64);
const candidate = { id: 'share-candidate', editVersion: 'v1', name: '虚构外链候选人', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], updatedAt: '2026-11-20T00:00:00Z' };
const share = { token, message: '虚构分享说明', includeResume: true, createdAt: '2026-11-20T00:00:00Z', expiresAt: '2026-12-20T00:00:00Z', candidate: { ...candidate, currentPosition: '虚构供应链岗位长文本用于移动端换行验证', statusLabel: '新建', age: 30 }, files: [{ id: 'resume', fileName: '虚构简历.pdf', fileSize: 300, mimeType: 'application/pdf' }] };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });

async function mock(page: Page, loggedIn = false) {
  const writes: Record<string, unknown>[] = [];
  const paths: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Unhandled Vue error')) errors.push(message.text()); });
  if (loggedIn) await page.addInitScript(() => { localStorage.setItem('token', 'mock-sharing-hr'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname; paths.push(path);
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr', name: '虚构HR', sysRole: 'hr', businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith(`/talents/shares/${token}`)) return route.fulfill(envelope(share));
    if (path.endsWith('/file/resume')) return route.fulfill({ contentType: 'application/pdf', body: 'synthetic pdf' });
    if (path.endsWith(`/talents/${candidate.id}/shares`)) { writes.push(request.postDataJSON()); return route.fulfill(envelope({ id: 'share', token, url: `/talents/s/${token}`, expiresAt: share.expiresAt })); }
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [candidate], total: 1 }));
    if (path.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope(candidate));
    if (path.endsWith('/applications') || path.endsWith('/follow-ups') || path.endsWith('/departments') || path.endsWith('/talent-interviews')) return route.fulfill(envelope([]));
    return route.fulfill(envelope(null));
  });
  return { writes, paths, errors };
}

for (const width of [1440, 390]) {
  test(`guest can open a share and download without management chrome at ${width}px (mock)`, async ({ page }, testInfo) => {
    const { paths, errors } = await mock(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/talents/s/${token}`);
    await expect(page.getByRole('heading', { name: candidate.name })).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(0);
    expect(paths).toEqual([`/api/v1/talents/shares/${token}`]);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('虚构简历.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('guest-share.png'), fullPage: true });
    expect(errors).toEqual([]);
  });

  test(`HR creates an external link without choosing recipients, resume defaults off at ${width}px (mock)`, async ({ page }, testInfo) => {
    const { writes, errors } = await mock(page, true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/talents');
    if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
    else await page.getByText(candidate.name, { exact: true }).first().click();
    await page.getByRole('button', { name: '转发', exact: true }).click();
    const drawer = page.locator('.talent-share-drawer');
    await expect(drawer).toContainText('持有链接的人无需登录即可查看');
    await expect(drawer.getByTestId('talent-share-recipients')).toHaveCount(0);
    await expect(drawer.getByRole('switch')).not.toBeChecked();
    await drawer.getByText('30 天', { exact: true }).click();
    await drawer.getByRole('button', { name: '生成分享链接', exact: true }).click();
    await expect(drawer.locator('.talent-share__result-url')).toContainText(`/talents/s/${token}`);
    expect(writes[0]).toMatchObject({ isPublicLink: true, expiresInDays: 30, includeResume: false });
    expect(writes[0]).not.toHaveProperty('recipientIds');
    await expect(drawer.getByRole('radio', { name: '30 天', exact: true })).toBeChecked();
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('share-drawer.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('invalid share stays on a neutral guest failure page without candidate details (mock)', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: '链接已失效或无权查看' }) }));
  await page.goto(`/talents/s/${token}`);
  await expect(page.getByRole('heading', { name: '链接已失效或无权查看' })).toBeVisible();
  await expect(page.locator('.talent-shared')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/talents/s/${token}$`));
});
