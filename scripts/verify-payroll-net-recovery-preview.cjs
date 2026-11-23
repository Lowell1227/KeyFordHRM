'use strict';
const {spawnSync}=require('node:child_process');
async function inspect(){
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({log:[],errorFormat:'minimal'});
  try{const m=(await db.systemConfig.findUnique({where:{key:'payroll_net_preview_net-recovery_v1'}}))?.value;if(m?.fictional!==true||process.env.PAYROLL_FORMAL_ENABLED==='true')throw new Error('ownership_guard');const b=await db.payrollBatch.findFirst({where:{subjectId:m.subjectId,correctionOfId:m.batchId,status:'approved'},orderBy:{createdAt:'desc'},select:{id:true}});if(!b)throw new Error('missing_recovered_batch');return{fictional:true,subjectId:m.subjectId,employeeId:m.employeeId,batchId:b.id,month:m.month};}finally{await db.$disconnect();}
}
async function verify(){
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const {PrismaClient}=require('@prisma/client'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
  const db=new PrismaClient({log:[],errorFormat:'minimal'}),tokens={};let stage='guard';
  async function http(actor,path,body,status=201){const r=await fetch('http://127.0.0.1:3000/api/v1'+path,{method:'POST',headers:{'content-type':'application/json',...(tokens[actor]?{authorization:'Bearer '+tokens[actor]}:{})},body:JSON.stringify(body)});if(r.status!==status)throw new Error(`http_${r.status}_expected_${status}`);return(await r.json()).data;}
  try{
    const [identity]=await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role');assert.equal(identity.db,'hrm_preview');assert.equal(identity.role,'hrm_preview');assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED,'true');
    const m=(await db.systemConfig.findUnique({where:{key:'payroll_net_preview_net-recovery_v1'}}))?.value;assert.equal(m?.fictional,true);assert.equal(m.state,'ready');
    const batch=await db.payrollBatch.findUnique({where:{id:m.batchId}});assert.equal(batch.status,'draft');
    for(const actor of['HR001','MGR001','VP001'])tokens[actor]=(await http('','/auth/test-login',{employeeNo:actor},200)).token;
    stage='second_employee';
    const secondId=randomUUID(),employeeNo=`PAY-PARAM-${secondId.slice(0,8)}`;
    await db.$transaction(async tx=>{await tx.user.create({data:{id:secondId,employeeNo,name:'未付恢复样例（虚构）',entryDate:new Date('2037-01-01'),directManagerId:m.actors.MGR001}});await tx.employmentRecord.create({data:{userId:secondId,employeeNo,effectiveFrom:new Date('2037-01-01'),entryDate:new Date('2037-01-01'),contractSubjectId:m.subjectId,employeeStatus:'active',directManagerId:m.actors.MGR001,changeType:'initial',sourceType:'payroll_preview',reason:'owned-net-recovery',createdById:m.actors.HR001}});});
    async function publish(kind,row){const r=await http('HR001',`/payroll/parameters/${kind}/${row.id}/submit`,{expectedVersion:row.version});await http('MGR001',`/payroll/parameter-releases/${r.id}/decide`,{expectedVersion:r.attempt,decision:'approve',note:'虚构恢复参数核对'});}
    const standard=await http('HR001','/payroll/standards',{subjectId:m.subjectId,employeeId:secondId,effectiveFrom:'2037-01-01',fixedMonthly:'10000',performanceBase:'0',performanceMode:'none',evidence:'虚构已批标准'});await publish('standard',standard);
    const profile=await db.payrollDeductionProfile.findUnique({where:{id:m.profileId}});
    const second=await http('HR001','/payroll/deduction-profiles',{subjectId:m.subjectId,employeeId:secondId,payDate:m.payDate,settings:profile.settings});await publish('deduction',second);
    for(const itemCode of['fixed','absence','overtime','performance','adjustment'])await http('VP001','/payroll/opening-balances',{subjectId:m.subjectId,employeeId:secondId,month:m.month,itemCode,amount:'0',reference:'虚构确认零期初'});
    const days=Array.from({length:31},(_,i)=>({workDate:`2037-01-${String(i+1).padStart(2,'0')}`,units:i<20?'1':'0'})),ids=[m.employeeId,secondId];
    const attendance=await http('HR001','/payroll/attendance/sync',{subjectId:m.subjectId,month:m.month,sourceKey:`net-recovery:${secondId}`,complete:true,input:{month:m.month,expected:ids.flatMap(employeeId=>days.map(d=>({...d,employeeId,required:d.units==='1'}))),records:ids.flatMap(employeeId=>days.filter(d=>d.units==='1').map(d=>({sourceId:`net-recovery:${employeeId}:${d.workDate}`,sourceVersion:1,employeeId,workDate:d.workDate,startsAt:`${d.workDate}T09:00:00+08:00`,endsAt:`${d.workDate}T17:00:00+08:00`,hours:'8',unit:'hour',type:'normal',state:'effective'})))}});
    await http('HR001',`/payroll/attendance/${attendance.id}/seal`,{expectedVersion:attendance.version});
    const approve=async b=>{b=await http('HR001',`/payroll/batches/${b.id}/submit`,{expectedVersion:b.version});b=await http('MGR001',`/payroll/batches/${b.id}/decide`,{expectedVersion:b.version,decision:'approve',note:''});return http('VP001',`/payroll/batches/${b.id}/decide`,{expectedVersion:b.version,decision:'approve',note:''});};
    stage='partial_paid';let b=await http('HR001',`/payroll/batches/${m.batchId}/calculate`,{expectedVersion:0,payDate:m.payDate});assert.equal(b.versions[0].netSnapshot.rows.length,2);b=await approve(b);
    b=await http('VP001',`/payroll/batches/${b.id}/net-payment`,{expectedVersion:b.version,employeeId:m.employeeId,payDate:m.payDate,reference:'虚构A已付已扣',requestId:randomUUID()});
    const preserved=JSON.stringify(await db.payrollNetPayment.findMany({where:{subjectId:m.subjectId}}));
    const amended=structuredClone(profile.settings);amended.tax.evidenceRef='虚构B来源更新';const revision=await http('HR001','/payroll/deduction-profiles',{subjectId:m.subjectId,employeeId:secondId,payDate:m.payDate,settings:amended});await publish('deduction',revision);
    await http('VP001',`/payroll/batches/${b.id}/net-payment`,{expectedVersion:b.version,employeeId:secondId,payDate:m.payDate,reference:'stale',requestId:randomUUID()},409);
    await http('VP001',`/payroll/batches/${b.id}/void`,{expectedVersion:b.version,note:'不能整批作废',confirmedUnpaid:true},409);
    stage='cancel';const cancel={expectedVersion:b.version,employeeId:secondId,reference:'虚构资料变化，撤销未付安排后补差'};
    await http('HR001',`/payroll/batches/${b.id}/cancel-net-remainder`,cancel,403);
    await http('VP001',`/payroll/batches/${b.id}/cancel-net-remainder`,{...cancel,employeeId:m.employeeId},409);
    b=await http('VP001',`/payroll/batches/${b.id}/cancel-net-remainder`,cancel);
    assert.equal(await db.payrollNetReservation.count({where:{subjectId:m.subjectId}}),0);
    assert.equal(await db.payrollReservation.count({where:{subjectId:m.subjectId}}),0);
    assert.equal(JSON.stringify(await db.payrollNetPayment.findMany({where:{subjectId:m.subjectId}})),preserved);
    await http('VP001',`/payroll/batches/${b.id}/export`,{expectedVersion:b.version,filePassword:randomUUID()},409);
    await http('VP001',`/payroll/batches/${b.id}/net-payment`,{expectedVersion:b.version,employeeId:secondId,payDate:m.payDate,reference:'cancelled',requestId:randomUUID()},409);
    stage='recover_new_batch';let next=await http('HR001','/payroll/batches',{subjectId:m.subjectId,month:m.month,payMonth:m.payMonth,purpose:'validation',correctionOfId:b.id});
    next=await http('HR001',`/payroll/batches/${next.id}/calculate`,{expectedVersion:next.version,payDate:m.payDate});
    assert.equal(next.versions[0].netSnapshot.rows.find(r=>r.employeeId===m.employeeId).result.gross,'0.00');
    assert.equal(next.versions[0].netSnapshot.rows.find(r=>r.employeeId===secondId).result.net,'8820.00');next=await approve(next);
    await http('VP001',`/payroll/batches/${next.id}/net-payment`,{expectedVersion:next.version,employeeId:secondId,payDate:m.payDate,reference:'虚构B新批准安排实发',requestId:randomUUID()});
    assert.equal(await db.payrollNetPayment.count({where:{subjectId:m.subjectId}}),2);
    return{fictional:true,passed:['two_employee_partial_payment_immutable','stale_unpaid_arrangement_scoped_cancellation','old_export_and_payment_blocked','new_approved_batch_recovers_without_repaying_first_employee'],productionTouched:false};
  }catch(e){throw new Error(`net_recovery_${stage}_failed:${e.message}`);}finally{await db.$disconnect();}
}
if(require.main===module){const run=process.argv.includes('--inspect')?inspect:verify;const r=spawnSync('docker',['exec','-i','-w','/app','hrm-api-1','node'],{encoding:'utf8',timeout:180000,input:`(${run.toString()})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`});if(r.status!==0){process.stderr.write(r.stderr||'net_recovery_refused');process.exitCode=1;}else process.stdout.write(r.stdout);}
