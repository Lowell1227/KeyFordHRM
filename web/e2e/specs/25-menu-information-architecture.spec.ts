import { expect, test } from '@playwright/test';

test.describe('25-menu-information-architecture recruitment boundary', () => {
  test.describe('system administrator', () => {
    test.use({ storageState: 'e2e/auth-state/admin.json' });

    test('opens recruitment demands by default and keeps planning separate and read-only', async ({ page }) => {
      await page.goto('/recruitment');

      await expect(page).toHaveURL(/\/recruitment\/demands(?:\?|$)/);
      await expect(page.getByTestId('nav-module-recruitment')).toHaveClass(/is-active/);
      await expect(page.getByTestId('module-status-recruitment')).toHaveCount(0);
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '招聘需求', exact: true })).toHaveClass(/is-active/);

      await page.goto('/recruitment/planning');
      await expect(page).toHaveURL(/\/recruitment\/planning$/);
      await expect(page.getByTestId('app-route-title')).toHaveText('招聘建设规划');
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '建设规划', exact: true })).toHaveClass(/is-active/);
      const planning = page.getByTestId('recruitment-planning');
      await expect(planning.getByText('未立项 · 未排期', { exact: true })).toBeVisible();
      await expect(planning.getByRole('heading', { name: '当前已可用', exact: true })).toBeVisible();
      await expect(planning.getByRole('heading', { name: '尚未立项', exact: true })).toBeVisible();
      await expect(planning.getByRole('button')).toHaveCount(0);
      await expect(planning.locator('input, textarea, select')).toHaveCount(0);

      await page.goto('/talent-hiring');
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });

  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('can use recruitment but cannot see or open recruitment planning', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByTestId('nav-module-recruitment')).toBeVisible();

      await page.goto('/recruitment');
      await expect(page).toHaveURL(/\/recruitment\/demands(?:\?|$)/);
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '人才库', exact: true })).toBeVisible();
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '应聘与面试', exact: true })).toBeVisible();
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '录用确认', exact: true })).toBeVisible();
      await expect(page.locator('.app-sidebar').getByRole('button', { name: '建设规划', exact: true })).toHaveCount(0);

      await page.goto('/recruitment/planning');
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });

  test.describe('ordinary interviewer', () => {
    test.use({ storageState: 'e2e/auth-state/employee.json' });

    test('keeps the personal interview deep link without granting recruitment-wide access', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByTestId('nav-module-recruitment')).toHaveCount(0);
      for (const path of ['/recruitment', '/recruitment/planning', '/talents', '/talent-hiring']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/dashboard$/);
      }
      await page.goto('/talent-interviews');
      await expect(page).toHaveURL(/\/talent-interviews(?:\?|$)/);
      await expect(page.getByTestId('app-route-title')).toHaveText('应聘与面试');
      await expect(page.getByTestId('nav-module-recruitment')).toHaveCount(0);
    });
  });
});

test.describe('25-menu-information-architecture compensation boundary', () => {
  test.describe('system administrator', () => {
    test.use({ storageState: 'e2e/auth-state/admin.json' });

    test('shows a paused planning page without salary operations', async ({ page }) => {
      await page.goto('/compensation');

      await expect(page).toHaveURL(/\/compensation$/);
      await expect(page.getByTestId('app-route-title')).toHaveText('薪酬规划');
      await expect(page.getByText('已暂缓', { exact: true })).toBeVisible();
      await expect(page.getByText('当前不开发工资核算与发放能力')).toBeVisible();
      const overview = page.getByTestId('compensation-overview');
      await expect(overview.getByRole('button')).toHaveCount(0);
      await expect(overview.locator('input, textarea, select')).toHaveCount(0);
    });

    test('marks compensation as planned and keeps the mobile rail usable', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');

      await expect(page.getByTestId('nav-module-compensation')).toBeVisible();
      await expect(page.getByTestId('module-status-compensation')).toHaveText('规划中');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('cannot open compensation before a dedicated permission exists', async ({ page }) => {
      await page.goto('/compensation');

      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});

test.describe('25-menu-information-architecture system capability overview', () => {
  test.describe('HR', () => {
    test.use({ storageState: 'e2e/auth-state/hr.json' });

    test('shows current and missing system capabilities without fake actions', async ({ page }) => {
      const writes: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/v1/')
          && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });
      await page.goto('/system');

      await expect(page).toHaveURL(/\/system$/);
      await expect(page.getByTestId('app-route-title')).toHaveText('系统管理');
      await expect(page.getByRole('heading', { name: '系统概览', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '系统能力总览', exact: true })).toHaveCount(0);
      await page.getByTestId('system-overview').locator('summary').click();
      const overview = page.getByRole('region', { name: '系统能力状态' });
      const requiredCapabilities = [
        '账户与系统角色', '数据权限', '钉钉登录与身份绑定',
        'OA 审批读取与事件订阅', '考勤结果读取', '站内通知',
        '钉钉工作通知', '钉钉待办', '钉钉面试日程', '钉钉日志读取',
        '审计与留痕', '人事基础资料', '系统监控', '人才库与招聘流转',
        '招聘编制、职位发布与 Offer', '薪酬核算与独立权限',
      ];
      for (const name of requiredCapabilities) {
        await expect(overview.getByText(name, { exact: true })).toHaveCount(1);
        await expect(overview.getByText(name, { exact: true })).toBeVisible();
      }
      const labels = await overview.locator('.capability-name').allTextContents();
      expect(new Set(labels).size).toBe(labels.length);
      for (const [name, status] of [
        ['人事基础资料', '部分可用'],
        ['人才库与招聘流转', '可用'],
        ['招聘编制、职位发布与 Offer', '已暂缓'],
        ['薪酬核算与独立权限', '隔离预览'],
      ]) {
        await expect(overview.getByTestId('system-capability-status').filter({
          has: page.getByText(name, { exact: true }),
        }).locator('.status-tag')).toHaveText(status);
      }
      const refresh = overview.getByRole('button', { name: '重新读取钉钉通知状态', exact: true });
      await expect(overview.getByRole('button')).toHaveCount(1);
      await expect(overview.locator('input, textarea, select')).toHaveCount(0);
      await expect(refresh).toBeEnabled();
      const read = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/v1/notification-settings/dingtalk');
      await refresh.click();
      await read;
      await expect(refresh).toBeEnabled();
      expect(writes).toEqual([]);
    });
  });

  test.describe('employee', () => {
    test.use({ storageState: 'e2e/auth-state/employee.json' });

    test('cannot open the system overview', async ({ page }) => {
      await page.goto('/system');

      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});
