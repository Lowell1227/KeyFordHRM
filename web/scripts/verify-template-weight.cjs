const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';
const EMPLOYEE_NO = process.env.EMPLOYEE_NO || 'ADMIN';
const PASSWORD = process.env.PASSWORD || 'admin123';

async function login() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeNo: EMPLOYEE_NO, password: PASSWORD }),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`登录失败: ${json.message}`);
  }
  return json.data;
}

async function main() {
  const loginData = await login();
  const token = loginData.token;
  const expiresAt = Date.now() + loginData.expiresIn * 1000;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(
    ({ token, expiresAt }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('expiresAt', String(expiresAt));
    },
    { token, expiresAt },
  );

  await page.goto(`${BASE_URL}/templates`);
  await page.waitForLoadState('networkidle');

  // 打开新建弹窗
  await page.getByRole('button', { name: '新建模板' }).click();
  await page.waitForTimeout(300);

  // 填写名称
  await page.getByPlaceholder('例如：Q4 绩效考核模板').fill('测试-非法权重拦截');

  // 选择适用部门
  const deptSelect = page.locator('.el-form-item').filter({ hasText: '适用部门' }).locator('.el-select').first();
  await deptSelect.click();
  await page.waitForTimeout(200);
  await page.getByRole('treeitem').getByText('测试部门-模板管理').click();
  await page.waitForTimeout(200);
  await page.locator('.el-dialog__header').first().click();

  // 添加 KPI 维度，维度权重 60%（核心维度总和不等于 100%）
  await page.getByRole('button', { name: '添加维度' }).click();
  await page.getByRole('menuitem', { name: 'KPI 维度' }).click();
  const dim = page.locator('.dimension-card').first();
  await dim.getByPlaceholder('维度名称').fill('KPI维度');
  await dim.locator('.el-input-number').first().getByRole('spinbutton').fill('60');

  // 添加一个指标，权重 50%，使维度内指标权重和 != 100%
  await dim.getByRole('button', { name: '添加指标' }).click();
  await dim.locator('table tbody tr').first().locator('input').first().fill('销售额');
  await dim.locator('table tbody tr').first().locator('td').nth(1).locator('input').fill('50');

  // 提交前应已显示权重错误提示
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verify-template-weight-invalid.png', fullPage: false });

  // 尝试提交，应被前端拦截
  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'verify-template-weight-error.png', fullPage: false });

  console.log('截图已保存:');
  console.log('  verify-template-weight-invalid.png');
  console.log('  verify-template-weight-error.png');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
