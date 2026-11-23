'use strict';
const {spawnSync}=require('node:child_process');
async function verify(){
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const {PrismaClient}=require('@prisma/client'),assert=require('node:assert/strict');const db=new PrismaClient({log:[],errorFormat:'minimal'}),tokens={},passed=[];
  let stage='guard';
  async function http(actor,method,path,body,status=method==='GET'?200:201){const r=await fetch('http://127.0.0.1:3000/api/v1'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',...(tokens[actor]?{authorization:'Bearer '+tokens[actor]}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status);return(await r.json()).data;}
  try{
    const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');assert.equal(identity.db,'hrm_preview');assert.equal(identity.role,'hrm_preview');assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED,'true');
    const m=(await db.systemConfig.findUnique({where:{key:'payroll_parameter_preview_api_v1'}})).value;assert.equal(m.fictional,true);assert.equal(m.state,'ready');
    const registered=(await db.systemConfig.findUnique({where:{key:'payroll_deduction_inputs_preview_v1'}})).value;assert.equal(registered.fictional,true);assert.ok(registered.subjectIds.includes(m.subjectId));
    const {subjectId,employeeId}=m,payDate=`${m.payMonth}-10`;
    const profile=await db.payrollDeductionProfile.findFirst({where:{subjectId,employeeId,payDate:new Date(payDate)},orderBy:{version:'desc'}});assert.equal(profile.status,'draft');assert.equal(profile.version,1);
    const batch=await db.payrollBatch.findUnique({where:{id:m.batchId}});const unchanged=async()=>JSON.stringify({batch:await db.payrollBatch.findUnique({where:{id:batch.id}}),versions:await db.payrollVersion.findMany({where:{batchId:batch.id},orderBy:{version:'asc'}}),settlements:await db.payrollSettlement.findMany({where:{line:{version:{batchId:batch.id}}}})});const before=await unchanged();
    for(const actor of ['HR001','MGR001','ADMIN','EMP001'])tokens[actor]=(await http('', 'POST','/auth/test-login',{employeeNo:actor},200)).token;
    const body={subjectId,employeeId,payDate,settings:profile.settings};const path=`/payroll/batches/${batch.id}/deductions-preview`,preview=()=>http('HR001','POST',path,{expectedVersion:batch.version,payDate,mode:'saved'});
    stage='permissions';for(const actor of ['MGR001','ADMIN','EMP001'])await http(actor,'GET',`/payroll/deduction-profiles?subjectId=${subjectId}`,null,403);
    for(const actor of ['MGR001','ADMIN'])await http(actor,'POST','/payroll/deduction-profiles',body,403);
    await http('HR001','POST',path,{expectedVersion:batch.version,payDate,mode:'saved',gross:'1'},400);passed.push('subject_scope_and_gross_override_denied');
    stage='validation';
    await http('HR001','POST','/payroll/deduction-profiles',{...body,gross:'1'},400);
    await http('HR001','POST','/payroll/deduction-profiles',{...body,payDate:'2037-02-31'},400);
    await http('HR001','POST','/payroll/deduction-profiles',{...body,employeeId:m.actors.HR001},400);
    const missing=structuredClone(profile.settings);delete missing.tax.current.specialDeduction;
    await http('HR001','POST','/payroll/deduction-profiles',{...body,settings:missing},400);
    const forged=structuredClone(profile.settings);forged.tax.opening.employeeId=m.actors.HR001;
    await http('HR001','POST','/payroll/deduction-profiles',{...body,settings:forged},400);passed.push('real_date_missing_facts_foreign_employee_and_identity_injection_denied');
    stage='review';
    assert.equal((await preview()).totals,null);
    const release=await http('HR001','POST',`/payroll/parameters/deduction/${profile.id}/submit`,{expectedVersion:profile.version});
    assert.equal((await preview()).totals,null);
    await http('HR001','POST',`/payroll/parameter-releases/${release.id}/decide`,{expectedVersion:release.attempt,decision:'approve',note:''},403);
    const tampered=structuredClone(profile.settings);tampered.tax.current.specialDeduction='300';
    try {await db.payrollDeductionProfile.update({where:{id:profile.id},data:{settings:tampered}});await http('MGR001','POST',`/payroll/parameter-releases/${release.id}/decide`,{expectedVersion:release.attempt,decision:'approve',note:''},409);}finally{await db.payrollDeductionProfile.update({where:{id:profile.id},data:{settings:profile.settings}});}
    await http('MGR001','POST',`/payroll/parameter-releases/${release.id}/decide`,{expectedVersion:release.attempt,decision:'approve',note:'Fictional manager verification'});
    const first=await preview();assert.equal(first.totals.net,'8820.00');assert.equal(first.rows[0].evidence.parameter.releaseId,release.id);passed.push('draft_pending_self_review_and_snapshot_tamper_blocked_reviewed_inputs_used');
    stage='revision';
    const old=JSON.stringify(await db.payrollDeductionProfile.findUnique({where:{id:profile.id}}));
    const revision=await http('HR001','POST','/payroll/deduction-profiles',{...body,settings:tampered});const pending=await http('HR001','POST',`/payroll/parameters/deduction/${revision.id}/submit`,{expectedVersion:revision.version});
    assert.equal((await preview()).totals.net,'8820.00');
    await http('MGR001','POST',`/payroll/parameter-releases/${pending.id}/decide`,{expectedVersion:pending.attempt,decision:'approve',note:'Fictional revision approved'});
    const revised=await preview();assert.equal(revised.totals.net,'8830.00');assert.equal(revised.rows[0].evidence.parameter.id,revision.id);
    assert.notEqual(first.rows[0].evidence.sourceHash,revised.rows[0].evidence.sourceHash);assert.equal(JSON.stringify(await db.payrollDeductionProfile.findUnique({where:{id:profile.id}})),old);
    await http('HR001','POST',path,{expectedVersion:batch.version,payDate,mode:'saved'},201);
    const other=await http('HR001','POST',path,{expectedVersion:batch.version,payDate:`${m.payMonth}-11`,mode:'saved'});assert.equal(other.totals,null);assert.equal(other.rows[0].net,null);
    passed.push('reviewed_replacement_changes_result_not_original_or_other_payment_date');
    stage='no_payment_facts';assert.equal(await unchanged(),before);passed.push('no_salary_version_or_payment_or_tax_paid_mutation');
    return{fictional:true,count:passed.length,passed,productionTouched:false};
  }catch{throw new Error(`deduction_inputs_${stage}_failed`);}finally{await db.$disconnect();}
}
if(require.main===module){const r=spawnSync('docker',['exec','-i','-w','/app','hrm-api-1','node'],{encoding:'utf8',timeout:120000,input:`(${verify.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`});if(r.status!==0){process.stderr.write(r.stderr||'deduction_inputs_verification_refused');process.exitCode=1;}else process.stdout.write(r.stdout);}
