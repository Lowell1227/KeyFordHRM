import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test.skip(process.env.HRM_PAYROLL_DEDUCTION_INPUTS_ACCEPTANCE!=='1','Requires owned fictional deduction inputs');
test.use({trace:'off',video:'off',actionTimeout:15000});test.setTimeout(180000);
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function login(page:Page,actor:string){await page.goto('/login');await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.goto('/login');await page.getByTestId('preview-account').click();await page.getByRole('option',{name:new RegExp(`\\(${actor}\\)$`)}).click();await page.getByTestId('preview-login').click();await expect(page).toHaveURL(/\/dashboard$/);}
async function post(page:Page,suffix:string,action:()=>Promise<unknown>){const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(suffix));await action();const response=await waiting;expect(response.status()).toBe(201);return(await response.json()).data;}
test('maintain deductions, manager return/resubmit and saved-input net calculation without fixture fallback',async({page},info)=>{
  const data=JSON.parse(execFileSync(process.execPath,['scripts/prepare-payroll-deduction-inputs-preview.cjs',info.project.name,'--inspect'],{cwd:root,encoding:'utf8',timeout:30000}));
  expect(data.fictional).toBe(true);await page.route('**/*',route=>new URL(route.request().url()).origin==='http://localhost:5173'?route.continue():route.abort());
  const query=`?subjectId=${data.subjectId}&month=${data.month}`;
  const row=(version:number,review=false)=>info.project.name==='mobile'?page.locator('.mobile-result-card').filter({hasText:review?`参数样例（虚构） 扣缴资料 · V${version}`:`参数样例（虚构） · V${version}`}):review?page.getByRole('row').filter({hasText:`参数样例（虚构） 扣缴资料 · V${version}`}):page.getByRole('row').filter({has:page.getByRole('cell',{name:String(version),exact:true})});
  await login(page,'HR001');await page.goto('/payroll/deductions'+query);
  await page.getByRole('button',{name:'复制草稿',exact:true}).first().click();
  const form=page.getByRole('dialog',{name:'扣缴资料草稿',exact:true});
  await form.getByLabel('本次专项扣除',{exact:true}).fill('');await form.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(form).toContainText('无金额也须明确填写0');
  await form.getByLabel('本次专项扣除',{exact:true}).fill('300');
  const draft=await post(page,'/deduction-profiles',()=>form.getByRole('button',{name:'保存草稿',exact:true}).click());await expect(form).toBeHidden();
  const first=await post(page,`/${draft.id}/submit`,()=>row(draft.version).getByRole('button',{name:'提交主管审核',exact:true}).click());
  const detail=page.getByRole('dialog',{name:'参数审核',exact:true});await expect(detail).toBeVisible();await expect(detail.getByRole('button',{name:'审核并发布',exact:true})).toHaveCount(0);
  await login(page,'MGR001');await page.goto('/payroll/parameter-reviews'+query+`&releaseId=${first.id}`);
  await expect(detail.getByLabel('本次专项扣除',{exact:true})).toHaveValue('300');await expect(detail.getByLabel('本次专项扣除',{exact:true})).toBeDisabled();
  await detail.getByLabel('办理意见',{exact:true}).fill('虚构主管核查后退回重提');
  await post(page,`/${first.id}/decide`,()=>detail.getByRole('button',{name:'退回修改',exact:true}).click());
  await login(page,'HR001');await page.goto('/payroll/deductions'+query);
  const second=await post(page,`/${draft.id}/submit`,()=>row(draft.version).getByRole('button',{name:'提交主管审核',exact:true}).click());expect(second.attempt).toBe(first.attempt+1);
  await login(page,'MGR001');await page.goto('/payroll/parameter-reviews'+query+`&releaseId=${second.id}`);
  await detail.getByLabel('办理意见',{exact:true}).fill('虚构资料审核通过，不表示已扣税或付款');
  await post(page,`/${second.id}/decide`,()=>detail.getByRole('button',{name:'审核并发布',exact:true}).click());await expect(detail).toContainText('已发布');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`${root}/test-results/payroll-deduction-inputs-20261123/review-${info.project.name}.png`,fullPage:true});
  await login(page,'HR001');await page.goto(`/payroll/batches/${data.batchId}`+query);
  const preview=page.getByTestId('payroll-deductions-preview');await expect(preview).toBeVisible();
  await preview.getByLabel('试算发薪日',{exact:true}).fill(data.payDate);await preview.getByText('已审核资料',{exact:true}).click();
  const calculated=await post(page,'/deductions-preview',()=>preview.getByRole('button',{name:'试算',exact:true}).click());
  expect(calculated.mode).toBe('saved');expect(calculated.approvalStatus).toBe('not_submitted');expect(Number(calculated.totals.gross)).toBe(10000);expect(Number(calculated.totals.net)).toBe(8830);
  expect(calculated.rows[0].evidence.parameter).toMatchObject({id:draft.id,version:draft.version,releaseId:second.id});
  await expect(preview.getByTestId('payroll-deductions-preview-total-net')).toHaveText('8830.00');
  await preview.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`${root}/test-results/payroll-deduction-inputs-20261123/net-${info.project.name}.png`,fullPage:true});
  await preview.getByLabel('试算发薪日',{exact:true}).fill(`${data.payMonth}-11`);
  await expect(preview.getByTestId('payroll-deductions-preview-totals')).toHaveCount(0);
  const missing=await post(page,'/deductions-preview',()=>preview.getByRole('button',{name:'试算',exact:true}).click());
  expect(missing.totals).toBeNull();expect(missing.rows[0].net).toBeNull();await expect(preview).toContainText('暂无完整汇总');
});

test.describe('compact deduction input details',()=>{
  test.use({viewport:{width:1024,height:768}});
  test('reviewed input fields remain readable at compact width',async({page},info)=>{
    test.skip(info.project.name!=='desktop','One compact desktop pass');
    const data=JSON.parse(execFileSync(process.execPath,['scripts/prepare-payroll-deduction-inputs-preview.cjs','demo','--inspect'],{cwd:root,encoding:'utf8',timeout:30000}));
    await login(page,'HR001');await page.goto(`/payroll/deductions?subjectId=${data.subjectId}&month=${data.month}`);
    await page.getByRole('button',{name:'查看',exact:true}).first().click();const detail=page.getByRole('dialog',{name:'扣缴资料',exact:true});
    await expect(detail.getByLabel('累计来源版本',{exact:true})).toHaveValue('fictional-preview-zero-opening-v1');
    await expect(detail.getByLabel('本次专项扣除',{exact:true})).toHaveValue('200');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:`${root}/test-results/payroll-deduction-inputs-20261123/settings-compact.png`,fullPage:true});
  });
});
