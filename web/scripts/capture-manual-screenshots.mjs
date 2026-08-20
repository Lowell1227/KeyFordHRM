import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturesPath = fileURLToPath(
  new URL('../e2e/fixtures/acceptance-accounts.ts', import.meta.url),
);
const outputDir = fileURLToPath(
  new URL('../public/manual/assets/screens/', import.meta.url),
);

const fixtureSource = await readFile(fixturesPath, 'utf8');
const passwordMatch = fixtureSource.match(/ACCEPTANCE_PASSWORD\s*=\s*["']([^"']+)["']/);
if (!passwordMatch) {
  throw new Error('Cannot resolve the acceptance password from the fixture.');
}

const baseURL = process.env.MANUAL_BASE_URL ?? 'http://localhost:5173';
const acceptancePassword = passwordMatch[1];

const capturePlan = [
  {
    role: 'hr',
    employeeNo: 'E2E_HR',
    pages: [
      ['hr-dashboard', '/dashboard'],
      ['user-management', '/users'],
      ['cycle-management', '/cycles'],
      ['indicator-library', '/indicators'],
      ['template-management', '/templates'],
      ['calibration', '/calibration'],
      ['result-publish', '/publish'],
      ['appeals', '/appeals'],
      ['reports', '/reports'],
      ['probation-management', '/probation-reviews/manage'],
      ['confirmation-management', '/confirmation-applications/manage'],
    ],
  },
  {
    role: 'manager',
    employeeNo: 'E2E_MGR',
    pages: [
      ['manager-team-tasks', '/tasks?scope=team'],
      ['manager-objectives', '/objectives'],
      ['manager-interviews', '/interviews'],
    ],
  },
  {
    role: 'employee',
    employeeNo: 'E2E_EMP',
    pages: [
      ['employee-tasks', '/tasks'],
      ['employee-action-items', '/action-items'],
      ['employee-probation', '/probation-reviews/mine'],
    ],
  },
  {
    role: 'vp',
    employeeNo: 'E2E_VP',
    pages: [
      ['approval', '/approval'],
      ['confirmation-approval', '/confirmation-applications/approvals'],
    ],
  },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const captured = [];

async function login(page, employeeNo) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  const localLoginToggle = page.getByText('管理员账号登录', { exact: true }).last();
  await localLoginToggle.waitFor({ state: 'visible' });
  await localLoginToggle.click();
  await page.getByPlaceholder('工号', { exact: true }).fill(employeeNo);
  await page.getByPlaceholder('密码', { exact: true }).fill(acceptancePassword);
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 15_000 }),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
}

async function capturePage(page, filename, route, role) {
  await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  if (page.url().includes('/login')) {
    throw new Error(`${role} was redirected to login for ${route}`);
  }
  const target = `${outputDir}${filename}.png`;
  await page.screenshot({
    path: target,
    fullPage: false,
    animations: 'disabled',
  });
  captured.push({ role, route, target });
}

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({
    path: `${outputDir}login.png`,
    fullPage: false,
    animations: 'disabled',
  });
  captured.push({ role: 'public', route: '/login', target: `${outputDir}login.png` });
  await context.close();
}

for (const rolePlan of capturePlan) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, rolePlan.employeeNo);
  for (const [filename, route] of rolePlan.pages) {
    await capturePage(page, filename, route, rolePlan.role);
  }
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ projectRoot, baseURL, captured }, null, 2));
