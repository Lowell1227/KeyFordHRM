import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TestApp } from '../test-app';

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'tmp/company-directory-integration/browser');
let server: ChildProcess | undefined;
let browser: any;

export async function startRealBrowser(app: TestApp) {
  mkdirSync(output, { recursive: true });
  await app.app.listen(0, '127.0.0.1');
  const address = app.app.getHttpServer().address();
  const log = createWriteStream(path.join(output, 'vite.log'), { flags: 'a' });
  server = spawn(process.execPath, [path.join(__dirname, 'serve-web.mjs')], {
    cwd: root, windowsHide: true, env: { ...process.env, COMPANY_DIRECTORY_API_URL: `http://127.0.0.1:${address.port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.pipe(log); server.stderr!.pipe(log);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Isolated Vite startup timed out; inspect browser/vite.log')), 30000);
    server!.stdout!.on('data', chunk => { if (String(chunk).includes('COMPANY_DIRECTORY_VITE_READY')) { clearTimeout(timeout); resolve(); } });
    server!.once('exit', code => { clearTimeout(timeout); reject(new Error(`Isolated Vite exited (${code}); inspect browser/vite.log`)); });
  });
  // Loaded from this worktree's Web installation; no browser fixture/API substitution.
  const { chromium } = require(path.join(root, 'web/node_modules/@playwright/test'));
  browser = await chromium.launch({ headless: true });
}

export async function stopRealBrowser() {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()));
    server.kill();
    await stopped;
  }
}

export async function browserCompanyAndOnboarding(width: number, token: string, departmentName: string, positionName: string) {
  const page = await browser.newPage({ viewport: { width, height: 940 } });
  const componentWarnings: string[] = [];
  page.on('console', (message: any) => { if (/Failed to resolve component/i.test(message.text())) componentWarnings.push(message.text()); });
  page.setDefaultTimeout(20000);
  const suffix = `${width}-${randomUUID().slice(0, 8)}`;
  const companyName = `虚拟页面公司-${suffix}`;
  const employeeName = `虚拟页面员工-${suffix}`;
  await page.addInitScript((value: string) => {
    localStorage.setItem('token', value);
    localStorage.setItem('expiresAt', String(Date.now() + 3600000));
    localStorage.setItem('passwordChangeRequired', 'false');
  }, token);
  const field = (label: string) => page.locator('.el-form-item').filter({
    has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }),
  }).filter({ visible: true });
  try {
    await page.goto('http://127.0.0.1:5190/basic-data?tab=contract-subjects');
    await page.getByRole('button', { name: '新增公司', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: '公司名称' }).fill(companyName);
    const created = page.waitForResponse((response: any) => response.url().endsWith('/api/v1/contract-subjects') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存公司', exact: true }).click();
    const createResponse = await created;
    if (createResponse.status() !== 201) throw new Error('Browser directory create failed');
    const subject = (await createResponse.json()).data;
    await dialog.waitFor({ state: 'hidden' });
    await page.getByPlaceholder('搜索公司名称').fill(companyName);
    await page.getByText(companyName, { exact: true }).filter({ visible: true }).waitFor();
    if (width === 390) {
      await page.waitForFunction(() => {
        const tag = document.querySelector('.mobile-result-card__status .el-tag');
        return tag && !Array.from(tag.classList).some(name => name.includes('enter-'));
      });
      const status = await page.locator('.mobile-result-card__status').evaluateAll((elements: HTMLElement[]) => elements.map(element => ({
        text: element.innerText, html: element.innerHTML, rect: element.getBoundingClientRect().toJSON(),
        display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility,
      })));
      writeFileSync(path.join(output, 'directory-status-390.json'), JSON.stringify({ status, componentWarnings }, null, 2));
    }
    await page.screenshot({ path: path.join(output, `directory-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.goto('http://127.0.0.1:5190/entry-exit');
    await page.getByRole('button', { name: '办理入职', exact: true }).click();
    await field('姓名').locator('input').fill(employeeName);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await field('所属公司').getByRole('combobox').click();
    await page.getByRole('option').filter({ hasText: companyName }).click();
    await field('部门').getByRole('combobox').click();
    await page.getByRole('treeitem').filter({ hasText: departmentName }).click();
    await page.keyboard.press('Escape');
    await field('岗位').getByRole('combobox').click();
    await page.getByRole('option', { name: positionName, exact: true }).click();
    await field('用工类型').locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: '全职', exact: true }).click();
    await field('员工状态').locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: '在职', exact: true }).click();
    for (const label of ['入职日期', '任职开始']) {
      await field(label).locator('input').fill('2035-03-01');
      await field(label).locator('input').press('Tab');
    }
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) throw new Error(`Horizontal document overflow at ${width}`);
    await field('所属公司').evaluate((element: HTMLElement) => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(output, `onboarding-company-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    const submitted = page.waitForResponse((response: any) => response.url().endsWith('/api/v1/employee-archives') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    const response = await submitted;
    const body = await response.json();
    if (response.status() !== 201) throw new Error(`Browser onboarding submit failed: ${JSON.stringify(body)}`);
    await page.locator('.employee-create-drawer').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, `onboarding-submitted-${width}.png`), fullPage: true, animations: 'disabled' });
    const previousFailure = path.join(output, `failure-${width}.png`);
    if (existsSync(previousFailure)) unlinkSync(previousFailure);
    return { subject, request: body.data, employeeName };
  } catch (error) {
    await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true });
    throw error;
  } finally { await page.close(); }
}
