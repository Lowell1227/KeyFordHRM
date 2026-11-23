'use strict';
const {spawnSync}=require('node:child_process');
async function verify(){
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const {PrismaClient}=require('@prisma/client'),assert=require('node:assert/strict');const db=new PrismaClient({log:[],errorFormat:'minimal'}),tokens={};let stage='guard';
  async function http(actor,path,body,status=201){const r=await fetch('http://127.0.0.1:3000/api/v1'+path,{method:'POST',headers:{'content-type':'application/json',...(tokens[actor]?{authorization:'Bearer '+tokens[actor]}:{})},body:JSON.stringify(body)});if(r.status!==status)throw new Error(`http_${r.status}_expected_${status}`);return(await r.json()).data;}
  try{
    const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');assert.equal(identity.db,'hrm_preview');assert.equal(identity.role,'hrm_preview');assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED,'true');
    const m=(await db.systemConfig.findUnique({where:{key:'payroll_net_preview_net-api_v1'}}))?.value;assert.equal(m?.fictional,true);assert.equal(m.state,'ready');
    assert.equal(await db.payrollNetPayment.count({where:{subjectId:m.subjectId}}),2);
    for(const actor of['HR001','MGR001'])tokens[actor]=(await http('','/auth/test-login',{employeeNo:actor},200)).token;
    stage='reviewed_new_year';const profile=await db.payrollDeductionProfile.findFirst({where:{subjectId:m.subjectId,employeeId:m.employeeId,payDate:new Date(m.payDate),status:'active'},orderBy:{version:'desc'}}),settings=structuredClone(profile.settings);
    settings.tax.effectiveFrom='2038-01-01';settings.tax.effectiveTo='2038-12-31';settings.tax.ruleVersion='fictional-2038-v1';settings.tax.opening.sourceVersion='fictional-2038-explicit-zero';settings.ledger.startDate='2038-01-01';
    const row=await http('HR001','/payroll/deduction-profiles',{subjectId:m.subjectId,employeeId:m.employeeId,payDate:'2038-01-10',settings});
    const release=await http('HR001',`/payroll/parameters/deduction/${row.id}/submit`,{expectedVersion:row.version});await http('MGR001',`/payroll/parameter-releases/${release.id}/decide`,{expectedVersion:release.attempt,decision:'approve',note:'虚构跨年资料，税务年度与缴费期间独立'});
    stage='cross_year_reconciliation';await http('HR001','/payroll/adjustments',{subjectId:m.subjectId,employeeId:m.employeeId,month:m.month,itemCode:'adjustment',amount:'100',reason:'虚构跨年晚到差额',reference:'fictional-year-correction'});
    let b=await http('HR001','/payroll/batches',{subjectId:m.subjectId,month:m.month,payMonth:'2038-01',purpose:'validation',correctionOfId:m.batchId});b=await http('HR001',`/payroll/batches/${b.id}/calculate`,{expectedVersion:b.version,payDate:'2038-01-10'});
    const net=b.versions[0].netSnapshot;assert.deepEqual(net.totals,{gross:'100.00',socialInsurance:'0.00',housingFund:'0.00',incomeTax:'0.00',net:'100.00'});
    assert.equal(net.rows[0].result.evidence.tax.cumulative.income,'100');assert.equal(net.rows[0].result.evidence.tax.cumulative.taxPaid,'0');assert.equal(net.rows[0].ledger.factIds.length,2);assert.equal(net.rows[0].ledger.socialMonth,'2037-01');
    assert.equal(await db.payrollNetPayment.count({where:{subjectId:m.subjectId}}),2);
    return{fictional:true,passed:['new_actual_pay_year_uses_explicit_new_opening_not_prior_year_tax','earlier_contribution_month_reuses_prior_actual_deductions_without_duplicate_charge','cross_year_calculation_does_not_record_payment'],productionTouched:false};
  }catch(e){throw new Error(`net_year_${stage}_failed:${e.message}`);}finally{await db.$disconnect();}
}
if(require.main===module){const r=spawnSync('docker',['exec','-i','-w','/app','hrm-api-1','node'],{encoding:'utf8',timeout:120000,input:`(${verify.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`});if(r.status!==0){process.stderr.write(r.stderr||'net_year_refused');process.exitCode=1;}else process.stdout.write(r.stdout);}
