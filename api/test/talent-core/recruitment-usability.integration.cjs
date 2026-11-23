require('../../prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
require('tsconfig-paths').register({baseUrl:process.cwd(),paths:{'@/*':['dist/src/*']}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();
const{TalentRecruitmentService}=require('../../dist/src/talent-pool/talent-recruitment.service');
const{TalentInterviewsService}=require('../../dist/src/talent-pool/talent-interviews.service');
const{plainToInstance}=require('class-transformer');
const{TalentInterviewQueueQueryDto}=require('../../dist/src/talent-pool/dto/talent-interview.dto');
const recruitment=new TalentRecruitmentService(db),interviews=new TalentInterviewsService(db);
const prefix='RU'+randomUUID().slice(0,8),ids=Array.from({length:4},()=>randomUUID()),[hrId,otherId,employeeId,candidateId]=ids;
const actor=(id,sysRole)=>({id,name:'虚构招聘联调',sysRole,deptId:null,isAssessorOnly:false,canViewAll:false,hrCapabilities:[]});
const hr=actor(hrId,'hr'),other=actor(otherId,'hr'),employee=actor(employeeId,'employee');
async function cleanup(){
 const apps=(await db.talentApplication.findMany({where:{candidateId},select:{id:true}})).map(x=>x.id);
 const invites=(await db.talentInterview.findMany({where:{candidateId},select:{id:true}})).map(x=>x.id);
 await db.$transaction(async tx=>{
  await tx.notificationLog.deleteMany({where:{userId:{in:ids.slice(0,3)}}});await tx.auditLog.deleteMany({where:{userId:{in:ids.slice(0,3)}}});
  await tx.talentInterviewFeedbackEvent.deleteMany({where:{interviewId:{in:invites}}});await tx.talentInterviewFeedback.deleteMany({where:{interviewId:{in:invites}}});
  await tx.talentInterviewSync.deleteMany({where:{interviewId:{in:invites}}});await tx.talentInterviewParticipant.deleteMany({where:{interviewId:{in:invites}}});
  await tx.talentInterview.deleteMany({where:{candidateId}});await tx.talentApplicationEvent.deleteMany({where:{applicationId:{in:apps}}});
  await tx.talentApplication.deleteMany({where:{candidateId}});await tx.talentCandidate.deleteMany({where:{id:candidateId}});await tx.user.deleteMany({where:{id:{in:ids.slice(0,3)}}});
 });
}
(async()=>{
 assert.equal((await db.systemConfig.findUnique({where:{key:'local_preview_fixture_v1'}}))?.value?.fictional,true);
 try{
  for(const [i,id] of ids.slice(0,3).entries())await db.user.create({data:{id,employeeNo:prefix+i,name:'虚构招聘联调'+i,accountType:'test',status:'active',sysRole:i===2?'employee':'hr',mustChangePassword:false}});
  await db.talentCandidate.create({data:{id:candidateId,name:'虚构招聘联调'+prefix,phone:prefix,sourceChannel:'other',createdById:hrId}});
  let a=await recruitment.create(candidateId,{positionName:prefix+'A',ownerId:hrId},hr);
  const b=await recruitment.create(candidateId,{positionName:prefix+'B',ownerId:otherId},hr);
  const query={keyword:prefix,scope:'all',page:1,pageSize:1,skip:0,take:1};
  const queue=await recruitment.queue(query,hr);assert.equal(queue.total,2);assert.equal(queue.items.length,1);
  await assert.rejects(()=>recruitment.queue(query,employee),e=>e.status===403);
  const invite=await interviews.create({candidateId,applicationId:a.id,startsAt:'2020-01-01T02:00:00Z',endsAt:'2020-01-01T03:00:00Z',participantIds:[employeeId],invitationText:'虚构面试邀请'},hr);
  assert.equal(invite.syncStatus,'unconfigured');assert.equal((await recruitment.detail(a.id,hr)).activitySummary.scheduledCount,1);
  assert.equal((await interviews.list({candidateId,applicationId:b.id},hr)).length,0);
  a=await recruitment.update(a.id,{ownerId:otherId,expectedRevision:a.revision},hr);
  const handed=await interviews.queue({scope:'responsible',keyword:prefix,page:1,pageSize:10,skip:0,take:10},other);
  assert.equal(handed.total,1);assert.equal(handed.items[0].id,invite.id);
  for(const scope of ['all','responsible'])await assert.rejects(()=>interviews.queue({scope},employee),e=>e.status===403);
  const feedbackQuery={scope:'mine',view:'feedback',page:1,pageSize:10,skip:0,take:10};
  assert.equal((await interviews.queue(feedbackQuery,employee)).total,1);
  await recruitment.saveFeedback(invite.id,{interviewVersion:invite.version,expectedRevision:0,outcome:'pass',summary:'虚构反馈',submit:true},employee);
  assert.equal((await interviews.queue(feedbackQuery,employee)).total,0);
  assert.equal((await recruitment.detail(a.id,hr)).activitySummary.unsubmittedFeedbackCount,0);
  await assert.rejects(()=>interviews.retrySync(invite.id,{version:invite.version},hr),e=>e.status===400);
  const legacy=await db.talentInterview.create({data:{candidateId,candidateNameSnapshot:prefix,startsAt:new Date('2020-01-01'),endsAt:new Date('2020-01-02'),invitationText:'虚构历史邀约',createdById:hrId,participants:{create:{userId:employeeId,userNameSnapshot:'虚构招聘联调2'}}}});
  await interviews.update(legacy.id,{version:1,note:'虚构历史维护'},hr);
  assert.equal((await db.talentInterview.findUnique({where:{id:legacy.id}})).applicationId,null);
  const firstPage=await interviews.queue(plainToInstance(TalentInterviewQueueQueryDto,{scope:'mine',page:'1',pageSize:'1'}),employee);
  const secondPage=await interviews.queue(plainToInstance(TalentInterviewQueueQueryDto,{scope:'mine',page:'2',pageSize:'1'}),employee);
  assert.equal(firstPage.items.length,1);assert.equal(secondPage.items.length,1);assert.notEqual(firstPage.items[0].id,secondPage.items[0].id);
  const future=await interviews.create({candidateId,applicationId:b.id,startsAt:'2040-01-01T02:00:00Z',endsAt:'2040-01-01T03:00:00Z',participantIds:[employeeId],invitationText:'虚构提前结束面试'},hr);
  await interviews.complete(future.id,{version:future.version},hr);
  assert.ok((await interviews.queue(plainToInstance(TalentInterviewQueueQueryDto,{scope:'mine',view:'feedback'}),employee)).items.some(i=>i.id===future.id));
  assert.equal(await db.talentInterviewSync.count({where:{interviewId:invite.id,status:'pending'}}),0);
  console.log(JSON.stringify({passed:true,applicationPagination:true,transformedInterviewPagination:true,earlyCompletedFeedback:true,ownerHandoff:true,isolatedPositions:true,ownFeedback:true,permissions:true,legacyPreserved:true,calendarOff:true}));
 }finally{await cleanup();}
})().finally(()=>db.$disconnect()).catch(e=>{console.error('Isolated recruitment integration failed: '+(e.code||e.name)+(e.name==='BadRequestException'?' '+e.message:''));process.exitCode=1});
