const { execFileSync } = require('node:child_process');
const demo = process.argv.includes('--demo');
const deletion = process.argv.includes('--deletion');
const source = `
require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
const {PrismaClient}=require('@prisma/client'),{randomUUID,randomBytes}=require('node:crypto'),bcrypt=require('bcrypt');
const db=new PrismaClient();
(async()=>{
 const [target]=await db.$queryRawUnsafe('SELECT current_database() AS name,current_user AS role');
 const guard=await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}});
 if(target.name!=='hrm_preview'||target.role!=='hrm_preview'||guard?.value?.fictional!==true)throw Error('preview ownership');
 const marker=${JSON.stringify(deletion ? 'cycle_deletion_preview_demo_20261127' : 'cycle_termination_preview_demo_20261127')};
 if(${demo}){const previous=await db.systemConfig.findUnique({where:{key:marker}});if(previous)return previous.value;}
 const actors={};
 for(const no of ['HR001','ADMIN','MGR001','EMP001','EMP002','EMP003','EMP004']){
  const user=await db.user.findUniqueOrThrow({where:{employeeNo:no}});
  if(!user.name.startsWith('测试')||user.dingtalkId||user.dingtalkUnionId||user.deletedAt||user.archivedAt)throw Error('fictional identity');
  actors[no]=user;
 }
 const prefix='CT_'+randomUUID().replace(/-/g,'').slice(0,10),password=randomBytes(24).toString('hex');
 const passwordHash=await bcrypt.hash(password,10);
 return db.$transaction(async tx=>{
  const owner=actors.HR001;
  await tx.user.update({where:{id:owner.id},data:{hrCapabilities:{set:[...new Set([...owner.hrCapabilities,'cycle_terminate',...(${deletion}?['cycle_delete']:[])])]}}});
  const operator=await tx.user.create({data:{name:prefix+' 虚构人事经办',employeeNo:prefix+'HR',sysRole:'hr_user',
   hrCapabilities:['employee_archive_edit','recruitment_view','recruitment_edit'],status:'active',mustChangePassword:false,passwordHash,
   accountType:'employee',entryDate:new Date('2026-01-01'),deptId:owner.deptId}});
  await tx.employmentRecord.create({data:{userId:operator.id,employeeNo:operator.employeeNo,employeeStatus:'active',
   company:'fuede',deptId:owner.deptId,changeType:'onboarding',sourceType:'preview_fixture',effectiveFrom:new Date('2026-01-01'),entryDate:new Date('2026-01-01')}});
  const cycle=await tx.assessmentCycle.create({data:{name:prefix+${JSON.stringify(deletion ? ' 安全终止及删除演练（虚构）' : ' 安全终止演练（虚构）')},type:'monthly',
   startDate:new Date('2026-11-01'),endDate:new Date('2026-11-30'),status:'self_eval',workflowVersion:2,goalWorkflowVersion:2,
   scoringFrequency:'monthly',hrOwnerId:owner.id,createdBy:owner.id,reviewStatus:'approved',openedAt:new Date(),notificationMode:'off'}});
  const tasks=[];
  for(const [i,no]of ['EMP001','EMP002','EMP003','EMP004'].entries()){
   const task=await tx.assessmentTask.create({data:{cycleId:cycle.id,employeeId:actors[no].id,managerId:actors.MGR001.id,
    deptId:actors[no].deptId,deptHeadId:actors.MGR001.id,approverId:owner.id,status:i===1?(${deletion}?'closed':'approval'):i===3?'indicator_drafting':'self_eval',
    ...(i===1?{approvedAt:new Date(),...(${deletion}?{closedAt:new Date(),publishedAt:new Date(),employeeConfirmedAt:new Date()}:{})}:{}),goalApprovedAt:i===3?null:new Date()}});
   const indicator=await tx.indicatorInstance.create({data:{taskId:task.id,name:prefix+' 原始目标',indicatorType:'kpi',
    dimensionName:'业务目标',dimensionWeight:1,weight:1,targetValue:10,sortOrder:0}});
   const version=await tx.indicatorVersion.create({data:{taskId:task.id,version:1,status:'active',createdById:owner.id,
    effectiveFromPeriodKey:'2026-11',activatedAt:new Date(),items:{create:[{sourceInstanceId:indicator.id,name:indicator.name,
     indicatorType:'kpi',dimensionName:'业务目标',dimensionWeight:1,weight:1,targetValue:10,sortOrder:0}]}}});
   const period=await tx.assessmentPeriod.create({data:{taskId:task.id,periodKey:'2026-11',periodType:'month',sequence:1,
    periodStart:new Date('2026-11-01'),periodEnd:new Date('2026-11-30'),selfEvalOpenAt:new Date('2026-11-01'),
    selfEvalDueAt:new Date('2026-12-01'),managerDueAt:new Date('2026-12-03'),managerId:actors.MGR001.id,
    indicatorVersionId:version.id,status:'self_eval'}});
   if(i===1)await tx.gradeResult.create({data:{taskId:task.id,approvedAt:new Date(),approverId:owner.id,calculatedScore:88,calibratedGrade:'B'}});
   if(i===2)await tx.assessmentTask.update({where:{id:task.id},data:{lifecycleStatus:'terminated',lifecycleVersion:1,
    terminatedAt:new Date(),terminatedById:owner.id,terminationReason:'虚构的既有终止记录'}});
   tasks.push({id:task.id,periodId:period.id,employeeNo:no,protected:i===1,alreadyEnded:i===2});
  }
  await tx.goalChangeRequest.create({data:{taskId:tasks[0].id,creatorId:actors.EMP001.id,status:'draft',beforeGoals:[],goals:[]}});
  const result={fictional:true,prefix,cycleId:cycle.id,cycleName:cycle.name,tasks,operator:{employeeNo:operator.employeeNo,password}};
  if(${demo})await tx.systemConfig.create({data:{key:marker,value:{...result,operator:{employeeNo:operator.employeeNo}}}});
  return result;
 },{timeout:30000});
})().then(result=>process.stdout.write(JSON.stringify(result))).finally(()=>db.$disconnect());`;
try {
  const result = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { input: source, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  // Non-demo credentials are for the coordinator's private test artifact only; never print to chat.
  const value = JSON.parse(result);
  if (demo && value.operator) delete value.operator.password;
  process.stdout.write(JSON.stringify(value));
} catch { console.error('Fictional cycle preparation refused or failed; subprocess details withheld.'); process.exitCode = 1; }
