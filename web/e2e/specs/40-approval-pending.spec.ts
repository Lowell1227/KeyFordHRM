import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`approved result cannot be selected, approved or rejected at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem('token', 'approval-ui-fixture');
      localStorage.setItem('expiresAt', String(Date.now() + 600_000));
    });
    const cycle = { id: 'cycle-approval', name: '审批验收周期', status: 'approval', type: 'quarterly', startDate: '2026-07-01', endDate: '2026-09-30' };
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path.endsWith('/auth/me')) data = {
        id: 'approver', name: '审批验收人', sysRole: 'employee', status: 'active', canViewAll: false,
        businessCapabilities: { canViewPerformanceApproval: true, canOperatePerformanceApproval: true, identities: [] },
      };
      else if (path.endsWith('/cycles')) data = { items: [cycle], total: 1 };
      else if (path.endsWith('/approval/overview')) data = {
        ownPending: 1, ownTotal: 2, cyclePending: 1, rejects: [],
        gradeDistribution: Object.fromEntries(['A', 'B', 'C', 'D'].map((grade) => [grade, { count: grade === 'B' ? 2 : 0, ratio: 0, maxRatio: 1, isOverLimit: false }])),
      };
      else if (path.endsWith('/approval')) data = [
        { id: 'pending', employeeName: '待审批员工', approvedAt: null },
        { id: 'approved', employeeName: '已审批员工', approvedAt: '2026-09-08T00:00:00.000Z' },
      ].map((row) => ({ ...row, employeeId: row.id, cycleId: cycle.id, status: 'approval', approverId: 'approver', totalScore: 80, rawGrade: 'B', isVeto: false }));
      else if (path.endsWith('/notifications/unread-count')) data = 0;
      else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });
    });

    await page.goto('/approval?cycleId=cycle-approval');
    const approved = page.locator('.el-table__body tr').filter({ hasText: '已审批员工' });
    const pending = page.locator('.el-table__body tr').filter({ hasText: '待审批员工' });
    await expect(approved).toBeVisible();
    await expect(approved.getByRole('checkbox')).toBeDisabled();
    await expect(approved.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
    await expect(approved.getByRole('button', { name: '退回', exact: true })).toHaveCount(0);
    await expect(approved).toContainText('已通过，待公示');
    await expect(pending.getByRole('checkbox')).toBeEnabled();
    await expect(pending.getByRole('button', { name: '通过', exact: true })).toBeVisible();
  });
}
