import { TeamTasksService } from './team-tasks.service';
import { TasksService } from './tasks.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { SysRole, Prisma } from '@prisma/client';

describe('five step goal actions', () => {
  let service: TasksService;
  let task: any;
  let db: any;
  let activate: jest.Mock;
  const actor = (id: string, sysRole: SysRole = SysRole.employee) =>
    ({ id, sysRole }) as AuthUser;
  beforeEach(() => {
    task = {
      id: 'task',
      cycleId: 'cycle',
      employeeId: 'e',
      managerId: 'm',
      deptHeadId: 'd',
      approverId: 'l',
      status: 'indicator_reviewing',
      updatedAt: new Date('2026-01-01'),
      indicatorConfirmedAt: null,
      goalApprovedAt: null,
    };
    db = {
      assessmentTask: {
        findUnique: jest.fn(async () => ({ ...task })),
        updateMany: jest.fn(async ({ where }: any) => ({
          count:
            task.updatedAt.getTime() === where.updatedAt.getTime() &&
            task.status === where.status
              ? 1
              : 0,
        })),
        update: jest.fn(async ({ data }: any) => Object.assign(task, data)),
      },
      assessmentCycle: {
        findUnique: jest.fn(async () => ({
          goalWorkflowVersion: 2,
          workflowVersion: 2,
          selfEvalOpenAt: new Date('2099-01-01'),
        })),
      },
      indicatorInstance: {
        findMany: jest.fn(async () => [
          {
            id: 'i',
            name: '目标',
            weight: new Prisma.Decimal(1),
            dimensionWeight: new Prisma.Decimal(1),
            targetValue: null,
            visibleDepartments: [],
            visibleUsers: [],
            objectiveAlignments: [],
            childAlignments: [],
          },
        ]),
      },
      flowRecord: { create: jest.fn() },
      auditLog: { createMany: jest.fn() },
    };
    db.$transaction = async (fn: any) => fn(db);
    activate = jest.fn();
    service = Object.assign(Object.create(TasksService.prototype), {
      prisma: db,
      flowService: { syncCycleStage: jest.fn() },
      indicatorVersionService: { activateConfirmedV1: activate },
      notificationsService: { create: jest.fn() },
    });
  });
  const approve = (id: string) =>
    service.approveIndicators(
      'task',
      { expectedUpdatedAt: task.updatedAt.toISOString() },
      actor(id),
    );
  it('runs manager department employee leader, activating only at leader', async () => {
    await approve('m');
    expect(task.status).toBe('indicator_dept_reviewing');
    await approve('d');
    expect(task.status).toBe('indicator_confirming');
    await service.confirmIndicators('task', actor('e'), task.updatedAt.toISOString());
    expect(task.status).toBe('indicator_approving');
    expect(task.indicatorConfirmedAt).toBeInstanceOf(Date);
    expect(activate).not.toHaveBeenCalled();
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
    await approve('l');
    expect(task.status).toBe('goal_confirmed');
    expect(task.goalApprovedAt).toBeInstanceOf(Date);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('clears employee confirmation on leader return and requires the full later chain', async () => {
    task.status = 'indicator_approving';
    task.indicatorConfirmedAt = new Date();
    await service.rejectIndicators(
      'task',
      '重新调整',
      actor('l'),
      task.updatedAt.toISOString(),
    );
    expect(task.status).toBe('indicator_reviewing');
    expect(task.indicatorConfirmedAt).toBeNull();
    expect(task.goalApprovedAt).toBeNull();
    await approve('m');
    expect(task.status).toBe('indicator_dept_reviewing');
    expect(activate).not.toHaveBeenCalled();
  });
  it('rejects HR substitute', async () => {
    await expect(
      service.approveIndicators(
        'task',
        { expectedUpdatedAt: task.updatedAt.toISOString() },
        actor('hr', SysRole.hr),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.assessmentTask.updateMany).not.toHaveBeenCalled();
  });
  it('rejects lost concurrent claim before writing any flow or baseline', async () => {
    db.assessmentTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(approve('m')).rejects.toBeInstanceOf(ConflictException);
    expect(db.flowRecord.create).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });
  it('same department and leader actor still approves after employee confirmation', async () => {
    task.approverId = 'd';
    await approve('m');
    await approve('d');
    await service.confirmIndicators('task', actor('e'), task.updatedAt.toISOString());
    expect(task.status).toBe('indicator_approving');
    await approve('d');
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('same manager department merges with two audit records', async () => {
    task.deptHeadId = 'm';
    await approve('m');
    expect(task.status).toBe('indicator_confirming');
    expect(db.flowRecord.create).toHaveBeenCalledTimes(2);
  });
  it.each([
    'indicator_dept_reviewing',
    'indicator_confirming',
    'indicator_approving',
  ])('returns %s to manager with cleared confirmation', async (status) => {
    task.status = status;
    task.indicatorConfirmedAt = new Date();
    const id =
      status === 'indicator_dept_reviewing'
        ? 'd'
        : status === 'indicator_confirming'
          ? 'e'
          : 'l';
    await service.rejectIndicators('task', '调整', actor(id));
    expect(task.status).toBe('indicator_reviewing');
    expect(task.indicatorConfirmedAt).toBeNull();
  });
  it('manager rejection returns to employee drafting', async () => {
    await service.rejectIndicators('task', '修改', actor('m'));
    expect(task.status).toBe('indicator_drafting');
  });
  it('requires a nonblank rejection reason', async () => {
    await expect(
      service.rejectIndicators('task', ' ', actor('m')),
    ).rejects.toThrow('请填写退回原因');
    expect(db.flowRecord.create).not.toHaveBeenCalled();
  });
  it('rejects stale approval timestamp', async () => {
    await expect(
      service.approveIndicators(
        'task',
        { expectedUpdatedAt: '2025-01-01' },
        actor('m'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('final approval may immediately open self evaluation', async () => {
    task.status = 'indicator_approving';
    task.indicatorConfirmedAt = new Date();
    db.assessmentCycle.findUnique.mockResolvedValue({
      goalWorkflowVersion: 2,
      workflowVersion: 2,
      selfEvalOpenAt: new Date('2020-01-01'),
    });
    await approve('l');
    expect(task.status).toBe('self_eval');
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('rejects direct self evaluation without final approval even if status is inconsistent', async () => {
    task.status = 'self_eval';
    await expect(
      service.submitSelfEval('task', {} as any, actor('e')),
    ).rejects.toThrow('目标尚未终审生效');
  });
  it('rejects department editing goal content', async () => {
    task.status = 'indicator_dept_reviewing';
    await expect(
      service.setIndicators(
        'task',
        { expectedUpdatedAt: task.updatedAt.toISOString() } as any,
        actor('d'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('batch department approval uses the same assigned-actor action', async () => {
    task.status = 'indicator_dept_reviewing'; task.cycle = {goalWorkflowVersion: 2};
    const batch = new TeamTasksService(db, {} as any, {} as any, service);
    const result = await batch.batchApprove({tasks:[{taskId:'task',updatedAt:task.updatedAt.toISOString()}]},actor('d'));
    expect(result.failed).toHaveLength(0); expect(result.succeeded[0].status).toBe('indicator_confirming');
  });
  it('batch rejects an unassigned HR actor', async () => {
    task.cycle = {goalWorkflowVersion: 2};
    const batch = new TeamTasksService(db, {} as any, {} as any, service);
    const result = await batch.batchApprove({tasks:[{taskId:'task',updatedAt:task.updatedAt.toISOString()}]},actor('hr',SysRole.hr));
    expect(result.succeeded).toHaveLength(0); expect(result.failed).toHaveLength(1); expect(db.flowRecord.create).not.toHaveBeenCalled();
  });
  it('skips employee-as-leader with an explicit audit before activating', async () => {
    task.status='indicator_confirming';task.approverId='e';
    await service.confirmIndicators('task',actor('e'),task.updatedAt.toISOString());
    expect(task.status).toBe('goal_confirmed');expect(activate).toHaveBeenCalledTimes(1);
    expect(db.flowRecord.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({nodeType:'indicator_approval',extraData:expect.objectContaining({reason:'self_review_skipped'})})}));
  });

  it('rejects a stale round A confirmation after round B has been submitted', async () => {
    await approve('m'); await approve('d');
    const roundA = task.updatedAt.toISOString();
    await service.rejectIndicators('task', '修改目标', actor('e'));
    Object.assign(service, {indicatorVisibility:{validateSelection:jest.fn()}, objectivesService:{assertIndicatorAlignmentCandidateIds:jest.fn()}});
    const replace = jest.spyOn(service as any,'replaceIndicatorInstances').mockResolvedValue(undefined);
    jest.spyOn(service,'findOne').mockImplementation(async()=>({...task}));
    db.assessmentTask.updateMany.mockImplementation(async({where}:any)=>({count:task.updatedAt.getTime()===where.updatedAt.getTime()&&(!where.status||task.status===where.status)?1:0}));
    await service.setIndicators('task',{expectedUpdatedAt:task.updatedAt.toISOString(),action:'submit',instances:[{name:'Round B revised target',weight:1,visibilityScope:'supervisors'}]} as any,actor('m'));
    expect(replace.mock.calls[0][2]).toEqual(expect.arrayContaining([expect.objectContaining({name:'Round B revised target'})]));
    await approve('d');
    expect(task.status).toBe('indicator_confirming');
    expect(task.updatedAt.toISOString()).not.toBe(roundA);
    await expect(service.confirmIndicators('task', actor('e'), roundA)).rejects.toBeInstanceOf(ConflictException);
    expect(task.status).toBe('indicator_confirming'); expect(task.indicatorConfirmedAt).toBeNull();
  });
  it('requires a version for new-flow employee confirmation', async () => {
    task.status='indicator_confirming';
    await expect(service.confirmIndicators('task', actor('e'))).rejects.toThrow();
    expect(task.status).toBe('indicator_confirming');
  });
  it('returns self-manager rework to drafting and resubmits without self approval', async () => {
    task.status='indicator_drafting';task.managerId='e';task.deptHeadId='e';
    Object.assign(service, {indicatorVisibility:{validateSelection:jest.fn()}, objectivesService:{assertIndicatorAlignmentCandidateIds:jest.fn()}});
    jest.spyOn(service as any,'replaceIndicatorInstances').mockResolvedValue(undefined);
    jest.spyOn(service,'findOne').mockImplementation(async()=>({...task}));
    db.assessmentTask.updateMany.mockImplementation(async({where}:any)=>({count:task.updatedAt.getTime()===where.updatedAt.getTime()&&(!where.status||task.status===where.status)?1:0}));
    const submit = () => service.setIndicators('task',{expectedUpdatedAt:task.updatedAt.toISOString(),action:'submit',instances:[{name:'调整后的目标',weight:1,visibilityScope:'supervisors'}]} as any,actor('e'));
    await submit();expect(task.status).toBe('indicator_confirming');
    await service.confirmIndicators('task',actor('e'),task.updatedAt.toISOString());
    await service.rejectIndicators('task','再调整',actor('l'));
    expect(task.status).toBe('indicator_drafting');expect(task.indicatorConfirmedAt).toBeNull();
    await submit();expect(task.status).toBe('indicator_confirming');
    await service.confirmIndicators('task',actor('e'),task.updatedAt.toISOString());
    expect(task.status).toBe('indicator_approving');
    expect(db.flowRecord.create.mock.calls.filter(([input]:any[])=>input.data.nodeType==='indicator_setting'&&input.data.action==='approve').every(([input]:any[])=>input.data.extraData.reason==='self_review_skipped')).toBe(true);
  });
  it('forbids direct self-manager review edits',async()=>{
    task.managerId='e'; task.status='indicator_reviewing';
    await expect(service.setIndicators('task',{expectedUpdatedAt:task.updatedAt.toISOString(),instances:[{name:'目标',weight:1}]} as any,actor('e'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('returns frozen approver identity in full task detail',()=>{
    const detail=(service as any).buildTaskDetail({...task,approver:{name:'冻结审批人'},indicatorInstances:[],flowRecords:[]});
    expect(detail.approverId).toBe('l');expect(detail.approverName).toBe('冻结审批人');
  });

});
