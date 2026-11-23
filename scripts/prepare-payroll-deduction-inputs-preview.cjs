'use strict';
const {spawnSync} = require('node:child_process');
const {inspectFixture} = require('./prepare-payroll-parameter-preview.cjs');
async function prepare(manifest, inspectOnly) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const {PrismaClient} = require('@prisma/client'), {fictionalDeductionsInput} = require('./dist/src/payroll/payroll-deductions-preview.fixture');
  const db = new PrismaClient({log:[],errorFormat:'minimal'});
  try {
    if(process.env.PAYROLL_FORMAL_ENABLED==='true')throw new Error('formal_guard');
    const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');
    if(identity.db!=='hrm_preview'||identity.role!=='hrm_preview')throw new Error('database_guard');
    const owned=(await db.systemConfig.findUnique({where:{key:`payroll_parameter_preview_${manifest.scope}_v1`}}))?.value;
    if(owned?.fictional!==true||owned.subjectId!==manifest.subjectId||owned.employeeId!==manifest.employeeId||owned.state!=='ready')throw new Error('ownership_guard');
    const user=await db.user.findUnique({where:{id:owned.employeeId},select:{employeeNo:true,dingtalkId:true,dingtalkUnionId:true}});
    if(!user?.employeeNo.startsWith('PAY-PARAM-')||user.dingtalkId||user.dingtalkUnionId)throw new Error('fictional_guard');
    const key='payroll_deduction_inputs_preview_v1',payDate=`${owned.payMonth}-10`;
    const prior=(await db.systemConfig.findUnique({where:{key}}))?.value;
    if(prior&&prior.fictional!==true)throw new Error('marker_guard');
    let profile=await db.payrollDeductionProfile.findFirst({where:{subjectId:owned.subjectId,employeeId:owned.employeeId,domain:'validation',payDate:new Date(payDate)},orderBy:{version:'desc'}});
    if(!profile) {
      if(inspectOnly)throw new Error('missing_profile');
      const facts=fictionalDeductionsInput({subjectId:owned.subjectId,employeeId:owned.employeeId,month:owned.month,payDate,gross:'10000'});
      const {subjectId,employeeId,gross,payDate:date,...settings}=facts;
      const {subjectId:a,employeeId:b,year,...opening}=settings.tax.opening;settings.tax.opening=opening;
      const login=await fetch('http://127.0.0.1:3000/api/v1/auth/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employeeNo:'HR001'})});
      if(!login.ok)throw new Error('login_guard');const token=(await login.json()).data.token;
      const response=await fetch('http://127.0.0.1:3000/api/v1/payroll/deduction-profiles',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({subjectId,employeeId,payDate,settings})});
      if(!response.ok)throw new Error(`create_${response.status}`);profile=(await response.json()).data;
    }
    if(!inspectOnly)await db.systemConfig.upsert({where:{key},create:{key,value:{fictional:true,state:'ready',subjectIds:[owned.subjectId],employeeIds:[owned.employeeId]}},update:{value:{fictional:true,state:'ready',subjectIds:[...new Set([...(prior?.subjectIds??[]),owned.subjectId])],employeeIds:[...new Set([...(prior?.employeeIds??[]),owned.employeeId])]}}});
    return {...owned,payDate,profileId:profile.id};
  } finally {await db.$disconnect();}
}
if(require.main===module){try{
  const manifest=inspectFixture(process.argv[2]??'demo');
  const result=spawnSync('docker',['exec','-i','-w','/app','hrm-api-1','node'],{encoding:'utf8',timeout:60000,input:`(${prepare.toString()})(${JSON.stringify(manifest)},${process.argv.includes('--inspect')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`});
  if(result.status!==0)throw new Error(result.stderr.trim()||'deduction_fixture_refused');process.stdout.write(result.stdout);
}catch(error){console.error(error.message);process.exitCode=1;}}
