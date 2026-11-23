import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
test.skip(process.env.HRM_PAYROLL_NET_ACCEPTANCE!=='1','Requires owned fictional net payroll');
test.use({trace:'off',video:'off',actionTimeout:15000});test.setTimeout(180000);
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function login(page:Page,actor:string){await page.goto('/login');await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.goto('/login');await page.getByTestId('preview-account').click();await page.getByRole('option',{name:new RegExp(`\\(${actor}\\)$`)}).click();await page.getByTestId('preview-login').click();await expect(page).toHaveURL(/\/dashboard$/);}
async function post(page:Page,suffix:string,action:()=>Promise<unknown>){const wait=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(suffix));await action();const response=await wait;expect(response.status()).toBe(201);return(await response.json()).data;}
test('net calculation, return, independent approvals, encrypted final export and explicit actual payment',async({page},info)=>{
  const suffix=process.env.HRM_PAYROLL_NET_FIXTURE_SUFFIX??'';expect(['','-final']).toContain(suffix);
  const data=JSON.parse(execFileSync(process.execPath,['scripts/prepare-payroll-net-preview.cjs',`net-${info.project.name}${suffix}`,'--inspect'],{cwd:root,encoding:'utf8',timeout:30000}));
  expect(data.fictional).toBe(true);const query=`?subjectId=${data.subjectId}&month=${data.month}`;
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://localhost:5173'?route.continue():route.abort());
  await login(page,'HR001');await page.goto(`/payroll/batches/${data.batchId}`+query);
  await page.getByText('含扣缴实发',{exact:true}).click();await page.getByRole('button',{name:'核算',exact:true}).click();
  await page.locator('.action-form').getByRole('button',{name:'核算',exact:true}).click();await expect(page.locator('.action-form')).toContainText('请选择核算发薪日');
  await page.getByLabel('核算发薪日',{exact:true}).fill('2037-02-31');await page.locator('.action-form').getByRole('button',{name:'核算',exact:true}).click();await expect(page.locator('.action-form')).toContainText('请输入有效的日历日期');
  await page.getByLabel('核算发薪日',{exact:true}).fill(data.payDate);
  let b=await post(page,'/calculate',()=>page.locator('.action-form').getByRole('button',{name:'核算',exact:true}).click());
  expect(b.versions[0].netSnapshot.totals.net).toBe('8820.00');await expect(page.getByTestId('payroll-net-total-net')).toHaveText('8820.00');
  await post(page,'/submit',()=>page.getByRole('button',{name:'提交复核',exact:true}).click());await expect(page.getByRole('button',{name:'通过当前环节',exact:true})).toHaveCount(0);
  await login(page,'MGR001');await page.goto(`/payroll/approvals/${data.batchId}`+query);
  await page.getByRole('button',{name:'退回经办',exact:true}).click();await page.getByLabel('办理意见与依据',{exact:true}).fill('虚构数据核对后重提');
  await post(page,'/decide',()=>page.locator('.action-form').getByRole('button',{name:'退回经办',exact:true}).click());
  await login(page,'HR001');await page.goto(`/payroll/batches/${data.batchId}`+query);
  await page.getByRole('button',{name:'核算',exact:true}).click();await page.getByLabel('核算发薪日',{exact:true}).fill(data.payDate);
  await post(page,'/calculate',()=>page.locator('.action-form').getByRole('button',{name:'核算',exact:true}).click());await post(page,'/submit',()=>page.getByRole('button',{name:'提交复核',exact:true}).click());
  await login(page,'MGR001');await page.goto(`/payroll/approvals/${data.batchId}`+query);
  await page.getByRole('button',{name:'通过当前环节',exact:true}).click();await page.getByLabel('办理意见与依据',{exact:true}).fill('虚构独立复核');
  await post(page,'/decide',()=>page.locator('.action-form').getByRole('button',{name:'通过当前环节',exact:true}).click());
  await login(page,'VP001');await page.goto(`/payroll/approvals/${data.batchId}`+query);
  await page.getByRole('button',{name:'通过当前环节',exact:true}).click();await page.getByLabel('办理意见与依据',{exact:true}).fill('虚构独立审批');
  b=await post(page,'/decide',()=>page.locator('.action-form').getByRole('button',{name:'通过当前环节',exact:true}).click());expect(b.status).toBe('approved');expect(b.versions[0].netPayments).toHaveLength(0);
  await page.goto(`/payroll/results/${data.batchId}`+query);await expect(page.getByTestId('payroll-net-total-net')).toHaveText('8820.00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`${root}/test-results/payroll-net-20261123/approved-${info.project.name}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'下载加密工资表',exact:true}).click();await page.getByLabel('Excel 独立文件密码',{exact:true}).fill(randomBytes(16).toString('hex'));
  const pending=page.waitForEvent('download');await page.locator('.action-form').getByRole('button',{name:'下载加密工资表',exact:true}).click();const file=await pending;
  expect(file.suggestedFilename()).toContain('测试环境-实发工资');expect(await file.failure()).toBeNull();await file.delete();
  await page.getByRole('button',{name:'确认实发与扣缴',exact:true}).first().click();
  // Row action preselects the exact employee, not a name guess or an API bypass.
  await expect(page.getByTestId('payroll-net-payment-form')).toContainText('参数样例（虚构）');
  await page.getByTestId('payroll-net-payment-form').getByLabel('财务凭证',{exact:true}).fill(`虚构页面实发扣缴-${info.project.name}`);
  const payment=post(page,'/net-payment',async()=>{
    await page.locator('.action-form').getByRole('button',{name:'确认实发与扣缴',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'确认实发与扣缴',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'已实际发放且扣缴一致',exact:true}).click();
  });
  b=await payment;expect(b.versions[0].netPayments).toHaveLength(1);await expect(page.getByTestId('payroll-net-results')).toContainText('已确认');
  await expect(page.getByRole('dialog',{name:'确认实发与扣缴',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'确认实发与扣缴',exact:true})).toHaveCount(0);
  await page.getByTestId('payroll-net-results').scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/test-results/payroll-net-20261123/paid-${info.project.name}.png`,fullPage:true,animations:'disabled'});
  await login(page,'EMP001');await page.goto(`/payroll/results/${data.batchId}`+query);await expect(page.getByTestId('payroll-net-results')).toHaveCount(0);await expect(page.getByText('8820.00',{exact:true})).toHaveCount(0);
});

test('paid snapshots stay readable at compact desktop and tall phone widths',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Read-only responsive pass is shared');
  const m=JSON.parse(execFileSync(process.execPath,['scripts/prepare-payroll-net-preview.cjs','net-desktop','--inspect'],{cwd:root,encoding:'utf8',timeout:30000}));
  await login(page,'VP001');
  for(const viewport of[{width:1024,height:768},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto(`/payroll/results/${m.batchId}?subjectId=${m.subjectId}&month=${m.month}`);
    await expect(page.getByTestId('payroll-net-total-net')).toHaveText('8820.00');await expect(page.getByTestId('payroll-net-results')).toContainText('已确认实发与扣缴');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.getByTestId('payroll-net-results').scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/test-results/payroll-net-20261123/paid-${viewport.width}.png`,fullPage:true,animations:'disabled'});
  }
});

