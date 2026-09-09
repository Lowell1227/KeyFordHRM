import { Prisma } from '@prisma/client';
import { ReportsService } from '@/reports/reports.service';
import { ConflictException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { FlowService } from './flow.service';
import { AppealsService } from '@/appeals/appeals.service';
import { canEmployeeViewResult, isResultPublished } from './result-publication';
import { buildProgress } from '@/calibration/calibration.service';
import { PublishService } from '@/publish/publish.service';
const employee = { id: 'employee', sysRole: 'employee' } as any;
const hr = { id: 'hr', sysRole: 'hr' } as any;
const approvedAt = new Date('2026-09-01');
function fixture() {
 const task: any = { appeals: [], id: 'task', employeeId: 'employee', cycleId: 'cycle', status: 'approval', managerId: 'manager', approvedAt, publishedAt: null, employeeConfirmedAt: null, isExempt: false, gradeResult: { approvedAt, calibratedGrade: 'B', rawGrade: 'A' }, cycle: {} };
 const records: any[] = [];
 const tx: any = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  assessmentTask: { findUnique: jest.fn(async () => task), update: jest.fn(async ({data}) => Object.assign(task, data)), groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn(async () => [task]), count: jest.fn().mockResolvedValue(0) },
  assessmentCycle: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle', name: '测试周期', hrOwnerId: 'hr' }), update: jest.fn() },
  gradeResult: { updateMany: jest.fn(async ({data}) => { Object.assign(task.gradeResult, data); return {count:1}; }), update: jest.fn(async ({data}) => Object.assign(task.gradeResult, data)) },
  appeal: { count: jest.fn().mockResolvedValue(0), create: jest.fn(async ({data}) => ({id:'appeal', ...data})), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({task:null}), findUnique: jest.fn() },
  flowRecord: { create: jest.fn(async ({data}) => { records.push(data); return data; }), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(async () => records) },
  performanceInterview: { upsert: jest.fn() }, performanceArchive: {findUnique:jest.fn()}, auditLog: { create: jest.fn() }, notificationLog: { create: jest.fn() }, systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
 };
 tx.$transaction = jest.fn(async cb => cb(tx));
 const flow = new FlowService(tx);
 const service = new (TasksService as any)(tx, {}, {}, flow, {}, {}, {}, {});
 return { task, tx, records, flow, service };
}
describe('公示前员工确认与 HR 申诉', () => {
 it('已审批本人在公示前确认，原子记录确认时间', async () => {
  const { service, task, tx } = fixture();
  await expect(service.employeeConfirm('task', employee)).resolves.toEqual({id:'task',status:'confirmed'});
  expect(task.employeeConfirmedAt).toBeInstanceOf(Date); expect(task.gradeResult.employeeConfirmedAt).toEqual(task.employeeConfirmedAt); expect(tx.$queryRaw).toHaveBeenCalled();
 });
 it('未批准不得确认', async () => {
  const { service, task } = fixture(); task.approvedAt = null; task.gradeResult.approvedAt = null;
  await expect(service.employeeConfirm('task', employee)).rejects.toThrow(ConflictException);
 });
 it('确认前不得公示', async () => {
  const { tx, flow } = fixture(); const publish = new PublishService(tx, flow, {} as any);
  await expect(publish.publishCycle('cycle',{taskIds:['task']} as any,hr)).rejects.toThrow(ConflictException);
 });
 it('HR 申诉撤销有效结果，回到冻结直属上级并保留月份和原快照', async () => {
  const { task, tx, flow, records } = fixture(); task.employeeConfirmedAt = new Date(); task.status = 'confirmed';
  const monthlyBefore = JSON.stringify([{grade:'A',comment:'原月度意见'}]); task.periods = JSON.parse(monthlyBefore);
  const appeals = new (AppealsService as any)(tx, {}, flow);
  await appeals.create({taskId:'task',reason:'线下反馈有待核实'},hr);
  expect(task.status).toBe('manager_scoring'); expect(task.approvedAt).toBeNull(); expect(task.employeeConfirmedAt).toBeNull();
  expect(task.gradeResult.approvedAt).toBeNull(); expect(task.gradeResult.calibratedGrade).toBeNull(); expect(JSON.stringify(task.periods)).toBe(monthlyBefore);
  expect(records).toEqual(expect.arrayContaining([expect.objectContaining({nodeType:'appeal',extraData:expect.objectContaining({type:'prepublication_appeal',appealId:'appeal',originalResult:expect.objectContaining({calibratedGrade:'B'})})})]));
 });
 it('新流程申诉不得使用旧直接改判入口', async () => {
  const { task, tx, flow } = fixture(); tx.appeal.findUnique.mockResolvedValue({id:'appeal',taskId:'task',status:'pending',task});
  tx.flowRecord.findFirst.mockResolvedValue({extraData:{type:'prepublication_appeal',appealId:'appeal'}});
  const appeals = new (AppealsService as any)(tx, {loadGradeCoefficients:jest.fn().mockResolvedValue({A:1.2})}, flow);
  await expect(appeals.resolve('appeal',{result:'modified',newGrade:'A',resolution:'直接改判'},hr)).rejects.toThrow(ConflictException);
 });
 it('发布前确认不计入已公示校准进度', () => {
  expect(buildProgress([{status:'confirmed', publishedAt:null} as any])).toMatchObject({done:0,inApproval:1});
 });
 it('公示事实独立于确认状态，已审批本人可以查看', () => {
  const {task} = fixture(); task.status = 'confirmed';
  expect(isResultPublished(task)).toBe(false); expect(canEmployeeViewResult(task)).toBe(true);
  task.publishedAt = new Date(); expect(isResultPublished(task)).toBe(true);
  task.publishedAt = null; task.gradeResult.isPublished = true; expect(isResultPublished(task)).toBe(true);
 });
 it('审批前员工看不到 HR 原结果快照', () => {
  const {service} = fixture();
  const detail = {indicatorInstances:[], flowRecords:[{nodeType:'appeal',comment:'申诉涉及 A 等',extraData:{type:'prepublication_appeal',originalResult:{rawGrade:'A'}}}]};
  const result = service.applyPrePublishMask(detail);
  expect(result.flowRecords[0]).toMatchObject({comment:null,extraData:{type:'prepublication_appeal',source:'hr'}});
  expect(result.flowRecords[0].extraData).not.toHaveProperty('originalResult');
 });
 it('批准后字段设置仍遮罩流程记录中的等级、分数和意见', () => {
  const {service} = fixture();
  const detail = {rawGrade:'A',indicatorInstances:[],flowRecords:[{nodeType:'manager_score',comment:'最终等级 A 均分 93',extraData:{type:'final_grade_submitted',grade:'A',calculatedScore:93,comment:'主管意见'}}]};
  const result = service.applyMask(detail,{total_score:false,grade:false,manager_comment:false});
  expect(result.rawGrade).toBeNull(); expect(result.flowRecords[0]).toMatchObject({comment:null,extraData:null});
 });
 it('他人不能代替员工确认', async () => {
  const {service,tx} = fixture();
  await expect(service.employeeConfirm('task',hr)).rejects.toThrow('仅员工本人可操作');
  expect(tx.assessmentTask.update).not.toHaveBeenCalled();
 });
 it('重复确认拒绝且不覆盖原确认时间', async () => {
  const {service,task} = fixture(); await service.employeeConfirm('task',employee);
  const first = task.employeeConfirmedAt;
  await expect(service.employeeConfirm('task',employee)).rejects.toThrow(ConflictException);
  expect(task.employeeConfirmedAt).toBe(first);
 });
 it('历史已公示记录可确认，保留原公示时间', async () => {
  const {service,task} = fixture(); const published = new Date('2026-08-01'); task.status='published'; task.publishedAt=published;
  await expect(service.employeeConfirm('task',employee)).resolves.toMatchObject({status:'confirmed'});
  expect(task.publishedAt).toBe(published);
 });
 it('重审后的员工确认结束新申诉，并比较原等级', async () => {
  const {service,tx} = fixture(); tx.appeal.findMany.mockResolvedValue([{id:'appeal'}]);
  tx.flowRecord.findFirst.mockResolvedValue({extraData:{type:'prepublication_appeal',appealId:'appeal',originalResult:{calibratedGrade:'A'}}});
  await service.employeeConfirm('task',employee);
  expect(tx.appeal.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'appeal'},data:expect.objectContaining({status:'resolved',finalResult:'modified'})}));
 });
 it('未完成申诉阻断公示，即便确认时间已存在', async () => {
  const {task,tx,flow} = fixture(); task.status='confirmed'; task.employeeConfirmedAt=new Date(); task.gradeResult.employeeConfirmedAt=task.employeeConfirmedAt; task.appeals=[{id:'pending'}];
  await expect(new PublishService(tx,flow,{} as any).publishCycle('cycle',{taskIds:['task']},hr)).rejects.toThrow(ConflictException);
 });
 it.each(['published','manager_scoring'])('HR 不能给 %s 状态任务新建公示前申诉', async status => {
  const {task,tx,flow} = fixture(); task.status=status;
  await expect(new AppealsService(tx,{} as any,flow).create({taskId:'task',reason:'异议'},hr)).rejects.toThrow(ConflictException);
  expect(tx.appeal.create).not.toHaveBeenCalled();
 });
 it('没有冻结直属上级或者已有申诉时拒绝创建', async () => {
  const {task,tx,flow} = fixture(); const service=new AppealsService(tx,{} as any,flow); task.managerId=null;
  await expect(service.create({taskId:'task',reason:'异议'},hr)).rejects.toThrow(ConflictException);
  task.managerId='manager'; tx.appeal.count.mockResolvedValue(1);
  await expect(service.create({taskId:'task',reason:'异议'},hr)).rejects.toThrow(ConflictException);
  expect(tx.appeal.create).not.toHaveBeenCalled();
 });

 it('候选查询同时要求当前批准、未公示、无未完成申诉和冻结主管', async () => {
  const {task,tx,flow} = fixture(); task.employee={name:'员工',employeeNo:'E001'}; task.dept={name:'部门'}; task.cycle={name:'周期'};
  tx.assessmentTask.count.mockResolvedValue(1);
  const pagination = {skip:0,take:20,page:1,pageSize:20} as any;
  const result = await new AppealsService(tx,{} as any,flow).findCandidates({keyword:'员工',cycleId:'cycle'},pagination);
  expect(result.items[0]).toMatchObject({id:'task',employeeName:'员工',deptName:'部门',cycleName:'周期',approvedAt});
  expect(tx.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({
    isExempt:false,status:{in:['approval','confirmed']},approvedAt:{not:null},managerId:{not:null},
    gradeResult:{is:{approvedAt:{not:null}}},appeals:{none:{status:'pending'}},NOT:expect.any(Object),cycleId:'cycle',
  })}));
 });
 it('新申诉详情展示当前节点和原结果，旧申诉保留处理权限', async () => {
  const {task,tx,flow} = fixture(); const service=new AppealsService(tx,{} as any,flow);
  const record={id:'flow',nodeType:'appeal',action:'reject',comment:'HR 记录',actor:{name:'HR'},createdAt:new Date(),extraData:{type:'prepublication_appeal',appealId:'appeal',originalResult:{rawGrade:'A'}}};
  tx.appeal.findUnique.mockResolvedValue({id:'appeal',taskId:'task',status:'pending',task:{...task,flowRecords:[record]},appellant:null,cycle:null});
  await expect(service.findOne('appeal')).resolves.toMatchObject({workflowType:'prepublication',canResolve:false,taskStatus:'approval',originalResult:{rawGrade:'A'},flowRecords:[expect.objectContaining({nodeType:'appeal',comment:'HR 记录'})]});
  tx.appeal.findUnique.mockResolvedValue({id:'old-appeal',taskId:'task',status:'pending',task:{...task,flowRecords:[record]},appellant:null,cycle:null});
  await expect(service.findOne('old-appeal')).resolves.toMatchObject({workflowType:'legacy',canResolve:true,originalResult:null});
 });
 it('退回重评的任务仍保留在公示工作台范围', async () => {
  const {task,tx,flow} = fixture(); task.status='manager_scoring';task.approvedAt=null;task.gradeResult.approvedAt=null;
  task.employee={name:'员工'}; task.dept=null;tx.assessmentTask.count.mockResolvedValue(1);
  const publish=new PublishService(tx,flow,{} as any);
  await publish.getPublicationRecords('cycle',{skip:0,take:20,page:1,pageSize:20} as any,hr);
  const where=tx.assessmentTask.findMany.mock.calls[0][0].where;
  expect(where.OR).toEqual(expect.arrayContaining([{flowRecords:{some:{nodeType:'approval'}}}]));
 });

 it('原结果快照将真实 Decimal 分数序列化为数字，并兼容已保存的字符串分数', async () => {
  const {task,tx,flow,records}=fixture(); task.gradeResult.calculatedScore=new Prisma.Decimal('91.25');
  const appeals=new AppealsService(tx,{} as any,flow); await appeals.create({taskId:'task',reason:'复核依据'},hr);
  expect(records[0].extraData.originalResult.calculatedScore).toBe(91.25);
  tx.appeal.findUnique.mockResolvedValue({id:'appeal',taskId:'task',status:'pending',task:{...task,flowRecords:[{...records[0],extraData:{...records[0].extraData,originalResult:{calculatedScore:'91.25'}}}]},appellant:null,cycle:null});
  expect((await appeals.findOne('appeal')).originalResult).toMatchObject({calculatedScore:91.25});
 });
 it('公示逾期仅统计已确认尚未公示的任务', () => {
  const service=new ReportsService({} as any,{} as any);
  const tasks=[{status:'published',employeeConfirmedAt:new Date(),publishedAt:new Date()},{status:'confirmed',publishedAt:null},{status:'confirmed',publishedAt:new Date()}];
  const result=(service as any).buildOverdueByNode(tasks,{deadlinePublish:new Date('2020-01-01')});
  expect(result.find((row:any)=>row.node==='published').overdueCount).toBe(1);
  expect((service as any).buildOverdueByNode([tasks[0],tasks[2]],{deadlinePublish:new Date('2020-01-01')}).find((row:any)=>row.node==='published').overdueCount).toBe(0);
 });

});
