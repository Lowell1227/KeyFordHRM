import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { Prisma, RecruitmentIntake } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { isISO8601, validate } from 'class-validator';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService, StoredFileMeta } from '@/storage/storage.service';
import { TalentsService } from './talents.service';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { TalentResumeService, validateResumeFile } from './talent-resume.service';
import { assertRecruitmentEditor } from './talent-recruitment-policy';
import { TALENT_SOURCE_CHANNELS } from './talent.constants';
import { CreateTalentDto } from './dto/create-talent.dto';
import { RecruitmentMailboxGateway, normalizeRecruitmentMailboxPage, recruitmentMailUnits } from './recruitment-mail-gateway';
import { lockRecruitmentSources, recruitmentSourceTx, sourceFingerprint, sourceOwner } from './recruitment-postings.service';
import { AssociateRecruitmentIntakeDto, CloseRecruitmentIntakeDto, ConfirmRecruitmentIntakeDto, CreateRecruitmentIntakeDto, ParseRecruitmentIntakeDto, RecruitmentIntakeQueryDto, SyncRecruitmentMailboxDto, UpdateRecruitmentIntakeDto } from './recruitment-intakes.dto';
import type { RecruitmentIntakeView, RecruitmentMailboxSyncView } from './recruitment-intakes.types';
import { intakeFollowUpSources, selectIntakeFollowUpSource, transferIntakeFollowUpPlan } from './talent-follow-up-transfer';

const include = { files: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.RecruitmentIntakeInclude;
type Intake = Prisma.RecruitmentIntakeGetPayload<{ include: typeof include }>;
const OPEN = ['awaiting_resume','pending_review','needs_material'];
const PARSE_MS = 150000;
const LEASE_MS = 120000;
const MATERIAL_ISSUES = ['link_only','missing_material','body_too_large','notification_only','unsupported_attachment','file_too_large'];
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
function text(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new BadRequestException('资料文本格式或长度无效');
  return value.trim() || null;
}
export function recruitmentFollowUpDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isISO8601(value,{ strict:true,strictSeparator:true }) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new BadRequestException('下次跟进时间须为有效且包含时区的完整日期时间');
  }
  return new Date(value);
}

@Injectable()
export class RecruitmentIntakesService implements OnModuleDestroy {
  private readonly parsing = new Map<string, AbortController>();
  constructor(private readonly db: PrismaService, private readonly talents: TalentsService,
    private readonly recruitment: TalentRecruitmentService, private readonly storage: StorageService,
    private readonly resumes: TalentResumeService, private readonly mailbox: RecruitmentMailboxGateway) {}
  onModuleDestroy() { for (const controller of this.parsing.values()) controller.abort(); }

