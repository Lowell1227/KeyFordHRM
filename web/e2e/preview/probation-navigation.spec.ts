import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

type Actor = { id: string; token: string };
let fixture: { departmentId: string; actors: Record<string, Actor> };

function database(body: string) {
  const source = `require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt'),db=new PrismaClient();
    (async()=>{if((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional!==true)throw Error('Not fictional preview');
    ${body}})().finally(()=>db.$disconnect()).catch(()=>process.exitCode=1);`;
  try {
    return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
      input: source, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch {
    throw new Error('Isolated preview fixture operation failed');
  }
}

test.beforeAll(() => {
  const prefix = `NAV_${randomUUID().slice(0, 8)}`;
  fixture = database(`
    const department=await db.department.create({data:{name:'虚构${prefix}部门'}}),actors={};
    const definitions={personnel:['employee_archive_edit','organization_edit'],performance:['cycle_plan_edit','cycle_plan_review','performance_calibration','performance_publish','confirmation_manage']};
    for(const [kind,caps] of Object.entries(definitions)){
      const user=await db.user.create({data:{name:'虚构${prefix}'+kind,employeeNo:'${prefix}_'+kind,deptId:department.id,status:'active',sysRole:'hr_user',hrCapabilities:caps}});
      await db.employmentRecord.create({data:{userId:user.id,employeeNo:user.employeeNo,deptId:department.id,company:'fuede',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01'),employeeStatus:'active',changeType:'onboarding',sourceType:'preview_fixture'}});
      actors[kind]={id:user.id,token:new JwtService().sign({sub:user.id,employeeNo:user.employeeNo,name:user.name,sysRole:user.sysRole,deptId:user.deptId,hrCapabilities:caps,isAssessorOnly:false,canViewAll:false},{secret:process.env.JWT_SECRET,expiresIn:'15m'})};
    }
    console.log(JSON.stringify({departmentId:department.id,actors}));
  `);
});

test.afterAll(() => {
  if (!fixture) return;
  const ids = JSON.stringify(Object.values(fixture.actors).map(actor => actor.id));
  database(`await db.$transaction(async tx=>{
    await tx.employmentRecord.deleteMany({where:{userId:{in:${ids}},sourceType:'preview_fixture'}});
    await tx.user.deleteMany({where:{id:{in:${ids}},deptId:'${fixture.departmentId}'}});
    await tx.department.delete({where:{id:'${fixture.departmentId}'}});
  });console.log('{}');`);
});

test('real personnel and performance roles keep probation inside performance', async ({ page }, info) => {
  for (const [kind, actor] of Object.entries(fixture.actors)) {
    await page.goto('/login');
    await page.evaluate(token => {
      localStorage.setItem('token', token);
      localStorage.setItem('expiresAt', String(Date.now() + 600000));
      localStorage.removeItem('kayford.sidebar.collapsedGroups');
    }, actor.token);
    const headers = { authorization: `Bearer ${actor.token}` };
    const personnel = kind === 'personnel';
    const personnelResponse = await page.request.get('/api/v1/employee-archives/applications/list?pageSize=1', { headers });
    expect(personnelResponse.status()).toBe(personnel ? 200 : 403);
    const confirmationResponse = await page.request.get('/api/v1/confirmation-applications?pageSize=1', { headers });
    expect(confirmationResponse.status()).toBe(personnel ? 403 : 200);
    await page.goto(personnel ? '/users' : '/confirmation-applications/manage');
    await expect(page.getByTestId('preview-badge')).toBeVisible();
    if (personnel) {
      await expect(page.getByTestId('nav-module-people')).toHaveClass(/is-active/);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '员工档案', exact: true })).toBeVisible();
      await expect(page.locator('.menu-panel').getByRole('button', { name: '入离职', exact: true })).toBeVisible();
      await expect(page.locator('.menu-panel').getByRole('button', { name: '转正管理', exact: true })).toHaveCount(0);
      await page.getByTestId('nav-module-performance').click();
      await expect(page.locator('.menu-panel').getByRole('button', { name: '转正管理', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByTestId('nav-module-people')).toHaveCount(0);
      await expect(page.getByTestId('nav-module-performance')).toHaveClass(/is-active/);
      await expect(page.locator('.menu-panel').getByRole('button', { name: '转正管理', exact: true })).toHaveClass(/is-active/);
      await expect(page.getByTestId('app-route-title')).toHaveText('转正管理');
    }
    await page.locator('.menu-panel').getByRole('button', { name: '我的转正申请', exact: true }).click();
    await expect(page).toHaveURL(/\/confirmation-applications\/mine$/);
    await expect(page.getByTestId('nav-module-performance')).toHaveClass(/is-active/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath(`${kind}-probation-navigation.png`), fullPage: true });
    await page.goto(personnel ? '/confirmation-applications/manage' : '/users');
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});
