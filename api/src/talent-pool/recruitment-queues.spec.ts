import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TalentRecruitmentService } from './talent-recruitment.service';
import { TalentInterviewsService } from './talent-interviews.service';
import { plainToInstance } from 'class-transformer';
import { TalentInterviewQueueQueryDto } from './dto/talent-interview.dto';
const hr:any={id:'hr',sysRole:'hr',status:'active',hrCapabilities:[],isAssessorOnly:false};
const employee:any={...hr,id:'employee',sysRole:'employee'};
function setup(){
 const row:any={id:'i',candidateId:'c',candidateNameSnapshot:'Fictional candidate',status:'scheduled',startsAt:new Date('2030-01-01'),endsAt:new Date('2030-01-02'),version:1,
  candidate:{deletedAt:null},participants:[{userId:employee.id,userNameSnapshot:'Fictional employee'}],application:{positionName:'Role',recruitmentBatch:null},feedback:[]};
 const db:any={user:{findUnique:jest.fn().mockResolvedValue(hr),findMany:jest.fn().mockResolvedValue([{id:hr.id,name:'Fictional HR'}])},
  talentApplication:{count:jest.fn().mockResolvedValue(42),findMany:jest.fn().mockResolvedValue([{id:'a',candidateId:'c',candidate:{name:'Fictional candidate'},ownerId:hr.id,stage:'screening',interviews:[]}])},
  talentInterview:{count:jest.fn().mockResolvedValue(12),findMany:jest.fn().mockResolvedValue([row])}};
 return{db,row,recruitment:new TalentRecruitmentService(db),interviews:new TalentInterviewsService(db)};
}
describe('authorized recruitment work queues',()=>{
 it('paginates transformed HTTP query DTOs without relying on inherited getters',async()=>{
  const {db,interviews}=setup();const query=plainToInstance(TalentInterviewQueueQueryDto,{scope:'mine',page:'2',pageSize:'1'});
  await interviews.queue(query,employee);
  expect(db.talentInterview.findMany.mock.calls[0][0]).toMatchObject({skip:1,take:1});
 });
 it('offers feedback for early-completed interviews independently of their planned end',async()=>{
  const {db,interviews}=setup();await interviews.queue(plainToInstance(TalentInterviewQueueQueryDto,{scope:'mine',view:'feedback'}),employee);
  const eligibility=db.talentInterview.findMany.mock.calls[0][0].where.AND[0];
  expect(eligibility.AND[0].OR).toEqual([{status:'completed'},{status:'scheduled',endsAt:{lte:expect.any(Date)}}]);
 });
 it('filters owned applications before counting and pagination without returning notes or events',async()=>{
  const {db,recruitment}=setup();const r=await (recruitment as any).queue({page:2,pageSize:10,skip:10,take:10,scope:'owned',keyword:'Role'},hr);
  expect(r.total).toBe(42);expect(r.items).toHaveLength(1);
  const args=db.talentApplication.findMany.mock.calls[0][0];expect(args).toMatchObject({skip:10,take:10,where:{ownerId:hr.id,candidate:{deletedAt:null}}});
  expect(db.talentApplication.count.mock.calls[0][0].where).toEqual(args.where);expect(r.items[0]).not.toHaveProperty('events');
 });
 it('denies ordinary interviewers the application queue',async()=>{
  const {db,recruitment}=setup();db.user.findUnique.mockResolvedValue(employee);
  await expect((recruitment as any).queue({},employee)).rejects.toBeInstanceOf(ForbiddenException);expect(db.talentApplication.findMany).not.toHaveBeenCalled();
 });
 it('denies employee full/owned management scopes even when passing a candidate ID',async()=>{
  const {interviews,db}=setup();for(const scope of ['all','responsible','created'])await expect((interviews as any).queue({scope,candidateId:'c'},employee)).rejects.toBeInstanceOf(ForbiddenException);
  expect(db.talentInterview.findMany).not.toHaveBeenCalled();
 });
 it('finds responsible applications by current owner instead of original interview creator',async()=>{
  const {db,interviews}=setup();await (interviews as any).queue({scope:'responsible',page:1,pageSize:10,skip:0,take:10},hr);
  const where=db.talentInterview.findMany.mock.calls[0][0].where;expect(where.application).toMatchObject({ownerId:hr.id});expect(where).not.toHaveProperty('createdById');
 });
 it('only counts own eligible unsubmitted feedback, preserving the minimal employee response',async()=>{
  const {db,interviews}=setup();const r=await (interviews as any).queue({scope:'mine',view:'feedback',page:1,pageSize:10,skip:0,take:10},employee);
  const args=db.talentInterview.findMany.mock.calls[0][0];expect(args.where).toMatchObject({participants:{some:{userId:employee.id}},feedback:{none:{userId:employee.id,status:'submitted'}}});
  expect(args.where).toHaveProperty('AND');expect(r.items[0]).not.toHaveProperty('participants');expect(r.items[0]).not.toHaveProperty('candidateId');expect(r.items[0]).not.toHaveProperty('feedback');
 });
 it('uses Shanghai calendar-day bounds and ascending upcoming order',async()=>{
  const {db,interviews}=setup();await (interviews as any).queue({scope:'mine',view:'upcoming',day:'2030-01-02',skip:0,take:10},employee);
  const args=db.talentInterview.findMany.mock.calls[0][0];expect(args.where.startsAt).toEqual({gte:new Date('2030-01-01T16:00:00Z'),lt:new Date('2030-01-02T16:00:00Z')});expect(args.orderBy[0]).toEqual({startsAt:'asc'});
 });
 it('rejects new interviews without an application before a transaction',async()=>{
  const {interviews,db}=setup();await expect(interviews.create({candidateId:'c',startsAt:'2030-01-01T00:00:00Z',endsAt:'2030-01-01T01:00:00Z',participantIds:['p'],invitationText:'Fictional invitation'} as any,hr)).rejects.toBeInstanceOf(BadRequestException);
  expect(db.talentInterview.findMany).not.toHaveBeenCalled();
 });
});
