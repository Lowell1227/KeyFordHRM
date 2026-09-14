import { ConflictException } from '@nestjs/common';
import { ReportsService } from '@/reports/reports.service';
import { buildProgress } from '@/calibration/calibration.service';
import { PublishService } from '@/publish/publish.service';
import { TasksService } from './tasks.service';
import { FlowService } from './flow.service';
import { canEmployeeViewResult, isResultPublished } from './result-publication';

const employee = { id: 'employee', sysRole: 'employee' } as any;
const hr = { id: 'hr', sysRole: 'hr' } as any;
const approvedAt = new Date('2026-09-01');

function fixture() {
  const task: any = { appeals: [], id: 'task', employeeId: 'employee', cycleId: 'cycle', status: 'approval',
    managerId: 'manager', approvedAt, publishedAt: null, employeeConfirmedAt: null, isExempt: false,
    gradeResult: { approvedAt, calibratedGrade: 'B', rawGrade: 'A' }, cycle: {} };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    assessmentTask: { findUnique: jest.fn(async () => task), update: jest.fn(async ({ data }) => Object.assign(task, data)), groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn(async () => [task]), count: jest.fn().mockResolvedValue(0) },
    assessmentCycle: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle', name: '测试周期', hrOwnerId: 'hr' }), update: jest.fn() },
    gradeResult: { updateMany: jest.fn(async ({ data }) => { Object.assign(task.gradeResult, data); return { count: 1 }; }), update: jest.fn(async ({ data }) => Object.assign(task.gradeResult, data)) },
    appeal: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({ task: null }) },
    flowRecord: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    performanceArchive: { findUnique: jest.fn() }, auditLog: { create: jest.fn() }, notificationLog: { create: jest.fn() }, systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  tx.$transaction = jest.fn(async (cb: (db: any) => Promise<unknown>) => cb(tx));
  const flow = new FlowService(tx);
  const service = new (TasksService as any)(tx, {}, {}, flow, {}, {}, {}, {});
  return { task, tx, flow, service };
}

describe('公示前员工确认', () => {
  it('已审批本人在公示前确认，原子记录确认时间', async () => {
    const { service, task, tx } = fixture();
    await expect(service.employeeConfirm('task', employee)).resolves.toEqual({ id: 'task', status: 'confirmed' });
    expect(task.employeeConfirmedAt).toBeInstanceOf(Date);
    expect(task.gradeResult.employeeConfirmedAt).toEqual(task.employeeConfirmedAt);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('未批准不得确认，其他人也不能代替员工确认', async () => {
    const { service, task, tx } = fixture();
    await expect(service.employeeConfirm('task', hr)).rejects.toThrow('仅员工本人可操作');
    task.approvedAt = null; task.gradeResult.approvedAt = null;
    await expect(service.employeeConfirm('task', employee)).rejects.toThrow(ConflictException);
    expect(tx.assessmentTask.update).not.toHaveBeenCalled();
  });

  it('重复确认不覆盖时间，已公示的历史结果可补确认', async () => {
    const { service, task } = fixture();
    await service.employeeConfirm('task', employee);
    const first = task.employeeConfirmedAt;
    await expect(service.employeeConfirm('task', employee)).rejects.toThrow(ConflictException);
    expect(task.employeeConfirmedAt).toBe(first);
    task.status = 'published'; task.publishedAt = new Date('2026-08-01'); task.employeeConfirmedAt = null; task.gradeResult.employeeConfirmedAt = null;
    await expect(service.employeeConfirm('task', employee)).resolves.toMatchObject({ status: 'confirmed' });
    expect(task.publishedAt).toEqual(new Date('2026-08-01'));
  });

  it('确认前不得公示，历史未完成流程申诉仍阻断公示', async () => {
    const { task, tx, flow } = fixture(); const publish = new PublishService(tx, flow, {} as any);
    await expect(publish.publishCycle('cycle', { taskIds: ['task'] } as any, hr)).rejects.toThrow(ConflictException);
    task.status = 'confirmed'; task.employeeConfirmedAt = new Date(); task.gradeResult.employeeConfirmedAt = task.employeeConfirmedAt;
    task.appeals = [{ id: 'historical-pending' }];
    await expect(publish.publishCycle('cycle', { taskIds: ['task'] }, hr)).rejects.toThrow(ConflictException);
  });

  it('确认不算已公示，遮罩隐藏尚未批准的流程意见与原结果', () => {
    expect(buildProgress([{ status: 'confirmed', publishedAt: null } as any])).toMatchObject({ done: 0, inApproval: 1 });
    const { service, task } = fixture(); task.status = 'confirmed';
    expect(isResultPublished(task)).toBe(false); expect(canEmployeeViewResult(task)).toBe(true);
    const detail = { indicatorInstances: [], flowRecords: [{ nodeType: 'appeal', comment: '历史申诉涉及 A 等', extraData: { type: 'prepublication_appeal', originalResult: { rawGrade: 'A' } } }] };
    const masked = service.applyPrePublishMask(detail);
    expect(masked.flowRecords[0]).toMatchObject({ comment: null, extraData: { type: 'prepublication_appeal', source: 'hr' } });
    expect(masked.flowRecords[0].extraData).not.toHaveProperty('originalResult');
  });

  it('公示逾期只统计已确认但未公示的任务', () => {
    const service = new ReportsService({} as any, {} as any);
    const tasks = [{ status: 'published', employeeConfirmedAt: new Date(), publishedAt: new Date() },
      { status: 'confirmed', publishedAt: null }, { status: 'confirmed', publishedAt: new Date() }];
    const result = (service as any).buildOverdueByNode(tasks, { deadlinePublish: new Date('2020-01-01') });
    expect(result.find((row: any) => row.node === 'published').overdueCount).toBe(1);
  });
});
