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

  // 注入登录态
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

  const templateName = `合法多维度模板-${Date.now()}`;

  // 1. 新建合法多维度模板
  await page.getByRole('button', { name: '新建模板' }).click();
  await page.waitForTimeout(300);

  await page.getByPlaceholder('例如：Q4 绩效考核模板').fill(templateName);

  // 选择适用部门（需为合法 UUID；seed 部门为全零 UUID，后端 IsUUID 校验不通过，故使用测试部门）
  const deptSelect = page.locator('.el-form-item').filter({ hasText: '适用部门' }).locator('.el-select').first();
  await deptSelect.click();
  await page.waitForTimeout(200);
  await page.getByRole('treeitem').getByText('测试部门-模板管理').click();
  await page.waitForTimeout(200);
  await page.locator('.el-dialog__header').first().click();

  // KPI 维度 70%，指标 100%
  await page.getByRole('button', { name: '添加维度' }).click();
  await page.getByRole('menuitem', { name: 'KPI 维度' }).click();
  let dim = page.locator('.dimension-card').nth(0);
  await dim.getByPlaceholder('维度名称').fill('业绩KPI');
  await dim.locator('.el-input-number').first().getByRole('spinbutton').fill('70');
  await dim.getByRole('button', { name: '添加指标' }).click();
  await dim.locator('table tbody tr').first().locator('input').first().fill('销售额');
  await dim.locator('table tbody tr').first().locator('td').nth(1).locator('input').fill('100');

  // 态度维度 30%，指标 100%
  await page.getByRole('button', { name: '添加维度' }).click();
  await page.getByRole('menuitem', { name: '工作态度维度' }).click();
  dim = page.locator('.dimension-card').nth(1);
  await dim.getByPlaceholder('维度名称').fill('工作态度');
  await dim.locator('.el-input-number').first().getByRole('spinbutton').fill('30');
  await dim.getByRole('button', { name: '添加指标' }).click();
  await dim.locator('table tbody tr').first().locator('input').first().fill('团队协作');
  await dim.locator('table tbody tr').first().locator('td').nth(1).locator('input').fill('100');

  // bonus 维度（直加减，不计入核心权重）
  await page.getByRole('button', { name: '添加维度' }).click();
  await page.getByRole('menuitem', { name: '加分项维度' }).click();
  dim = page.locator('.dimension-card').nth(2);
  await dim.getByPlaceholder('维度名称').fill('突出贡献');
  await dim.locator('.el-input-number').first().getByRole('spinbutton').fill('10');
  await dim.getByRole('button', { name: '添加指标' }).click();
  await dim.locator('table tbody tr').first().locator('input').first().fill('重大项目突破');
  await dim.locator('table tbody tr').first().locator('td').nth(1).locator('input').fill('100');

  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'verify-template-create-success.png', fullPage: false });

  // 2. 复制刚创建的模板（列表第一行），复制成功会自动打开编辑弹窗
  await page.getByRole('button', { name: '复制' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '确定' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'verify-template-duplicate-success.png', fullPage: false });

  // 3. 在自动打开的编辑弹窗中修改副本名称后保存
  const nameInput = page.getByPlaceholder('例如：Q4 绩效考核模板');
  await nameInput.fill(`${templateName}-已编辑`);
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'verify-template-edit-success.png', fullPage: false });

  console.log('截图已保存:');
  console.log('  verify-template-create-success.png');
  console.log('  verify-template-duplicate-success.png');
  console.log('  verify-template-edit-success.png');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
