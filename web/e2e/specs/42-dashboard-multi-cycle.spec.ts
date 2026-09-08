import { expect, test, type Page, type Route } from '@playwright/test';
import type { AssessmentCycle, TaskListItem } from '../../src/types/api.types';

const cycle = (id: string, name: string, status: AssessmentCycle['status'] = 'in_progress') => ({
  id, name, status, type: 'quarterly', planVersion: 1, startDate: '2026-07-01', endDate: '2026-09-30',
  publishVisibleFields: {}, gradeAMaxRatio: 0.2, gradeBMaxRatio: 0.4, gradeCMaxRatio: 0.3, gradeDMaxRatio: 0.1,
} as AssessmentCycle);
const active = cycle('q3', '2026年第三季度绩效计划');
const waiting = cycle('half', '2026年下半年绩效计划');
const teamOnly = cycle('team-only', '跨部门协作专项绩效计划');
const result = cycle('published', '2026年第二季度公示结果', 'published');
const task = (id: string, plan: AssessmentCycle, status: TaskListItem['status']) => ({
  id, cycleId: plan.id, cycleName: plan.name, snapshotId: `snapshot-${id}`, employeeId: 'viewer',
  employeeName: '测试员工', status, isExempt: false, workflowVersion: 1, periods: [],
} satisfies TaskListItem);
const mine = [task('wait-task', waiting, 'approval'), task('active-task', active, 'indicator_drafting')];
const reply = (route: Route, data: unknown) => route.fulfill({
  contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data }),
});

async function mockDashboard(page: Page, options: {
  manager?: boolean;
  reports?: boolean;
  tasks?: TaskListItem[];
  cycles?: AssessmentCycle[];
  delayTeam?: Promise<void>;
  failTeamCycle?: string;
  teamCounts?: Record<string, { pending: [number, number]; completed: number }>;
} = {}) {
  const requests: URL[] = [];
  const writes: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'multi-cycle-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    requests.push(url);
    if (req.method() !== 'GET') writes.push(req.method());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, {
      id: 'viewer', name: '测试员工', sysRole: 'employee', status: 'active', deptId: 'dept',
      deptName: '研发部', position: '工程师', isAssessorOnly: false, canViewAll: false,
      businessCapabilities: {
        canManageTeam: Boolean(options.manager), canViewReports: Boolean(options.reports),
        canReviewDepartment: false, canViewPerformanceApproval: false, canOperatePerformanceApproval: false,
        canHandleHrCycle: false, canHandleInterviews: false, canHandleProbationReviews: false,
        canHandleConfirmationApprovals: false, canManageObjectives: false, identities: [],
      },
    });
    if (path === '/notifications/unread-count') return reply(route, 0);
    if (path === '/cycles/mine') return reply(route, options.cycles ?? [waiting, active, teamOnly, result]);
    if (path === '/cycles') return reply(route, { total: 1, page: 1, pageSize: 50, items: [result] });
    if (path === '/tasks/mine') {
      const all = options.tasks ?? mine;
      const pageNo = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      const filtered = url.searchParams.has('cycleId') ? all.filter((t) => t.cycleId === url.searchParams.get('cycleId')) : all;
      return reply(route, { total: filtered.length, page: pageNo, pageSize, items: filtered.slice((pageNo - 1) * pageSize, pageNo * pageSize) });
    }
    if (path === '/tasks/team') {
      if (options.delayTeam) await options.delayTeam;
      if (url.searchParams.get('cycleId') === options.failTeamCycle) return route.fulfill({ status: 503, body: '{}' });
      const cycleId = url.searchParams.get('cycleId') ?? '';
      const countsByCycle: Record<string, number[]> = { q3: [2, 1], half: [0, 3], 'team-only': [4, 0], published: [0, 0] };
      const custom = options.teamCounts?.[cycleId];
      const values = custom?.pending ?? countsByCycle[cycleId] ?? [6, 4];
      const pending = values[url.searchParams.get('stage') === 'goal-review' ? 0 : 1]!;
      const completed = custom?.completed ?? (cycleId === 'published' ? 0 : 1);
      const related = pending + completed;
      return reply(route, {
        total: related, page: 1, pageSize: 1, items: [],
        counts: { all: related, pending, notStarted: 0, completed, exempted: 0 },
        facets: { departments: [], employees: [] },
      });
    }
    if (path.includes('/reports/cycle/')) return reply(route, {
      stats: { total: 0, resulted: 0, pending: 0, qualified: 0, qualifiedRate: 0, grades: {} }, items: [],
    });
    if (path.startsWith('/tasks/')) return reply(route, {
      ...task(path.split('/')[2]!, active, 'indicator_drafting'), indicatorInstances: [], flowRecords: [],
    });
    return reply(route, []);
  });
  return { requests, writes };
}

