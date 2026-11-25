import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test.setTimeout(60000);
test.use({ timezoneId: 'Asia/Shanghai' });

test('persistent fictional intake demo is usable by the existing ADMIN without consuming its pending work', async ({ page }, info) => {
  expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const mobile = info.project.name === 'mobile'; await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900 });
  const demo = JSON.parse(await readFile('../test-results/recruitment-intake-demo/demo.json', 'utf8'));
  expect(demo).toMatchObject({ fictional: true, persistent: true, phase: 'ready', preservedExisting: true });
  const pdf = await readFile(demo.artifactPath), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const login = await page.request.post('/api/v1/auth/test-login', { data: { employeeNo: 'ADMIN' } });
  expect(login.status()).toBe(200); const token = (await login.json()).data.token as string;
  async function get(path: string) {
    const response = await page.request.get('/api/v1' + path, { headers: { authorization: 'Bearer ' + token } });
    expect(response.status()).toBe(200); return (await response.json()).data;
  }
  const demand = await get('/recruitment-demands/' + demo.demandId);
  expect(demand).toMatchObject({ sourceKind: 'local', sourceState: 'approved', usable: true, approvedHeadcount: 2 });
  const postings = await get('/recruitment-postings?demandId=' + demo.demandId);
  expect(postings.total).toBe(1); expect(postings.items[0]).toMatchObject({ id: demo.postingId, verifiedIdentity: true, active: true });
  const listed = await get('/recruitment-intakes?demandId=' + demo.demandId);
  expect(listed.total).toBe(3);
  expect(new Set(listed.items.map((row: { id: string }) => row.id))).toEqual(new Set([demo.awaitingId, ...demo.mailIntakeIds]));
  const before = await Promise.all([demo.awaitingId, ...demo.mailIntakeIds].map((id: string) => get('/recruitment-intakes/' + id)));
  const waiting = before.find(row => row.id === demo.awaitingId);
  expect(waiting).toMatchObject({ state: 'awaiting_resume', positionName: demand.positionName, nextFollowUpAt: '2037-01-12T02:00:00.000Z' });
  const mail = before.filter(row => row.transport === 'email'); expect(mail).toHaveLength(2);
  expect(mail.every(row => row.state === 'pending_review' && row.candidateId === null && row.applicationId === null)).toBe(true);
  expect(mail.filter(row => row.files.length === 1)).toHaveLength(1);

  await page.goto('/login');
  await page.evaluate(value => { localStorage.setItem('token', value); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, token);
  const url = '/recruitment/intakes?demandId=' + demo.demandId; await page.goto(url);
  await expect(page.getByRole('button', { name: '登记待收简历', exact: true })).toBeEnabled();
  const rows = () => page.locator(mobile ? '.mobile-result-card:visible' : '.el-table__row:visible');
  await expect(rows()).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('persistent-demo-three-pending-items.png'), fullPage: true, animations: 'disabled' });
  await rows().filter({ hasText: '虚构待收演练_' + demo.prefix }).getByRole('button', { name: '办理', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await expect(dialog.getByRole('textbox', { name: '收件意向岗位', exact: true })).toHaveValue(demand.positionName);
  await expect(dialog.getByRole('combobox', { name: '下次跟进时间', exact: true })).toHaveValue('2037-01-12 10:00:00');
  await page.screenshot({ path: info.outputPath('persistent-demo-waiting-ready-to-upload-or-associate.png'), fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: '岗位或来源线索', exact: true }).fill('一份可下载的 PDF 简历');
  await page.getByRole('button', { name: '查询', exact: true }).click(); await expect(rows()).toHaveCount(1);
  await rows().getByRole('button', { name: '办理', exact: true }).click(); dialog = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await expect(dialog.getByRole('region', { name: '原简历资料', exact: true })).toContainText(demo.artifactMarker + '.pdf');
  const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloading; expect(await readFile((await download.path())!)).toEqual(pdf);
  expect(pdf.toString('ascii')).toContain(demo.artifactMarker);
  await page.screenshot({ path: info.outputPath('persistent-demo-downloadable-fictional-pdf.png'), fullPage: true, animations: 'disabled' });
  const after = await Promise.all([demo.awaitingId, ...demo.mailIntakeIds].map((id: string) => get('/recruitment-intakes/' + id)));
  expect(after).toEqual(before); expect(errors).toEqual([]);
  await writeFile(info.outputPath('proof.json'), JSON.stringify({ passed: true, fictional: true, user: 'ADMIN', url: 'http://localhost:5173' + url,
    demandId: demo.demandId, postingId: demo.postingId, pendingIntakeIds: before.map(row => row.id), pendingWorkUnchanged: true,
    pdfByteLength: pdf.length, pdfSha256: createHash('sha256').update(pdf).digest('hex'), viewport: page.viewportSize(), pageErrors: errors }, null, 2));
});
