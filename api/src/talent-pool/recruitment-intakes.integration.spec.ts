import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from './talents.service';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { RecruitmentIntakesService } from './recruitment-intakes.service';
import { RecruitmentPostingsService } from './recruitment-postings.service';
import { RecruitmentIntakesController } from './recruitment-intakes.controller';
import { RecruitmentPostingsController } from './recruitment-postings.controller';

describe('resume intake isolated PostgreSQL and HTTP',()=>{
  let container:StartedPostgreSqlContainer|undefined,db:PrismaService,other:PrismaService,app:INestApplication;
  let intakes:RecruitmentIntakesService,postings:RecruitmentPostingsService,demands:RecruitmentDemandsService;
  let editor:AuthUser,second:AuthUser,reviewer:AuthUser,reader:AuthUser,confirmer:AuthUser,deptId:string,positionId:string,demandId:string;
  const identities=new Map<string,AuthUser>(),objects=new Map<string,Buffer>();
  const mailbox={status:jest.fn(()=>({configured:false})),readPage:jest.fn()};
  const resumes={parse:jest.fn(),parseText:jest.fn()};
  const storage={
    uploadIntakeFile:jest.fn(async(file:Express.Multer.File)=>{
      const objectKey=`recruitment-intake/fictional/${randomUUID()}-${file.originalname}`;
      objects.set(objectKey,file.buffer);return {objectKey,name:file.originalname,size:file.size,mimeType:file.mimetype,url:'never-use-generic-url'};
    }),
    readIntakeFile:jest.fn(async(key:string)=>{if(!objects.has(key))throw new Error('Synthetic missing object');return objects.get(key)!;}),
    removeObject:jest.fn(async(key:string)=>{objects.delete(key);}),
  };
  let serial=0;
  const candidate=()=>({name:'Synthetic intake candidate',phone:`199${String(++serial).padStart(8,'0')}`,sourceChannel:'referral'});
  const pdf=()=>({originalname:'fictional.pdf',mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic resume\n%%EOF'),size:Buffer.byteLength('%PDF-1.4\nSynthetic resume\n%%EOF')} as Express.Multer.File);
  beforeAll(async()=>{
    container=await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_resume_intake_owned_test').withStartupTimeout(60000).start();
    const databaseUrl=container.getConnectionUri(),url=new URL(databaseUrl);
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/hrm_resume_intake_owned_test')throw new Error('Owned loopback database required');
    try{execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,DATABASE_URL:databaseUrl},stdio:'pipe',timeout:90000});}
    catch{throw new Error('Owned intake migration failed');}
    db=new PrismaService({datasources:{db:{url:databaseUrl}}});other=new PrismaService({datasources:{db:{url:databaseUrl}}});await db.$connect();await other.$connect();
    const accounts:AuthUser[]=[];
    for(const [name,hrCapabilities]of [['Synthetic intake editor',['recruitment_edit']],['Synthetic second intake editor',['recruitment_edit']],
      ['Synthetic demand reviewer',['recruitment_demand_review']],['Synthetic intake viewer',['recruitment_view']],['Synthetic narrow confirmer',['talent_hiring_confirm']]] as const){
      const row=await db.user.create({data:{name,sysRole:'employee',status:'active',hrCapabilities:[...hrCapabilities]}});
      accounts.push({id:row.id,name:row.name,sysRole:row.sysRole,hrCapabilities:row.hrCapabilities,deptId:null,isAssessorOnly:false,canViewAll:false} as AuthUser);
    }
    [editor,second,reviewer,reader,confirmer]=accounts;for(const actor of accounts)identities.set(actor.id,actor);
    deptId=(await db.department.create({data:{name:'Synthetic intake department'}})).id;
    positionId=(await db.position.create({data:{code:'INTAKE-SYN',name:'Synthetic intake role'}})).id;
    demands=new RecruitmentDemandsService(db,{status:()=>({configured:false,missing:['synthetic_missing'],readOnly:true}),listIds:jest.fn(),readInstance:jest.fn()});
    const draft=await demands.createLocal({requestId:randomUUID(),deptId,positionId,headcount:2,reason:'Synthetic recruitment purpose'},editor);
    const pending=await demands.actLocal(draft.id,{expectedRevision:draft.revision,action:'submit'},editor);
    demandId=(await demands.actLocal(draft.id,{expectedRevision:pending.revision,action:'approve'},reviewer)).id;
    const talents=new TalentsService(db),recruitment=new TalentRecruitmentService(db,demands);
    intakes=new RecruitmentIntakesService(db,talents,recruitment,storage as never,resumes as never,mailbox as never);
    postings=new RecruitmentPostingsService(db,demands);
    const module=await Test.createTestingModule({controllers:[RecruitmentIntakesController,RecruitmentPostingsController],providers:[
      {provide:RecruitmentIntakesService,useValue:intakes},{provide:RecruitmentPostingsService,useValue:postings}]}).compile();
    app=module.createNestApplication({logger:false});app.use((req,_res,next)=>{req.user=identities.get(req.headers['x-test-user']);next();});
    app.useGlobalPipes(new ValidationPipe({transform:true,transformOptions:{enableImplicitConversion:true},whitelist:true,forbidNonWhitelisted:true}));await app.init();
  },150000);
  afterAll(async()=>{try{intakes?.onModuleDestroy();await app?.close();await other?.$disconnect();await db?.$disconnect();}finally{await container?.stop();}},30000);
  const post=(actor:AuthUser,route:string,body:object)=>request(app.getHttpServer()).post(route).set('x-test-user',actor.id).send(body);
  const get=(actor:AuthUser,route:string)=>request(app.getHttpServer()).get(route).set('x-test-user',actor.id);
  const postingBody=(extra={})=>({requestId:randomUUID(),demandId,channel:'fictional-channel',name:'Synthetic external role',url:`https://example.invalid/${randomUUID()}`,verifiedIdentity:true,evidence:'Synthetic stable identity was checked',...extra});
  async function manual(extra={}){return intakes.create({requestId:randomUUID(),state:'pending_review',sourceChannel:'referral',...extra},editor);}
  async function uploaded(extra={}){const row=await manual(extra);return intakes.upload(row.id,row.revision,pdf(),editor);}
  const mailPage=(id:string,attachments:unknown[]=[],bodyText='Name: Synthetic applicant\nPhone: 19900009999')=>({mailboxKey:'fictional-intake-mailbox',authorizedFrom:'2037-01-01T00:00:00.000Z',
    messages:[{id,receivedAt:'2037-01-02T00:00:00Z',subject:'Synthetic resume',bodyText,attachments}],nextCursor:null});
  async function waitParse(id:string){for(let i=0;i<100;i++){const row=await intakes.detail(id,editor);if(row.parseStatus!=='processing')return row;await new Promise(r=>setTimeout(r,10));}throw new Error('Synthetic parse did not settle');}

  it('guards all new raw ledgers against readers, narrow confirmers and reviewers',async()=>{
    const row=await manual();
    for(const actor of [reader,confirmer,reviewer]){
      await get(actor,'/recruitment-intakes').expect(403);await get(actor,`/recruitment-intakes/${row.id}`).expect(403);
      await get(actor,'/recruitment-postings').expect(403);await get(actor,'/recruitment-intakes/mailbox/status').expect(403);
    }
  });
  it('rejects string verification booleans over real HTTP',async()=>{
    await post(editor,'/recruitment-postings',postingBody({verifiedIdentity:'false'})).expect(400);
    await post(editor,'/recruitment-postings',postingBody({active:'false'})).expect(400);
  });
  it('preserves verified identity uniqueness and mapping history without rewriting an intake',async()=>{
    const body=postingBody(),first=await postings.create(body,editor);
    expect((await postings.create(body,editor))!.id).toBe(first!.id);
    await expect(postings.create({...body,requestId:randomUUID()},editor)).rejects.toMatchObject({status:409});
    const source=await manual({postingId:first!.id});
    const updated=await postings.update(first!.id,{expectedRevision:first!.revision,name:'Synthetic renamed external role',reason:'Synthetic renamed listing'},editor);
    expect(updated!.events).toHaveLength(2);
    const stored=await db.recruitmentIntake.findUniqueOrThrow({where:{id:source.id}});
    expect(stored.postingSnapshot).toMatchObject({revision:1,name:body.name,demandId});
    const replacement=await postings.create(postingBody(),editor);
    const remapped=await intakes.update(source.id,{expectedRevision:source.revision,postingId:replacement!.id},editor);
    expect(remapped.events?.at(-1)?.metadata).toMatchObject({mapping:{before:{postingId:first!.id,postingRevision:1,demandId},after:{postingId:replacement!.id,postingRevision:1,demandId}}});
    await expect(postings.update(first!.id,{expectedRevision:1,active:false,reason:'Synthetic stale edit'},editor)).rejects.toMatchObject({status:409});
  });
  it('creates idempotent waiting records and rejects rolling or ambiguous follow-up dates',async()=>{
    const body={requestId:randomUUID(),sourceChannel:'referral',nextFollowUpAt:'2037-01-03T10:00:00+08:00'};
    const row=await intakes.create(body,editor);expect((await intakes.create(body,editor)).id).toBe(row.id);
    await expect(intakes.create({...body,sourceNotes:'different intent'},editor)).rejects.toMatchObject({status:409});
    await expect(intakes.create(body,second)).rejects.toMatchObject({status:403});
    for(const nextFollowUpAt of ['2037-02-30T10:00:00Z','2037-01-01T10:00:00','2037-01-01'])await expect(manual({nextFollowUpAt})).rejects.toMatchObject({status:400});
  });
  it('uploads private files, denies arbitrary object keys and only publishes candidate binding on successful completion',async()=>{
    const row=await uploaded();expect(row.files[0].url).toContain(`/recruitment-intakes/${row.id}/files/`);
    await post(editor,'/recruitment-intakes',{requestId:randomUUID(),objectKey:'talent-resume/arbitrary'}).expect(400);
    const file=await db.recruitmentIntakeFile.findUniqueOrThrow({where:{id:row.files[0].id}});
    expect(file.objectKey.startsWith('recruitment-intake/')).toBe(true);expect(await db.talentResumeFile.count({where:{objectKey:file.objectKey}})).toBe(0);
    for(const actor of [reader,confirmer])await get(actor,`/recruitment-intakes/${row.id}/files/${file.id}`).expect(403);
    await get(editor,`/recruitment-intakes/${row.id}/files/${file.id}`).expect(200);
    const result=await intakes.confirm(row.id,{requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_only',candidate:candidate()},editor);
    expect(await db.talentResumeFile.count({where:{candidateId:result.candidateId!,objectKey:file.objectKey}})).toBe(1);
    expect(result.candidateUrl).toBe(`/talents?candidateId=${result.candidateId}`);expect(result.applicationId).toBeNull();
  });
  it('atomically confirms both modes with idempotency and no extra hiring snapshot or seats',async()=>{
    const row=await manual(),body={requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_application' as const,candidate:candidate(),application:{deptId,positionName:'Synthetic intake role'}};
    const result=await intakes.confirm(row.id,body,editor),retry=await intakes.confirm(row.id,body,editor);
    expect(retry.candidateId).toBe(result.candidateId);expect(retry.applicationId).toBe(result.applicationId);
    expect(result.applicationUrl).toBe(`/talents?candidateId=${result.candidateId}&applicationId=${result.applicationId}`);
    const application=await db.talentApplication.findUniqueOrThrow({where:{id:result.applicationId!},include:{events:true}});
    expect(application).toMatchObject({stage:'screening',recruitmentDemandId:null,recruitmentDemandSnapshot:null});expect(application.events.map(e=>e.action)).toEqual(['create']);
    await expect(intakes.confirm(row.id,{...body,candidate:{...body.candidate,name:'Changed intent'}},editor)).rejects.toMatchObject({status:409});
    await expect(intakes.confirm(row.id,body,second)).rejects.toMatchObject({status:403});
  });
  it('keeps missing phone or unconfirmed source pending without any partial candidate',async()=>{
    const row=await manual(),count=await db.talentCandidate.count();
    await expect(intakes.confirm(row.id,{requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_only',candidate:{name:'Synthetic missing identity',sourceChannel:'referral'} as never},editor)).rejects.toMatchObject({status:400});
    expect(await db.talentCandidate.count()).toBe(count);expect((await intakes.detail(row.id,editor)).state).toBe('pending_review');
    const noSource=await manual({sourceChannel:null});
    await expect(intakes.confirm(noSource.id,{requestId:randomUUID(),expectedRevision:noSource.revision,mode:'candidate_only',candidate:candidate()},editor)).rejects.toMatchObject({status:400});
  });
  it('reuses one candidate without replacing fields or follow-ups, requires explicit same-job reuse and permits another job',async()=>{
    const original=await new TalentsService(db).create(candidate(),editor);
    const follow=await db.talentFollowUp.create({data:{candidateId:original.id,occurredAt:new Date('2037-01-01'),channel:'phone',summary:'Synthetic existing follow-up',nextFollowUpAt:new Date('2037-02-01'),planStatus:'pending',createdById:editor.id}});
    const first=await manual({nextFollowUpAt:'2037-01-04T00:00:00Z'}),fields={deptId,positionName:'Synthetic first job'};
    const result=await intakes.confirm(first.id,{requestId:randomUUID(),expectedRevision:first.revision,mode:'candidate_application',existingCandidateId:original.id,application:fields},editor);
    const secondRow=await manual();
    await expect(intakes.confirm(secondRow.id,{requestId:randomUUID(),expectedRevision:secondRow.revision,mode:'candidate_application',existingCandidateId:original.id,application:fields},editor)).rejects.toMatchObject({status:409});
    const reused=await intakes.confirm(secondRow.id,{requestId:randomUUID(),expectedRevision:secondRow.revision,mode:'candidate_application',existingCandidateId:original.id,existingApplicationId:result.applicationId!,application:fields},editor);
    expect(reused.applicationId).toBe(result.applicationId);
    const third=await manual();await intakes.confirm(third.id,{requestId:randomUUID(),expectedRevision:third.revision,mode:'candidate_application',existingCandidateId:original.id,application:{deptId,positionName:'Synthetic second job'}},editor);
    expect(await db.talentApplication.count({where:{candidateId:original.id}})).toBe(2);
    expect(await db.talentFollowUp.findUnique({where:{id:follow.id}})).toEqual(follow);
    expect((await db.talentCandidate.findUniqueOrThrow({where:{id:original.id}})).name).toBe(original.name);
  });
  it('rolls back candidate and application creation when the existing candidate file cap fails',async()=>{
    const original=await new TalentsService(db).create(candidate(),editor),row=await uploaded();
    for(let i=0;i<3;i++)await db.talentResumeFile.create({data:{candidateId:original.id,objectKey:`talent-resume/fictional/${randomUUID()}`,fileName:'Synthetic.pdf',mimeType:'application/pdf',fileSize:10,uploadedById:editor.id}});
    await expect(intakes.confirm(row.id,{requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_application',existingCandidateId:original.id,application:{positionName:'Synthetic capped job'}},editor)).rejects.toMatchObject({status:409});
    expect(await db.talentApplication.count({where:{candidateId:original.id}})).toBe(0);expect((await intakes.detail(row.id,editor)).state).toBe('pending_review');
  });
  it('returns a phone-specific 409 when original candidate creation wins after intake precheck',async()=>{
    const row=await manual(),fields=candidate();
    const talents=(intakes as unknown as {talents:TalentsService}).talents;
    const original=talents.createInTransaction.bind(talents);
    const spy=jest.spyOn(talents,'createInTransaction').mockImplementationOnce(async(tx,input,user)=>{
      await new TalentsService(other).create(input,user);
      return original(tx,input,user);
    });
    try {
      await expect(intakes.confirm(row.id,{requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_only',candidate:fields},editor))
        .rejects.toMatchObject({status:409,response:{data:{reason:'TALENT_PHONE_EXISTS',candidateId:expect.any(String)}}});
      expect((await intakes.detail(row.id,editor)).state).toBe('pending_review');
      expect(await db.talentCandidate.count({where:{phone:fields.phone}})).toBe(1);
    }finally{spy.mockRestore();}
  });
  it('retains a private bound object when upload commit succeeds but its acknowledgement is lost',async()=>{
    const row=await manual(),original=db.$transaction.bind(db);
    const spy=jest.spyOn(db,'$transaction').mockImplementationOnce((async(...args:unknown[])=>{
      await (original as (...values:unknown[])=>Promise<unknown>)(...args);throw new Error('Synthetic commit acknowledgement lost');
    }) as never);
    try{await expect(intakes.upload(row.id,row.revision,pdf(),editor)).rejects.toThrow('Synthetic commit acknowledgement lost');}
    finally{spy.mockRestore();}
    const file=await db.recruitmentIntakeFile.findFirstOrThrow({where:{intakeId:row.id}});
    expect(objects.has(file.objectKey)).toBe(true);
    expect((await intakes.detail(row.id,editor)).files).toHaveLength(1);
  });
  it('requires a close reason and rejects stale versions without losing source follow-up',async()=>{
    const row=await manual({nextFollowUpAt:'2037-01-05T00:00:00Z'});
    await expect(intakes.close(row.id,{expectedRevision:row.revision,reason:' '},editor)).rejects.toMatchObject({status:400});
    const closed=await intakes.close(row.id,{expectedRevision:row.revision,reason:'Synthetic candidate ended communication'},editor);
    expect(closed.nextFollowUpAt).toBe(row.nextFollowUpAt);
    await expect(intakes.update(row.id,{expectedRevision:row.revision,sourceNotes:'stale'},editor)).rejects.toMatchObject({status:409});
  });
  it('returns 503 without a configured mailbox and writes no intake',async()=>{
    mailbox.status.mockReturnValue({configured:false});const count=await db.recruitmentIntake.count();
    await post(editor,'/recruitment-intakes/mailbox/sync',{}).expect(503);expect(await db.recruitmentIntake.count()).toBe(count);expect(mailbox.readPage).not.toHaveBeenCalled();
  });
  it('keeps whole-page cursor on a failed unit, replays without duplicates and quarantines unsupported/link-only material',async()=>{
    mailbox.status.mockReturnValue({configured:true});await db.recruitmentMailboxState.deleteMany();
    const id=`Synthetic-${randomUUID()}`,file=pdf(),page=mailPage(id,[{id:'one',fileName:'one.pdf',mimeType:file.mimetype,bytes:file.buffer},{id:'two',fileName:'two.pdf',mimeType:file.mimetype,bytes:file.buffer}]);page.nextCursor='synthetic-next' as never;
    mailbox.readPage.mockResolvedValue(page);storage.uploadIntakeFile.mockRejectedValueOnce(new Error('Synthetic transient storage failure'));
    const partial=await intakes.syncMailbox({limit:10},editor);expect(partial).toMatchObject({synced:1,failed:1,complete:false});
    expect((await db.recruitmentMailboxState.findUniqueOrThrow({where:{id:'primary'}})).cursor).toBeNull();
    const recovered=await intakes.syncMailbox({limit:10},editor);expect(recovered).toMatchObject({synced:1,skipped:1,failed:0,complete:true});
    expect(await db.recruitmentIntake.count({where:{messageId:id}})).toBe(2);
    const next=mailPage(`Synthetic-${randomUUID()}`,[{id:'unsupported',fileName:'sample.exe',mimeType:'application/octet-stream',bytes:Buffer.from('Synthetic unsupported')}]);
    mailbox.readPage.mockResolvedValue(next);await intakes.syncMailbox({limit:10},editor);
    expect(mailbox.readPage).toHaveBeenLastCalledWith({cursor:'synthetic-next',limit:10});
    expect(await db.recruitmentIntake.findFirst({where:{messageId:next.messages[0].id}})).toMatchObject({state:'needs_material',sourceChannel:null,issues:expect.arrayContaining(['unsupported_attachment','posting_unverified','source_unverified'])});
    mailbox.readPage.mockResolvedValue(mailPage(`Synthetic-${randomUUID()}`,[],'https://example.invalid/notification'));await intakes.syncMailbox({limit:10},editor);
    expect(await db.recruitmentIntake.count({where:{state:'needs_material',issues:{has:'link_only'}}})).toBe(1);
  });
  it('associates a mail source to the original waiting task without replacing owner, job or follow-up',async()=>{
    const waiting=await intakes.create({requestId:randomUUID(),state:'awaiting_resume',sourceChannel:'referral',ownerId:second.id,positionName:'Synthetic original intent',nextFollowUpAt:'2037-01-06T00:00:00Z'},editor);
    const messageId=`Synthetic-${randomUUID()}`;mailbox.readPage.mockResolvedValue(mailPage(messageId));await intakes.syncMailbox({limit:10},editor);
    const source=await db.recruitmentIntake.findFirstOrThrow({where:{messageId}});
    const merged=await intakes.associate(source.id,{expectedRevision:source.revision,targetIntakeId:waiting.id,expectedTargetRevision:waiting.revision},editor);
    expect(merged).toMatchObject({ownerId:second.id,positionName:'Synthetic original intent',nextFollowUpAt:waiting.nextFollowUpAt,associatedFromIds:[source.id],mail:{messageId}});
    expect((await intakes.detail(source.id,editor)).associatedToId).toBe(waiting.id);
  });

  it('persists a terminal checkpoint, reuses it on an empty poll and does not report endless pages',async()=>{
    mailbox.status.mockReturnValue({configured:true});await db.recruitmentMailboxState.deleteMany();
    const count=await db.recruitmentIntake.count();
    mailbox.readPage.mockResolvedValue({...mailPage('unused'),messages:[],checkpointCursor:'terminal-uid-10'});
    expect(await intakes.syncMailbox({limit:10},editor)).toMatchObject({synced:0,failed:0,complete:true,hasMore:false});
    expect((await db.recruitmentMailboxState.findUniqueOrThrow({where:{id:'primary'}})).cursor).toBe('terminal-uid-10');
    await intakes.syncMailbox({limit:10},editor);
    expect(mailbox.readPage).toHaveBeenLastCalledWith({cursor:'terminal-uid-10',limit:10});
    expect(await db.recruitmentIntake.count()).toBe(count);
  });

  it('does not advance a terminal checkpoint until every source unit persists, and quarantines without file writes',async()=>{
    mailbox.status.mockReturnValue({configured:true});
    const checkpoint={mailboxKey:'fictional-intake-mailbox',authorizedFrom:new Date('2037-01-01T00:00:00.000Z'),cursor:'terminal-uid-10',leaseToken:null,leaseUntil:null};
    await db.recruitmentMailboxState.upsert({where:{id:'primary'},create:{id:'primary',...checkpoint},update:checkpoint});
    const file=pdf(),id=`Synthetic-checkpoint-${randomUUID()}`;
    const next={...mailPage(id,[{id:'one',fileName:'one.pdf',mimeType:file.mimetype,bytes:file.buffer}]),checkpointCursor:'terminal-uid-11'};
    mailbox.readPage.mockResolvedValue(next);storage.uploadIntakeFile.mockRejectedValueOnce(new Error('Synthetic bounded storage failure'));
    expect(await intakes.syncMailbox({limit:10},editor)).toMatchObject({failed:1,complete:false});
    expect((await db.recruitmentMailboxState.findUniqueOrThrow({where:{id:'primary'}})).cursor).toBe('terminal-uid-10');
    expect(await intakes.syncMailbox({limit:10},editor)).toMatchObject({synced:1,failed:0,hasMore:false});
    expect((await db.recruitmentMailboxState.findUniqueOrThrow({where:{id:'primary'}})).cursor).toBe('terminal-uid-11');
    const calls=storage.uploadIntakeFile.mock.calls.length,largeId=`Synthetic-oversize-${randomUUID()}`;
    const large=mailPage(largeId,[],'');mailbox.readPage.mockResolvedValue({...large,checkpointCursor:'terminal-uid-12',messages:[{...large.messages[0],materialIssue:'file_too_large'}]});
    await intakes.syncMailbox({limit:10},editor);
    expect(storage.uploadIntakeFile.mock.calls.length).toBe(calls);
    expect(await db.recruitmentIntake.findFirst({where:{messageId:largeId}})).toMatchObject({state:'needs_material',issues:expect.arrayContaining(['file_too_large'])});
  });
  it('stores parse suggestions separately from manual fields, recovers expired work and retries failures',async()=>{
    const row=await uploaded({candidateDraft:{name:'Synthetic manual name'}});
    let finish:(value:unknown)=>void=()=>undefined;
    resumes.parse.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const started=await intakes.parse(row.id,{expectedRevision:row.revision},editor);
    for(let i=0;i<100&&!resumes.parse.mock.calls.length;i++)await new Promise(r=>setTimeout(r,5));
    const manualEdit=await intakes.update(row.id,{expectedRevision:started.revision,candidateDraft:{name:'Synthetic edited during parse'}},editor);
    finish({fields:{name:'Synthetic suggestion'},reviewItems:[]});const done=await waitParse(row.id);
    expect(done.candidateDraft).toEqual({name:'Synthetic edited during parse'});expect(done.parseResult).toMatchObject({fields:{name:'Synthetic suggestion'}});expect(done.revision).toBeGreaterThan(manualEdit.revision);
    await db.recruitmentIntake.update({where:{id:row.id},data:{parseStatus:'processing',parseToken:randomUUID(),parseDeadlineAt:new Date(Date.now()-1000)}});
    const expired=await intakes.detail(row.id,editor);expect(expired.parseStatus).toBe('failed');
    resumes.parse.mockRejectedValueOnce(new Error('Synthetic parse failure'));await intakes.parse(row.id,{expectedRevision:expired.revision},editor);
    const failed=await waitParse(row.id);expect(failed).toMatchObject({parseStatus:'failed',state:'needs_material'});
    resumes.parse.mockResolvedValueOnce({fields:{name:'Synthetic retry result'},reviewItems:[]});await intakes.parse(row.id,{expectedRevision:failed.revision},editor);
    expect(await waitParse(row.id)).toMatchObject({parseStatus:'succeeded',state:'pending_review',candidateDraft:{name:'Synthetic edited during parse'}});
  });
  it('never places phone, draft, parse fields or raw mail in audit/event metadata',async()=>{
    const row=await manual({candidateDraft:{name:'Synthetic protected draft',phone:'19999999999'}});
    await intakes.update(row.id,{expectedRevision:row.revision,candidateDraft:{name:'Synthetic updated protected draft',phone:'19999999999'}},editor);
    const events=await db.recruitmentIntakeEvent.findMany({where:{intakeId:row.id}}),audits=await db.auditLog.findMany({where:{entityType:'recruitment_intake',entityId:row.id}});
    const output=JSON.stringify([...events.map(e=>e.metadata),...audits.map(e=>e.newValue)]);
    expect(output).not.toContain('19999999999');expect(output).not.toContain('Synthetic protected');expect(output).not.toContain('Synthetic updated');
  });
  it('orders editor revocation ahead of a queued confirmation and commits no new candidate',async()=>{
    const row=await manual(),count=await db.talentCandidate.count();let release:()=>void=()=>undefined,ready:()=>void=()=>undefined;
    const held=new Promise<void>(r=>{release=r;}),locked=new Promise<void>(r=>{ready=r;});
    const revocation=other.$transaction(async tx=>{await tx.$executeRaw`UPDATE users SET hr_capabilities=ARRAY[]::varchar[] WHERE id=${second.id}::uuid`;ready();await held;},{timeout:15000});
    await locked;
    const pending=intakes.confirm(row.id,{requestId:randomUUID(),expectedRevision:row.revision,mode:'candidate_only',candidate:candidate()},second);
    await new Promise(r=>setTimeout(r,30));release();await revocation;
    await expect(pending).rejects.toMatchObject({status:403});expect(await db.talentCandidate.count()).toBe(count);
    await db.user.update({where:{id:second.id},data:{hrCapabilities:['recruitment_edit']}});
  });
});