const choose = (page: Page, id: string) => page.getByLabel('考核计划', { exact: true }).selectOption(id);

for (const status of ['published', 'appeal'] as const) {
  test(`${status} plan retains team-only pending work, then disappears after all team work completes`, async ({ page }) => {
    const plan = cycle(`mixed-${status}`, '部分人员已公示的绩效计划', status);
    let release!: () => void;
    const delayTeam = new Promise<void>((resolve) => { release = resolve; });
    const teamCounts = { [plan.id]: { pending: [0, 2] as [number, number], completed: 3 } };
    await mockDashboard(page, {
      manager: true, cycles: [plan], delayTeam, teamCounts,
      tasks: status === 'published' ? [] : [task('my-confirmed-task', plan, 'confirmed')],
    });
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
    await expect(page.getByTestId('manager-evaluation-card')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('manager-evaluation-count')).toHaveCount(0);
    release();
    await expect(page.getByTestId('manager-evaluation-count')).toHaveText('2');
    await expect(page.getByTestId('dashboard-cycle-entry')).toContainText('当前没有个人绩效任务');
    await choose(page, plan.id);
    await page.getByTestId('manager-evaluation-open').click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${plan.id}`));
    await expect(page).toHaveURL(/stage=manager-eval/);

    teamCounts[plan.id]!.pending = [0, 0];
    await page.goto('/dashboard');
    await expect(page.getByText('当前没有进行中的本人任务或团队任务。', { exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(0);
  });

  test(`${status} plan keeps failed team counts visible as unknown`, async ({ page }) => {
    const plan = cycle(`unknown-${status}`, '待核实团队待办的已公示计划', status);
    await mockDashboard(page, { manager: true, cycles: [plan], tasks: [], failTeamCycle: plan.id });
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
    await expect(page.getByTestId('manager-evaluation-card')).toContainText('暂时无法加载');
    await expect(page.getByTestId('manager-evaluation-count')).toHaveCount(0);
    await expect(page.getByText('当前没有进行中的本人任务或团队任务。', { exact: true })).toHaveCount(0);
  });
}

test('returns to all plans when the selected published plan finishes loading with no pending work', async ({ page }) => {
  let release!: () => void;
  const delayTeam = new Promise<void>((resolve) => { release = resolve; });
  await mockDashboard(page, {
    manager: true, tasks: [mine[1]!], cycles: [active, result], delayTeam,
    teamCounts: { published: { pending: [0, 0], completed: 3 } },
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('option', { name: result.name, exact: true })).toHaveCount(1);
  await choose(page, 'published');
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-cycle-entry')).toContainText(result.name);
  release();
  await expect(page.getByLabel('考核计划', { exact: true })).toHaveValue('');
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-cycle-entry')).toContainText(active.name);
});

test('shows every personal plan, puts actionable work first, and keeps published results separate', async ({ page }, testInfo) => {
  const io = await mockDashboard(page, { manager: true, reports: true });
  await page.goto('/dashboard');
  const plans = page.getByTestId('dashboard-cycle-entry');
  await expect(plans).toHaveCount(3);
  await expect(plans.first()).toContainText(active.name);
  await expect(page.getByTestId('dashboard-personal-active-task')).toContainText('目标制定');
  await expect(page.getByTestId('dashboard-personal-wait-task')).toContainText('结果处理中');
  await expect(page.getByTestId('dashboard-result-cycle')).toHaveText(result.name);
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
  await choose(page, 'half');
  await expect(plans).toHaveCount(1);
  await expect(plans).toContainText(waiting.name);
  await expect(plans.getByTestId('manager-goal-review-count')).toHaveText('0');
  await expect(plans.getByTestId('manager-evaluation-count')).toHaveText('3');
  await expect(page.getByTestId('dashboard-result-cycle')).toHaveText(result.name);
  expect(io.requests.filter((url) => url.pathname.endsWith('/tasks/team')).every((url) => url.searchParams.has('cycleId'))).toBe(true);
  expect(io.writes).toEqual([]);
});

test('a team-only plan has its own counts and opens the exact plan and stage', async ({ page }) => {
  await mockDashboard(page, { manager: true });
  await page.goto('/dashboard');
  await choose(page, 'team-only');
  const plan = page.getByTestId('dashboard-cycle-entry');
  await expect(plan).toContainText('当前没有个人绩效任务');
  await expect(plan.getByTestId('manager-goal-review-count')).toHaveText('4');
  await expect(plan.getByTestId('manager-evaluation-count')).toHaveText('0');
  await plan.getByTestId('manager-goal-review-open').click();
  await expect(page).toHaveURL(/cycleId=team-only/);
  await expect(page).toHaveURL(/stage=goal-review/);
  await expect(page).toHaveURL(/scope=team/);
});

test('personal entry keeps cycle context and ordinary employees never request team or report data', async ({ page }) => {
  const io = await mockDashboard(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(2);
  await expect(page.getByTestId('manager-goal-review-card')).toHaveCount(0);
  expect(io.requests.some((url) => url.pathname.endsWith('/tasks/team') || url.pathname.includes('/reports/'))).toBe(false);
  await page.getByTestId('dashboard-personal-active-task').getByRole('button').click();
  await expect(page).toHaveURL(/\/tasks\/active-task\?/);
  await expect(page).toHaveURL(/cycleId=q3/);
});

test('reads beyond the first task page to find an ongoing plan', async ({ page }) => {
  const old = cycle('old', '历史计划', 'closed');
  const history = Array.from({ length: 101 }, (_, i) => task(`done-${i}`, old, 'closed'));
  const io = await mockDashboard(page, { cycles: [old, active], tasks: [...history, mine[1]!] });
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-personal-active-task')).toBeVisible();
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
  expect(io.requests.filter((url) => url.pathname.endsWith('/tasks/mine')).some((url) => Number(url.searchParams.get('page')) > 1)).toBe(true);
});

test('late team counts stay attached to their plan after a filter change', async ({ page }) => {
  let finish!: () => void;
  const delayTeam = new Promise<void>((resolve) => { finish = resolve; });
  await mockDashboard(page, { manager: true, delayTeam });
  await page.goto('/dashboard');
  await choose(page, 'half');
  finish();
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-cycle-entry')).toContainText(waiting.name);
  await expect(page.getByTestId('manager-evaluation-count')).toHaveText('3');
  await choose(page, 'q3');
  await expect(page.getByTestId('manager-evaluation-count')).toHaveText('1');
});

test('failed team counts remain unknown while personal tasks and other plans remain usable', async ({ page }) => {
  await mockDashboard(page, { manager: true, failTeamCycle: 'q3' });
  await page.goto('/dashboard');
  await choose(page, 'q3');
  await expect(page.getByTestId('dashboard-personal-active-task')).toBeVisible();
  await expect(page.getByTestId('manager-goal-review-card')).toContainText('暂时无法加载');
  await expect(page.getByTestId('manager-goal-review-count')).toHaveCount(0);
  await choose(page, 'half');
  await expect(page.getByTestId('manager-evaluation-count')).toHaveText('3');
});

test('a previous account response cannot replace the current account tasks', async ({ page }) => {
  await mockDashboard(page, { cycles: [active] });
  let release!: () => void;
  const previousResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/tasks/mine**', async (route) => {
    const previousAccount = route.request().headers().authorization === 'Bearer multi-cycle-contract';
    if (previousAccount) await previousResponse;
    return reply(route, {
      total: 1, page: 1, pageSize: 100,
      items: [task(previousAccount ? 'previous-account-task' : 'current-account-task', active, 'indicator_drafting')],
    });
  });
  await page.goto('/dashboard');
  await page.evaluate(async () => {
    const modulePath = '/src/stores/auth.store.ts';
    const { useAuthStore } = await import(modulePath);
    const auth = useAuthStore();
    auth.setSession('current-account', { ...auth.user, id: 'current-viewer', name: '当前员工' }, 600);
  });
  await expect(page.getByTestId('dashboard-personal-current-account-task')).toBeVisible();
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('dashboard-personal-current-account-task')).toBeVisible();
  await expect(page.getByTestId('dashboard-personal-previous-account-task')).toHaveCount(0);
});

test('phone dropdown filters both task areas and the full plan name stays visible without page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longPlan = cycle('q3', '2026年第三季度产品研发与跨部门协同专项绩效考核计划');
  await mockDashboard(page, { manager: true, cycles: [longPlan, waiting, teamOnly], tasks: [task('active-task', longPlan, 'indicator_drafting'), mine[0]!] });
  await page.goto('/dashboard');
  await choose(page, 'q3');
  await expect(page.getByTestId('dashboard-cycle-entry')).toHaveCount(1);
  const heading = page.getByTestId('dashboard-cycle-entry').getByRole('heading', { name: longPlan.name });
  await expect(heading).toBeVisible();
  const unclipped = await heading.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
  expect(unclipped).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-390.png'), fullPage: true });
  await page.getByTestId('manager-evaluation-open').click();
  await expect(page).toHaveURL(/cycleId=q3/);
  await expect(page).toHaveURL(/stage=manager-eval/);
});
