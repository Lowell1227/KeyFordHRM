'use strict';
const {spawnSync,execFileSync}=require('node:child_process');
async function prepare(m,inspectOnly){
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({log:[],errorFormat:'minimal'}),tokens={};
  const check=(ok,code)=>{if(!ok)throw new Error(code);};
  async function http(actor,path,body){const r=await fetch('http://127.0.0.1:3000/api/v1'+path,{method:'POST',headers:{'content-type':'application/json',...(tokens[actor]?{authorization:'Bearer '+tokens[actor]}:{})},body:JSON.stringify(body)});check(r.ok,`net_fixture_http_${r.status}`);return(await r.json()).data;}
  try{
    const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');check(identity.db==='hrm_preview'&&identity.role==='hrm_preview'&&process.env.PAYROLL_FORMAL_ENABLED!=='true','database_guard');
    const key=`payroll_net_preview_${m.scope}_v1`,prior=(await db.systemConfig.findUnique({where:{key}}))?.value;
    const owner=(await db.systemConfig.findUnique({where:{key:`payroll_parameter_preview_${m.scope}_v1`}}))?.value;
    check(owner?.fictional===true&&owner.state==='ready'&&owner.subjectId===m.subjectId&&m.scope.startsWith('net-'),'ownership_guard');
    const employee=await db.user.findUnique({where:{id:m.employeeId},select:{employeeNo:true,dingtalkId:true,dingtalkUnionId:true}});check(employee?.employeeNo.startsWith('PAY-PARAM-')&&!employee.dingtalkId&&!employee.dingtalkUnionId,'employee_guard');
    if(prior){check(prior.fictional===true&&prior.subjectId===m.subjectId&&prior.state==='ready','marker_guard');return prior;}
    check(!inspectOnly,'fixture_missing');
    for(const [userId,capabilities]of[[m.actors.MGR001,['payroll_review']],[m.actors.VP001,['payroll_approve','payroll_export','payroll_settle']]]){
      const grant=await db.payrollGrant.findFirst({where:{subjectId:m.subjectId,userId,revokedAt:null}});
      if(grant)await db.payrollGrant.update({where:{id:grant.id},data:{capabilities:[...new Set([...grant.capabilities,...capabilities])]}});
      else await db.payrollGrant.create({data:{subjectId:m.subjectId,userId,capabilities,grantedById:m.actors.ADMIN}});
      await db.payrollEvent.create({data:{subjectId:m.subjectId,actorId:m.actors.ADMIN,action:'preview_grant',metadata:{fictional:true,userId,capabilities}}});
    }
    for(const actor of['HR001','MGR001'])tokens[actor]=(await http('','/auth/test-login',{employeeNo:actor})).token;
    const payDate=`${m.payMonth}-10`,{fictionalDeductionsInput}=require('./dist/src/payroll/payroll-deductions-preview.fixture');
    const original=fictionalDeductionsInput({subjectId:m.subjectId,employeeId:m.employeeId,month:m.month,payDate,gross:'10000'});
    const {subjectId,employeeId,gross,payDate:date,...settings}=original;
    const {subjectId:a,employeeId:b,year,...opening}=settings.tax.opening;settings.tax.opening=opening;
    settings.ledger={startDate:'2037-01-01',priorInPayMonth:Object.fromEntries(['exemptIncome','standardDeduction','specialDeduction','additionalDeduction','otherDeduction','taxRelief'].map(k=>[k,'0'])),priorSocialInsurance:'0',priorHousingFund:'0'};
    const profile=await http('HR001','/payroll/deduction-profiles',{subjectId,employeeId,payDate,settings});
    const release=await http('HR001',`/payroll/parameters/deduction/${profile.id}/submit`,{expectedVersion:profile.version});
    await http('MGR001',`/payroll/parameter-releases/${release.id}/decide`,{expectedVersion:release.attempt,decision:'approve',note:'虚构累计基准与扣缴资料确认'});
    const batch=await http('HR001','/payroll/batches',{subjectId,month:m.month,payMonth:m.payMonth,purpose:'validation'});
    const value={...m,fictional:true,state:'ready',batchId:batch.id,profileId:profile.id,payDate};
    await db.systemConfig.create({data:{key,value}});return value;
  }finally{await db.$disconnect();}
}
if(require.main===module){try{
  const scope=process.argv[2]??'net-demo';if(!['net-demo','net-desktop','net-mobile','net-api','net-recovery','net-desktop-final','net-mobile-final'].includes(scope))throw new Error('scope_guard');
  const inspectOnly=process.argv.includes('--inspect');const manifest=JSON.parse(execFileSync(process.execPath,['scripts/prepare-payroll-parameter-preview.cjs',scope,...(inspectOnly?['--inspect']:[])],{encoding:'utf8',timeout:180000}));
  const r=spawnSync('docker',['exec','-i','-w','/app','hrm-api-1','node'],{encoding:'utf8',timeout:180000,input:`(${prepare.toString()})(${JSON.stringify(manifest)},${inspectOnly}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`});
  if(r.status!==0)throw new Error(r.stderr.trim()||'net_fixture_refused');process.stdout.write(r.stdout);
}catch(e){console.error(e.message);process.exitCode=1;}}
