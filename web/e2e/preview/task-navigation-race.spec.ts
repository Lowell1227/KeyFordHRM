import { test, expect } from '@playwright/test';

for (const destination of ['mine', 'changes']) {
  test(`late performance cycle response preserves navigation to ${destination}`, async ({ page }, info) => {
    const origin = new URL(String(info.project.use.baseURL));
    expect(['localhost', '127.0.0.1']).toContain(origin.hostname);
    const login = await page.request.post('/api/v1/auth/test-login', { data: { employeeNo: 'HR001' } });
    expect(login.ok()).toBe(true);
    const token = (await login.json()).data.token;
    await page.goto('/login');
    await page.evaluate(value => {
      localStorage.setItem('token', value);
      localStorage.setItem('expiresAt', String(Date.now() + 3500000));
    }, token);
    await page.goto('/dashboard');
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/v1/cycles/mine', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      started(); await held; await route.fulfill({ response });
    });
    await page.goto('/tasks'); await reading;
    const navigation = page.getByRole('navigation', { name: '绩效任务视图', exact: true });
    try {
      const target = navigation.locator(`[data-section="${destination}"]`);
      await expect(target).toBeVisible(); await target.click();
      await expect(target).toHaveAttribute('aria-current', 'page');
    } finally { release(); }
    await expect(page).toHaveURL(destination === 'mine' ? /\/tasks\?goalView=mine$/ : /\/goal-changes$/);
    await page.waitForTimeout(500);
    await expect(navigation.locator(`[data-section="${destination}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(destination === 'mine' ? /\/tasks\?goalView=mine$/ : /\/goal-changes$/);
    await page.screenshot({ path: info.outputPath(`late-cycle-${destination}.png`), fullPage: true });
  });
}