  private async lock(tx: Prisma.TransactionClient, user: AuthUser) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-intake-ledger',0))`;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR SHARE`;
    return assertRecruitmentEditor(tx,user);
  }
  private revision(row: RecruitmentIntake, expected: number) {
    if (!Number.isInteger(expected) || row.revision !== expected) throw new ConflictException('收件资料已更新，请保留输入并刷新后重试');
  }
  private open(row: RecruitmentIntake) {
    if (!OPEN.includes(row.state) || row.associatedToId) throw new ConflictException('该来源待办已办结或关闭，不能继续修改');
  }
  private async row(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.recruitmentIntake.findUnique({ where:{id},include });
    if (!row) throw new NotFoundException('简历收件不存在');
    return row;
  }
  private async event(tx: Prisma.TransactionClient, row: RecruitmentIntake, user: AuthUser, action: string,
    reason: string | null = null, extra: Record<string,unknown> = {}) {
    const metadata = json({ state:row.state,revision:row.revision,candidateId:row.candidateId,applicationId:row.applicationId,...extra });
    await tx.recruitmentIntakeEvent.create({ data:{intakeId:row.id,revision:row.revision,actorId:user.id,action,reason,metadata} });
    await tx.auditLog.create({ data:{userId:user.id,action,entityType:'recruitment_intake',entityId:row.id,newValue:metadata} });
  }
  private mapping(row:RecruitmentIntake) {
    const snapshot=row.postingSnapshot as Record<string,unknown>|null;
    return {postingId:row.postingId,postingRevision:typeof snapshot?.revision==='number'?snapshot.revision:null,demandId:row.demandId};
  }
  private async context(tx: Prisma.TransactionClient, input: Partial<CreateRecruitmentIntakeDto>, old?: RecruitmentIntake) {
    if (input.ownerId !== undefined && (typeof input.ownerId !== 'string' || !input.ownerId)) {
      throw new BadRequestException('请选择当前具备招聘经办权限的负责人');
    }
    const ownerId = input.ownerId ?? old?.ownerId;
    if (ownerId) await sourceOwner(tx,ownerId);
    const data: Prisma.RecruitmentIntakeUncheckedUpdateInput = {};
    if (input.ownerId !== undefined) data.ownerId=input.ownerId;
    if (input.sourceChannel !== undefined) {
      if (input.sourceChannel !== null && !(TALENT_SOURCE_CHANNELS as readonly string[]).includes(input.sourceChannel)) throw new BadRequestException('请核对实际来源渠道');
      data.sourceChannel=input.sourceChannel;
    }
    if (input.state !== undefined) {
      if (!OPEN.includes(input.state)) throw new BadRequestException('请通过对应办理动作完成或关闭待办');
      data.state=input.state;
    }
    if (input.positionName !== undefined) data.positionName=text(input.positionName,100);
    if (input.sourceNotes !== undefined) data.sourceNotes=text(input.sourceNotes,2000);
    if (input.nextFollowUpAt !== undefined) data.nextFollowUpAt=recruitmentFollowUpDate(input.nextFollowUpAt);
    if (input.candidateDraft !== undefined) data.candidateDraft=input.candidateDraft == null ? Prisma.DbNull : json(input.candidateDraft);
    if (input.applicationDraft !== undefined) data.applicationDraft=input.applicationDraft == null ? Prisma.DbNull : json(input.applicationDraft);
    if (input.postingId !== undefined || input.demandId !== undefined) {
      const postingId=input.postingId !== undefined ? input.postingId : old?.postingId ?? null;
      const posting=postingId ? await tx.recruitmentPosting.findUnique({where:{id:postingId}}) : null;
      if (postingId && !posting?.active) throw new BadRequestException('请选择当前有效的外部职位登记');
      const demandId=input.demandId !== undefined ? input.demandId : posting?.verifiedIdentity ? posting.demandId : old?.demandId ?? null;
      if (posting?.verifiedIdentity && demandId && posting.demandId!==demandId) throw new ConflictException('所选需求与已核对职位的当前归属不一致');
      if (demandId && !await tx.recruitmentDemand.findUnique({where:{id:demandId},select:{id:true}})) throw new BadRequestException('需求不存在');
      data.postingId=postingId; data.demandId=demandId;
      data.postingSnapshot=posting ? json({postingId:posting.id,revision:posting.revision,demandId:posting.verifiedIdentity ? posting.demandId : null,
        verifiedIdentity:posting.verifiedIdentity,channel:posting.channel,name:posting.name,url:posting.url,externalId:posting.externalId}) : Prisma.DbNull;
    }
    return data;
  }
  private async related(tx: Prisma.TransactionClient,id: string) {
    return tx.recruitmentIntake.findMany({where:{associatedToId:id},include,orderBy:{createdAt:'asc'}});
  }
  private async view(row: Intake, detail=false): Promise<RecruitmentIntakeView> {
    const related=detail ? await this.related(this.db,row.id) : [];
    const files=[...row.files,...related.flatMap(source=>source.files)];
    const owner=await this.db.user.findUnique({where:{id:row.ownerId},select:{name:true}});
    const mailRow=row.transport==='email' ? row : related.find(source=>source.transport==='email');
    const result: RecruitmentIntakeView={id:row.id,revision:row.revision,state:row.state as RecruitmentIntakeView['state'],transport:row.transport as 'manual'|'email',
      ownerId:row.ownerId,ownerName:owner?.name ?? null,sourceChannel:row.sourceChannel,postingId:row.postingId,demandId:row.demandId,
      positionName:row.positionName,sourceNotes:row.sourceNotes,nextFollowUpAt:row.nextFollowUpAt?.toISOString() ?? null,
      candidateDraft:row.candidateDraft as Record<string,unknown>|null,applicationDraft:row.applicationDraft as Record<string,unknown>|null,
      parseStatus:row.parseStatus as RecruitmentIntakeView['parseStatus'],parseResult:row.parseResult as Record<string,unknown>|null,parseMessage:row.parseMessage,
      issues:[...new Set([...row.issues.filter(issue=>issue!=='source_unverified'&&!(files.length&&MATERIAL_ISSUES.includes(issue))),...(!row.sourceChannel?['source_unverified']:[])])],files:files.map(file=>({id:file.id,fileName:file.fileName,mimeType:file.mimeType,fileSize:file.fileSize,
        url:`/recruitment-intakes/${row.id}/files/${file.id}`,createdAt:file.createdAt.toISOString()})),candidateId:row.candidateId,applicationId:row.applicationId,
      candidateUrl:row.candidateId ? `/talents?candidateId=${row.candidateId}` : null,
      applicationUrl:row.applicationId ? `/talents?candidateId=${row.candidateId}&applicationId=${row.applicationId}` : null,
      associatedToId:row.associatedToId,associatedFromIds:related.map(source=>source.id),closeReason:row.closeReason,
      mail:mailRow ? {messageId:mailRow.messageId!,receivedAt:mailRow.receivedAt!.toISOString(),subject:mailRow.subject ?? '',bodyText:mailRow.bodyText ?? '',sourcePartId:mailRow.sourcePartId!,...(typeof this.mailbox.sourceForKey==='function'?this.mailbox.sourceForKey(mailRow.mailboxKey):{mailboxId:null,mailboxName:null})} : null,
      createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
    if(detail) {
      result.followUpSources=intakeFollowUpSources(row,related);
      const events=await this.db.recruitmentIntakeEvent.findMany({where:{intakeId:row.id},orderBy:{revision:'asc'}});
      const names=new Map((await this.db.user.findMany({where:{id:{in:events.map(e=>e.actorId)}},select:{id:true,name:true}})).map(actor=>[actor.id,actor.name]));
      result.events=events.map(e=>({id:e.id,action:e.action,revision:e.revision,actorName:names.get(e.actorId) ?? null,reason:e.reason,createdAt:e.createdAt.toISOString(),metadata:e.metadata as Record<string,unknown>}));
    }
    return result;
  }
  private async expireParsing(user:AuthUser,id?:string) {
    await this.db.$transaction(async tx=>{
      await this.lock(tx,user);
      const rows=await tx.recruitmentIntake.findMany({where:{...(id?{id}:{}),state:{in:OPEN},parseStatus:'processing',parseDeadlineAt:{lte:new Date()}}});
      for(const old of rows) {
        const row=await tx.recruitmentIntake.update({where:{id:old.id},data:{state:'needs_material',parseStatus:'failed',parseToken:null,parseMessage:'解析超时或服务已中断，可重试或手工填写',revision:{increment:1},updatedAt:new Date()}});
        await this.event(tx,row,user,'parse_expired');
      }
    },recruitmentSourceTx);
  }
  async list(query:RecruitmentIntakeQueryDto,user:AuthUser) {
    await assertRecruitmentEditor(this.db,user); await this.expireParsing(user);
    const keyword=query.keyword?.trim();
    const linkedCandidates=keyword ? await this.db.talentCandidate.findMany({where:{deletedAt:null,OR:[
      {name:{contains:keyword,mode:'insensitive'}},{phone:{contains:keyword,mode:'insensitive'}}]},select:{id:true}}) : [];
    const where:Prisma.RecruitmentIntakeWhereInput={...(query.state?{state:query.state}:{}),...(query.ownerId?{ownerId:query.ownerId}:{}),
      ...(query.demandId?{demandId:query.demandId}:{}),...(query.postingId?{postingId:query.postingId}:{}),...(query.sourceChannel?{sourceChannel:query.sourceChannel}:{}),
      ...(keyword?{OR:[...['positionName','sourceNotes','subject'].map(field=>({[field]:{contains:keyword,mode:'insensitive'}})),
        ...['name','phone'].map(field=>({candidateDraft:{path:[field],string_contains:keyword}})),
        ...(linkedCandidates.length?[{candidateId:{in:linkedCandidates.map(candidate=>candidate.id)}}]:[])]}:{})};
    if(query.workQueue)where.AND=[{associatedToId:null},query.workQueue==='assignment'
      ? {demandId:null,state:{in:OPEN}} : {demandId:{not:null},state:{in:['pending_review','needs_material']}}];
    const [rows,total]=await this.db.$transaction([this.db.recruitmentIntake.findMany({where,include,orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),this.db.recruitmentIntake.count({where})]);
    return {items:await Promise.all(rows.map(row=>this.view(row))),total,page:query.page,pageSize:query.pageSize};
  }
  async detail(id:string,user:AuthUser) {
    await assertRecruitmentEditor(this.db,user); await this.expireParsing(user,id);
    return this.view(await this.row(this.db,id),true);
  }
  async create(input:CreateRecruitmentIntakeDto,user:AuthUser) {
    const id=await this.db.$transaction(async tx=>{
      await this.lock(tx,user);
      const fingerprint=sourceFingerprint(input),old=await tx.recruitmentIntake.findUnique({where:{requestId:input.requestId}});
      if(old) {
        if(old.createdById!==user.id) throw new ForbiddenException('该登记请求不属于当前经办人');
        if(old.creationFingerprint!==fingerprint) throw new ConflictException('该登记请求已用于其他内容');
        return old.id;
      }
      const fields=await this.context(tx,{...input,ownerId:input.ownerId ?? user.id});
      const row=await tx.recruitmentIntake.create({data:{...fields as Prisma.RecruitmentIntakeUncheckedCreateInput,requestId:input.requestId,creationFingerprint:fingerprint,
        ownerId:input.ownerId ?? user.id,createdById:user.id,state:input.state ?? 'awaiting_resume',transport:'manual'}});
      await this.event(tx,row,user,'create_intake',null,{mapping:{before:null,after:this.mapping(row)}});return row.id;
    },recruitmentSourceTx);
    return this.detail(id,user);
  }
  async update(id:string,input:UpdateRecruitmentIntakeDto,user:AuthUser) {
    await this.db.$transaction(async tx=>{
      await this.lock(tx,user);const old=await this.row(tx,id);this.revision(old,input.expectedRevision);this.open(old);
      const fields=await this.context(tx,input,old);
      const issues=old.issues.filter(issue=>!(issue==='source_unverified'&&input.sourceChannel)&&!(issue==='posting_unverified'&&(input.demandId||input.postingId)));
      const row=await tx.recruitmentIntake.update({where:{id},data:{...fields,issues,revision:{increment:1},updatedAt:new Date()}});
      await this.event(tx,row,user,'update_intake',null,{changedFields:Object.keys(fields),mapping:{before:this.mapping(old),after:this.mapping(row)}});
    },recruitmentSourceTx);
    return this.detail(id,user);
  }
  async close(id:string,input:CloseRecruitmentIntakeDto,user:AuthUser) {
    const reason=text(input.reason,2000);if(!reason)throw new BadRequestException('请填写关闭原因');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,user);const old=await this.row(tx,id);this.revision(old,input.expectedRevision);this.open(old);
      const row=await tx.recruitmentIntake.update({where:{id},data:{state:'closed',closeReason:reason,parseToken:null,parseStatus:old.parseStatus==='processing'?'failed':old.parseStatus,revision:{increment:1},updatedAt:new Date()}});
      await this.event(tx,row,user,'close_intake',reason);
    },recruitmentSourceTx);
    this.parsing.get(id)?.abort();return this.detail(id,user);
  }
  async associate(id:string,input:AssociateRecruitmentIntakeDto,user:AuthUser) {
    if(id===input.targetIntakeId)throw new BadRequestException('不能关联到自身');
    await this.db.$transaction(async tx=>{
      await this.lock(tx,user);const source=await this.row(tx,id),target=await this.row(tx,input.targetIntakeId);
      this.revision(source,input.expectedRevision);this.revision(target,input.expectedTargetRevision);this.open(source);this.open(target);
      if(source.transport!=='email'||target.transport!=='manual'||target.state!=='awaiting_resume') throw new BadRequestException('请选择尚未办结的邮件及原待收简历待办');
      if(source.parseStatus==='processing'||target.parseStatus==='processing')throw new ConflictException('请等待解析结束后再关联');
      const related=await this.related(tx,target.id);
      if(source.files.length+target.files.length+related.flatMap(r=>r.files).length>3)throw new ConflictException('合并后的简历文件超过3个，请先核对资料');
      const closed=await tx.recruitmentIntake.update({where:{id},data:{associatedToId:target.id,state:'closed',closeReason:'已关联到原待收简历待办',revision:{increment:1},updatedAt:new Date()}});
      const updated=await tx.recruitmentIntake.update({where:{id:target.id},data:{state:source.state==='needs_material'?'needs_material':'pending_review',revision:{increment:1},updatedAt:new Date()}});
      await this.event(tx,closed,user,'associate_intake',null,{targetIntakeId:target.id});
      await this.event(tx,updated,user,'receive_associated_intake',null,{sourceIntakeId:id});
    },recruitmentSourceTx);
    return this.detail(input.targetIntakeId,user);
  }

  private multer(file:{fileName:string;mimeType:string;bytes:Buffer}):Express.Multer.File {
    return {originalname:file.fileName,mimetype:file.mimeType,buffer:file.bytes,size:file.bytes.length} as Express.Multer.File;
  }
  async upload(id:string,expectedRevision:number,file:Express.Multer.File|undefined,user:AuthUser) {
    await assertRecruitmentEditor(this.db,user);
    const before=await this.row(this.db,id);this.open(before);this.revision(before,expectedRevision);
    await validateResumeFile(file);
    const fingerprint=createHash('sha256').update(file!.buffer).update(file!.originalname).digest('hex');
    const stored=await this.storage.uploadIntakeFile(file!);
    let used=false;
    try {
      await this.db.$transaction(async tx=>{
        await this.lock(tx,user);const old=await this.row(tx,id);this.open(old);this.revision(old,expectedRevision);
        if(old.files.some(f=>f.fingerprint===fingerprint))return;
        const related=await this.related(tx,id);
        if(old.files.length+related.flatMap(r=>r.files).length>=3)throw new ConflictException('简历文件最多3个');
        await this.storeFile(tx,id,stored,fingerprint,user);used=true;
        const row=await tx.recruitmentIntake.update({where:{id},data:{state:'pending_review',issues:old.issues.filter(issue=>!MATERIAL_ISSUES.includes(issue)),revision:{increment:1},updatedAt:new Date()}});
        await this.event(tx,row,user,'upload_intake_file');
      },recruitmentSourceTx);
    } catch(error) { used=false;throw error; }
    finally {if(!used)await this.discardIfUnbound(stored.objectKey);}
    return this.detail(id,user);
  }
  private async storeFile(tx:Prisma.TransactionClient,intakeId:string,stored:StoredFileMeta,fingerprint:string,user:AuthUser) {
    if(!stored.objectKey.startsWith('recruitment-intake/'))throw new BadRequestException('收件附件必须保存在专用私有区域');
    return tx.recruitmentIntakeFile.create({data:{intakeId,objectKey:stored.objectKey,fileName:stored.name,mimeType:stored.mimeType,fileSize:stored.size,fingerprint,uploadedById:user.id}});
  }
  private async discardIfUnbound(objectKey:string) {
    if(!objectKey.startsWith('recruitment-intake/'))return;
    try {
      // Wait out a possibly committed transaction before deciding an object is orphaned.
      const bound=await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('recruitment-intake-ledger',0))`;
        return tx.recruitmentIntakeFile.findUnique({where:{objectKey},select:{id:true}});
      },recruitmentSourceTx);
      if(!bound)await this.storage.removeObject(objectKey);
    }catch{ /* Unknown outcome: retain the private object rather than delete committed material. */ }
  }
  private async accessibleFile(tx:Prisma.TransactionClient,id:string,fileId:string) {
    const row=await this.row(tx,id);
    const file=await tx.recruitmentIntakeFile.findUnique({where:{id:fileId}});
    if(!file)throw new NotFoundException('收件附件不存在');
    if(file.intakeId!==id&&!await tx.recruitmentIntake.findFirst({where:{id:file.intakeId,associatedToId:id},select:{id:true}}))throw new NotFoundException('收件附件不属于此待办');
    const resultRow=row.associatedToId ? await this.row(tx,row.associatedToId) : row;
    if(resultRow.candidateId&&!await tx.talentCandidate.findFirst({where:{id:resultRow.candidateId,deletedAt:null},select:{id:true}}))throw new NotFoundException('关联人才已删除，不能读取附件');
    return file;
  }
  async file(id:string,fileId:string,user:AuthUser) {
    const file=await this.db.$transaction(async tx=>{await this.lock(tx,user);return this.accessibleFile(tx,id,fileId);},recruitmentSourceTx);
    const buffer=await this.storage.readIntakeFile(file.objectKey);
    await this.db.$transaction(async tx=>{await this.lock(tx,user);await this.accessibleFile(tx,id,fileId);},recruitmentSourceTx);
    return new StreamableFile(buffer,{type:file.mimeType,disposition:`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,length:buffer.length});
  }

  async parse(id:string,input:ParseRecruitmentIntakeDto,user:AuthUser) {
    await assertRecruitmentEditor(this.db,user);await this.expireParsing(user,id);
    const token=randomUUID();
    const source=await this.db.$transaction(async tx=>{
      await this.lock(tx,user);const old=await this.row(tx,id);this.open(old);this.revision(old,input.expectedRevision);
      if(old.parseStatus==='processing')throw new ConflictException('此收件正在解析，请稍候查看结果');
      const related=await this.related(tx,id),files=[...old.files,...related.flatMap(r=>r.files)];
      const file=input.fileId ? files.find(f=>f.id===input.fileId) : files[0];
      if(input.fileId&&!file)throw new BadRequestException('解析附件不属于当前待办');
      const body=old.bodyText || related.find(r=>r.bodyText)?.bodyText;
      if(!file&&!body)throw new BadRequestException('请先补充可解析的原简历资料');
      const row=await tx.recruitmentIntake.update({where:{id},data:{parseStatus:'processing',parseToken:token,parseDeadlineAt:new Date(Date.now()+PARSE_MS),parseMessage:null,revision:{increment:1},updatedAt:new Date()}});
      await this.event(tx,row,user,'start_intake_parse');return {file,body};
    },recruitmentSourceTx);
    const controller=new AbortController();this.parsing.set(id,controller);
    void this.runParse(id,token,source,user,controller).catch(()=>undefined);
    return this.detail(id,user);
  }
  private async runParse(id:string,token:string,source:{file?:Intake['files'][number];body?:string|null},user:AuthUser,controller:AbortController) {
    const timer=setTimeout(()=>controller.abort(),PARSE_MS);timer.unref?.();
    let result:unknown,failed=false;
    try {
      if(source.file) {
        const bytes=await this.storage.readIntakeFile(source.file.objectKey);
        await assertRecruitmentEditor(this.db,user);
        result=await this.resumes.parse(this.multer({fileName:source.file.fileName,mimeType:source.file.mimeType,bytes}),user,{signal:controller.signal});
      } else {
        await assertRecruitmentEditor(this.db,user);
        result=await this.resumes.parseText(source.body!,user,{signal:controller.signal});
      }
    } catch {failed=true;}
    finally {clearTimeout(timer);if(this.parsing.get(id)===controller)this.parsing.delete(id);}
    await this.db.$transaction(async tx=>{
      await this.lock(tx,user);const old=await this.row(tx,id);
      if(!OPEN.includes(old.state)||old.parseToken!==token||old.parseStatus!=='processing')return;
      if(!old.parseDeadlineAt||old.parseDeadlineAt.getTime()<=Date.now()||controller.signal.aborted)failed=true;
      const row=await tx.recruitmentIntake.update({where:{id},data:{state:failed?'needs_material':'pending_review',parseStatus:failed?'failed':'succeeded',parseToken:null,
        parseResult:failed?Prisma.DbNull:json(result),parseMessage:failed?'解析未完成，可重试或手工核对填写':null,revision:{increment:1},updatedAt:new Date()}});
      // Suggestions are separate from both manually maintained drafts.
      await this.event(tx,row,user,failed?'fail_intake_parse':'finish_intake_parse');
    },recruitmentSourceTx);
  }

  async confirm(id:string,input:ConfirmRecruitmentIntakeDto,user:AuthUser) {
    await assertRecruitmentEditor(this.db,user);
    const baseIntent={mode:input.mode,existingCandidateId:input.existingCandidateId,candidate:input.candidate,
      application:input.application,existingApplicationId:input.existingApplicationId,expectedExistingApplicationRevision:input.expectedExistingApplicationRevision};
    const fingerprint=sourceFingerprint({...baseIntent,followUpPlanAction:input.followUpPlanAction ?? 'keep',
      expectedFollowUpPlanId:input.expectedFollowUpPlanId ?? null,followUpSourceIntakeId:input.followUpSourceIntakeId ?? null,
      expectedFollowUpSourceAt:input.expectedFollowUpSourceAt ? recruitmentFollowUpDate(input.expectedFollowUpSourceAt)!.toISOString() : null});
    // Old in-flight confirmations had no source/plan choice. Recover them without replaying a transfer.
    const legacyFingerprint=!input.followUpSourceIntakeId&&!input.expectedFollowUpSourceAt&&!input.expectedFollowUpPlanId
      &&input.followUpPlanAction!=='replace' ? sourceFingerprint(baseIntent) : null;
    try { await this.db.$transaction(async tx=>{
      await lockRecruitmentSources(tx,user);
      await this.lock(tx,user);const old=await this.row(tx,id);
      const previous=await tx.recruitmentIntake.findUnique({where:{confirmRequestId:input.requestId}});
      if(previous) {
        if(previous.confirmedById!==user.id)throw new ForbiddenException('该办理请求不属于当前经办人');
        if(previous.id!==id||(previous.confirmFingerprint!==fingerprint&&!(legacyFingerprint&&previous.confirmFingerprint===legacyFingerprint)))throw new ConflictException('该办理请求已用于其他内容');
        return;
      }
      this.revision(old,input.expectedRevision);this.open(old);
      if(old.state!=='pending_review')throw new BadRequestException('请先补齐原简历资料并核对后办理入库');
      if(!old.sourceChannel||!(TALENT_SOURCE_CHANNELS as readonly string[]).includes(old.sourceChannel))throw new BadRequestException('请先核对本次收件的实际来源渠道，邮件只是收件方式');
      if(Boolean(input.existingCandidateId)===Boolean(input.candidate))throw new BadRequestException('请明确选择复用人才或创建人才，不能同时选择');
      if(input.mode==='candidate_only'&&(input.application||input.existingApplicationId))throw new BadRequestException('仅入库不能同时建立应聘');
      if(!['candidate_only','candidate_application'].includes(input.mode))throw new BadRequestException('请选择入库方式');
      const related=await this.related(tx,id);
      const followUpSource=selectIntakeFollowUpSource(old,related,input);
      if(!followUpSource&&input.followUpPlanAction==='replace')throw new BadRequestException('本次收件没有需要承接的跟进安排');
      let candidateId:string;
      if(input.existingCandidateId) {
        await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id=${input.existingCandidateId}::uuid FOR UPDATE`;
        const candidate=await tx.talentCandidate.findFirst({where:{id:input.existingCandidateId,deletedAt:null}});
        if(!candidate)throw new NotFoundException('复用人才不存在或已删除');candidateId=candidate.id;
      } else {
        const candidate=plainToInstance(CreateTalentDto,input.candidate!);
        if((await validate(candidate,{whitelist:true,forbidNonWhitelisted:true})).length)throw new BadRequestException('请补齐并核对姓名、手机号、实际来源及人才字段');
        if(candidate.sourceChannel!==old.sourceChannel)throw new ConflictException('新人才来源与本次已核对收件来源不一致，请核对后再提交');
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`recruitment-intake-phone:${candidate.phone}`},0))`;
        const duplicate=await tx.talentCandidate.findFirst({where:{phone:candidate.phone,deletedAt:null},select:{id:true}});
        if(duplicate)throw new ConflictException({message:'该手机号已有人才档案，请核对后明确选择复用',data:{reason:'TALENT_PHONE_EXISTS',candidateId:duplicate.id}});
        candidateId=(await this.talents.createInTransaction(tx,candidate,user)).id;
      }
      let applicationId:string|null=null;
      if(input.mode==='candidate_application') {
        if(!input.application?.positionName?.trim())throw new BadRequestException('入库并创建应聘须明确确认应聘岗位');
        if(input.application.sourceChannel!=null&&input.application.sourceChannel!==old.sourceChannel)throw new ConflictException('本次应聘来源与已核对收件来源不一致，请先核对来源');
        if(old.demandId&&input.application.intentDemandId!==undefined&&input.application.intentDemandId!==old.demandId)throw new ConflictException('本次应聘意向与收件关联需求不一致，请先核对收件归属');
        const fields={...input.application,sourceChannel:old.sourceChannel,intentDemandId:input.application.intentDemandId??old.demandId};
        const same=await tx.talentApplication.findMany({where:{candidateId,positionName:fields.positionName.trim(),deptId:fields.deptId??null},select:{id:true}});
        if(input.existingApplicationId) {
          if(!same.some(app=>app.id===input.existingApplicationId))throw new ConflictException('选择复用的应聘与本人才、部门或岗位不一致');
          await this.recruitment.reuseForIntake(tx,input.existingApplicationId,candidateId,fields,input.expectedExistingApplicationRevision,user);
          applicationId=input.existingApplicationId;
        } else {
          if(same.length)throw new ConflictException({message:'该人才已有同部门同岗位应聘，请明确选择原应聘办理',data:{reason:'TALENT_APPLICATION_EXISTS',applicationIds:same.map(app=>app.id)}});
          applicationId=(await this.recruitment.createInTransaction(tx,candidateId,{...fields,requestId:undefined},user)).id;
        }
      }
      const files=[...old.files,...related.flatMap(row=>row.files)];
      const existingFiles=await tx.talentResumeFile.findMany({where:{candidateId},select:{objectKey:true}});
      const additions=files.filter(file=>!existingFiles.some(existing=>existing.objectKey===file.objectKey));
      if(existingFiles.length+additions.length>3)throw new ConflictException('目标人才简历文件最多3个，请先核对已有资料');
      for(const [index,file]of additions.entries()) {
        if(!file.objectKey.startsWith('recruitment-intake/'))throw new BadRequestException('附件归属校验失败');
        await tx.talentResumeFile.create({data:{candidateId,objectKey:file.objectKey,fileName:file.fileName,mimeType:file.mimeType,fileSize:file.fileSize,
          sortOrder:existingFiles.length+index,uploadedById:user.id}});
      }
      if(followUpSource)await transferIntakeFollowUpPlan(tx,followUpSource,candidateId,input,user.id);
      const row=await tx.recruitmentIntake.update({where:{id},data:{state:'completed',candidateId,applicationId,confirmRequestId:input.requestId,
        confirmFingerprint:fingerprint,confirmedById:user.id,parseToken:null,parseStatus:old.parseStatus==='processing'?'failed':old.parseStatus,revision:{increment:1},updatedAt:new Date()}});
      await this.event(tx,row,user,'confirm_intake',null,{mode:input.mode,fileCount:additions.length,
        followUpSourceIntakeId:followUpSource?.id ?? null,followUpPlanAction:input.followUpPlanAction ?? 'keep',
        followUpSources:intakeFollowUpSources(old,related)});
    },recruitmentSourceTx); } catch(error) {
      const unique=error as {code?:string;meta?:{target?:unknown;modelName?:string}};
      const target=unique.meta?.target;
      const phoneTarget=Array.isArray(target)?target.length===1&&target[0]==='phone':target==='uq_talent_phone_active';
      if(input.candidate&&unique.code==='P2002'&&phoneTarget&&(!unique.meta?.modelName||unique.meta.modelName==='TalentCandidate')) {
        await assertRecruitmentEditor(this.db,user);
        const duplicate=await this.db.talentCandidate.findFirst({where:{phone:input.candidate.phone,deletedAt:null},select:{id:true}});
        if(duplicate)throw new ConflictException({message:'该手机号已有人才档案，请核对后明确选择复用',data:{reason:'TALENT_PHONE_EXISTS',candidateId:duplicate.id}});
      }
      throw error;
    }
    this.parsing.get(id)?.abort();return this.detail(id,user);
  }

  async mailboxes(user:AuthUser) {
    await assertRecruitmentEditor(this.db,user);
    const choices=this.mailbox.choices();
    return Promise.all(choices.map(async item=>{
      const stateId=this.mailbox.stateId(item.id);
      const state=stateId?await this.db.recruitmentMailboxState.findUnique({where:{id:stateId}}):null;
      return {...item,lastSyncedAt:state?.lastSyncedAt?.toISOString()??null};
    }));
  }
  async mailboxStatus(user:AuthUser,mailboxId?:string) {
    await assertRecruitmentEditor(this.db,user);
    const selected=mailboxId&&typeof this.mailbox.select==='function'?this.mailbox.select(mailboxId):null;
    const state=await this.db.recruitmentMailboxState.findUnique({where:{id:selected?.stateId??'primary'}});
    return {configured:this.mailbox.status().configured,lastSyncedAt:state?.lastSyncedAt?.toISOString()??null};
  }
  async syncMailbox(input:SyncRecruitmentMailboxDto,user:AuthUser):Promise<RecruitmentMailboxSyncView> {
    await assertRecruitmentEditor(this.db,user);
    if(!this.mailbox.status().configured)throw new ServiceUnavailableException('招聘邮箱未配置，请先手工上传');
    const selected=typeof this.mailbox.select==='function'?this.mailbox.select(input.mailboxId):{id:'recruitment-mail',name:'招聘邮箱',stateId:'primary',readPage:(request:{cursor?:string;limit:number})=>this.mailbox.readPage(request)};
    const stateId=selected.stateId;
    const limit=input.limit??10;if(!Number.isInteger(limit)||limit<1||limit>20)throw new BadRequestException('每次最多读取20封邮件');
    const token=randomUUID();
    const before=await this.db.$transaction(async tx=>{
      await this.lock(tx,user);
      const old=await tx.recruitmentMailboxState.upsert({where:{id:stateId},create:{id:stateId},update:{}});
      if(old.leaseToken&&old.leaseUntil&&old.leaseUntil.getTime()>Date.now())throw new ConflictException('已有邮箱同步正在进行，请稍后查看或重试');
      await tx.recruitmentMailboxState.update({where:{id:stateId},data:{leaseToken:token,leaseUntil:new Date(Date.now()+LEASE_MS)}});return old;
    },recruitmentSourceTx);
    let synced=0,skipped=0,failed=0,hasMore=false;
    try {
      const page=normalizeRecruitmentMailboxPage(await selected.readPage({...(before.cursor?{cursor:before.cursor}:{}),limit}));
      if(page.messages.length>limit||page.nextCursor!==null&&page.nextCursor===before.cursor)throw new ServiceUnavailableException('邮箱分页返回无效，本页未完成');
      if(before.mailboxKey&&(before.mailboxKey!==page.mailboxKey||before.authorizedFrom?.toISOString()!==page.authorizedFrom))throw new ConflictException('邮箱或授权范围已变化，须由受控接入流程核对同步位置');
      hasMore=page.nextCursor!==null;
      await this.db.$transaction(async tx=>{await this.lease(tx,user,token,stateId);await tx.recruitmentMailboxState.update({where:{id:stateId},data:{mailboxKey:page.mailboxKey,authorizedFrom:new Date(page.authorizedFrom)}});},recruitmentSourceTx);
      for(const message of page.messages)for(const unit of recruitmentMailUnits(message)) {
        let stored:StoredFileMeta|undefined,used=false;
        try {
          const prior=await this.db.recruitmentIntake.findUnique({where:{mailboxKey_messageId_sourcePartId:{mailboxKey:page.mailboxKey,messageId:message.id,sourcePartId:unit.sourcePartId}},select:{id:true}});
          if(prior){skipped++;continue;}
          let issue=unit.issue;
          if(unit.attachment&&!issue) {
            const file=this.multer(unit.attachment);
            try {await validateResumeFile(file);}catch{issue='unsupported_attachment';}
            if(!issue)stored=await this.storage.uploadIntakeFile(file);
          }
          const outcome=await this.db.$transaction(async tx=>{
            await this.lease(tx,user,token,stateId);
            const prior=await tx.recruitmentIntake.findUnique({where:{mailboxKey_messageId_sourcePartId:{mailboxKey:page.mailboxKey,messageId:message.id,sourcePartId:unit.sourcePartId}}});
            if(prior)return 'skipped';
            const matches=message.postingChannel&&(message.externalPostingId||message.externalPostingUrl) ? await tx.recruitmentPosting.findMany({where:{channel:message.postingChannel.trim().toLowerCase(),active:true,verifiedIdentity:true,
              OR:[...(message.externalPostingId?[{externalId:message.externalPostingId}]:[]),...(message.externalPostingUrl?[{url:message.externalPostingUrl}]:[])]},take:2}) : [];
            const posting=matches.length===1?matches[0]:null;
            // An email hint never verifies a platform identity or guesses by a job name.
            const issues=[...message.issues,...(issue?[issue]:[]),...(!posting?['posting_unverified']:[]),...(!message.sourceChannel?['source_unverified']:[])];
            const row=await tx.recruitmentIntake.create({data:{transport:'email',state:issue?'needs_material':unit.state,createdById:user.id,ownerId:user.id,
              mailboxKey:page.mailboxKey,messageId:message.id,sourcePartId:unit.sourcePartId,receivedAt:new Date(message.receivedAt),subject:message.subject,bodyText:unit.bodyText,
              sourceChannel:message.sourceChannel,postingId:posting?.id??null,demandId:posting?.demandId??null,positionName:posting?.name.slice(0,100)??null,
              postingSnapshot:posting?json({postingId:posting.id,revision:posting.revision,demandId:posting.demandId,channel:posting.channel,name:posting.name,url:posting.url}):Prisma.DbNull,issues}});
            if(stored&&unit.attachment)await this.storeFile(tx,row.id,stored,createHash('sha256').update(unit.attachment.bytes).update(unit.attachment.fileName).digest('hex'),user);
            await this.event(tx,row,user,'receive_mail_intake',null,{mapping:{before:null,after:this.mapping(row)},mailbox:{id:selected.id,name:selected.name}});
            return 'created';
          },recruitmentSourceTx);
          if(outcome==='created'){used=Boolean(stored);synced++;}else skipped++;
        }catch{used=false;failed++;}
        finally{if(stored&&!used)await this.discardIfUnbound(stored.objectKey);}
      }
      if(!failed)await this.db.$transaction(async tx=>{await this.lease(tx,user,token,stateId);await tx.recruitmentMailboxState.update({where:{id:stateId},data:{cursor:page.nextCursor??page.checkpointCursor??null,lastSyncedAt:new Date(),leaseToken:null,leaseUntil:null}});},recruitmentSourceTx);
    }finally{
      await this.db.recruitmentMailboxState.updateMany({where:{id:stateId,leaseToken:token},data:{leaseToken:null,leaseUntil:null}});
    }
    const state=await this.db.recruitmentMailboxState.findUnique({where:{id:stateId}});
    return {configured:true,synced,skipped,failed,complete:failed===0,hasMore,lastSyncedAt:state?.lastSyncedAt?.toISOString()??null};
  }
  private async lease(tx:Prisma.TransactionClient,user:AuthUser,token:string,stateId='primary') {
    await this.lock(tx,user);
    const state=await tx.recruitmentMailboxState.findUnique({where:{id:stateId}});
    if(state?.leaseToken!==token||!state.leaseUntil||state.leaseUntil.getTime()<=Date.now())throw new ConflictException('邮箱同步已中断，请重试本页');
  }
}