test('phone can withdraw only an unpaid employee arrangement after partial payment',async({page},info)=>{
  test.skip(info.project.name!=='mobile','Mobile recovery after the independent HTTP scenario');
  const m=JSON.parse(execFileSync(process.execPath,['scripts/verify-payroll-net-recovery-preview.cjs','--inspect'],{cwd:root,encoding:'utf8',timeout:30000}));expect(m.fictional).toBe(true);
  await login(page,'VP001');await page.goto(`/payroll/results/${m.batchId}?subjectId=${m.subjectId}&month=${m.month}`);
  await page.getByRole('button',{name:'撤销未付安排',exact:true}).click();const form=page.getByTestId('payroll-net-cancel-form');
  await form.getByLabel('撤销未付员工',{exact:true}).click();await page.getByRole('option',{name:/参数样例（虚构）/}).click();
  await form.getByLabel('财务凭证与撤销原因',{exact:true}).fill('虚构核对已付部分，本人员无新增应付，撤销零余额安排');
  const b=await post(page,'/cancel-net-remainder',async()=>{await form.getByRole('button',{name:'撤销未付安排',exact:true}).click();const dialog=page.getByRole('dialog',{name:'撤销未付安排',exact:true});await dialog.getByRole('button',{name:'已核实未付，撤销安排',exact:true}).click();});
  expect(b.versions[0].netPayments).toHaveLength(1);await expect(page.getByTestId('payroll-net-results')).toContainText('已撤销未付安排');await expect(page.getByRole('button',{name:'下载加密工资表',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'撤销未付安排',exact:true})).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`${root}/test-results/payroll-net-20261123/cancel-mobile.png`,fullPage:true,animations:'disabled'});
});
