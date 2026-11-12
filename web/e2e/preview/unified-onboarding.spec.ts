import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1'], { encoding: 'utf8' }));
  const env = Object.fromEntries(container.Config.Env.map((line: string) => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
  expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
  expect(env.HRM_PREVIEW).toBe('true');
  expect(new URL(env.DATABASE_URL).pathname).toBe('/hrm_preview');
  expect(env.DINGTALK_NOTIFICATION_ENABLED).toBe('false');
  expect(env.DINGTALK_INTERVIEW_CALENDAR_ENABLED).toBe('false');
  // Add only these fictional fixtures once; preserve subsequent acceptance edits.
  execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', input: `
    const { PrismaClient } = require('@prisma/client');
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.HRM_PREVIEW !== 'true' || process.env.NODE_ENV !== 'development'
      || url.hostname !== 'postgres' || url.username !== 'hrm_preview' || url.pathname !== '/hrm_preview') process.exit(2);
    const prisma = new PrismaClient();
    (async () => {
      if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
      const marker = 'preview_unified_onboarding_v1';
      if (await prisma.systemConfig.findUnique({ where: { key: marker } })) return;
      await prisma.$transaction(async tx => {
        const departments = await tx.department.findMany({ where: { name: { in: ['预览人事部', '预览业务部'] } }, orderBy: { name: 'asc' } });
        if (departments.length !== 2) throw new Error('Fictional departments missing');
        for (const [index, department] of departments.entries()) {
          const employeeNo = 'PREVIEW_EXIT00' + (index + 1);
          const user = await tx.user.create({ data: {
            name: '预览离职员工', employeeNo, status: 'resigned', sysRole: 'employee',
            deptId: department.id, position: '预览历史岗位', archivedAt: index ? new Date('2026-01-02') : null,
            entryDate: new Date('2025-01-01'), leaveDate: new Date('2025-12-31'),
          } });
          await tx.employmentRecord.create({ data: {
            userId: user.id, employeeNo, company: 'fuede', deptId: department.id, position: '预览历史岗位',
            employeeStatus: 'resigned', entryDate: new Date('2025-01-01'), leaveDate: new Date('2025-12-31'),
            effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2025-12-31'),
            changeType: 'resignation', sourceType: 'preview_fixture',
          } });
        }
        await tx.systemConfig.create({ data: { key: marker, value: { fictional: true } } });
      });
    })().finally(() => prisma.$disconnect()).catch(() => process.exitCode = 1);
  ` });
});

test('HR real backend finds both resigned scopes and hands off to the selected archive', async ({ page, request }, info) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.method() !== 'GET' && req.url().includes('/employee-archives/')) writes.push(new URL(req.url()).pathname); });
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/entry-exit');
  await expect(page.getByRole('button', { name: '办理再入职', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
  const saved = page.waitForResponse(response => response.url().endsWith('/employee-archives/drafts') && response.request().method() === 'POST');
  await drawer.getByLabel('姓名', { exact: true }).fill('预览离职员工');
  const savedResponse = await saved;
  expect(savedResponse.ok()).toBeTruthy();
  const draftId = (await savedResponse.json()).data.id;
  const authorization = `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}`;
  try {
    const matches = drawer.getByRole('region', { name: '同名离职员工' });
    await expect(matches.getByRole('button', { name: /^选择 .* 再入职$/ })).toHaveCount(2);
    await expect(matches).toContainText('PREVIEW_EXIT001');
    await expect(matches).toContainText('PREVIEW_EXIT002');
    await expect(matches).toContainText('已归档');
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await drawer.screenshot({ path: info.outputPath('onboarding-name-matches.png'), animations: 'disabled' });
    await matches.getByRole('button', { name: /PREVIEW_EXIT002/ }).click();
    const reentry = page.getByRole('dialog', { name: '办理再入职', exact: true });
    await expect(reentry).toBeVisible();
    await expect(reentry).toContainText('历史工号 PREVIEW_EXIT002');
    await expect(reentry).toContainText('再入职将自动生成新工号');
    const persisted = await request.get(`/api/v1/employee-archives/applications/${draftId}`, { headers: { authorization } });
    expect(persisted.ok()).toBeTruthy();
    expect((await persisted.json()).data.proposedValue.employee.name).toBe('预览离职员工');
    expect(errors).toEqual([]);
    expect(writes.every(path => path.endsWith('/drafts'))).toBe(true);
    expect(await reentry.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await reentry.screenshot({ path: info.outputPath('selected-reentry.png'), animations: 'disabled' });
  } finally {
    // Archive only the draft created by this test, never an existing preview record.
    const result = await request.post('/api/v1/employee-archives/drafts/archive', { headers: { authorization }, data: { ids: [draftId] } });
    expect(result.ok()).toBeTruthy();
  }
});
