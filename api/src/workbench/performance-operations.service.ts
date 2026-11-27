import { Injectable } from '@nestjs/common';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { PaginationDto } from '@/common/dto/pagination.dto';
import type { AuthUser } from '@/common/types/auth.types';
import { ConfirmationService } from '@/confirmation/confirmation.service';
import { ApprovalService } from '@/approval/approval.service';
import { CalibrationService } from '@/calibration/calibration.service';
import { TasksService } from '@/tasks/tasks.service';
import { TaskQueryDto } from '@/tasks/dto/task-query.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { allOperationPages, operationPath, OperationRows } from './operations-projection';
import { lifecycleAttention } from './lifecycle-attention';

@Injectable()
export class PerformanceOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly confirmation: ConfirmationService,
    private readonly approvals: ApprovalService, private readonly calibration: CalibrationService,
    private readonly tasks: TasksService) {}

  async read(actor: AuthUser): Promise<OperationRows> {
    const rows: OperationRows = { visible: !actor.isAssessorOnly, actionable: [], attention: [] };
    if (!rows.visible) return rows;
    const pagination = (page: number, pageSize: number) => Object.assign(new PaginationDto(), { page, pageSize });
    const pending = await allOperationPages((page, pageSize) => this.confirmation.findPending(pagination(page, pageSize), actor));
    for (const row of pending) {
      if (row.workflowVersion !== 2 || !row.pendingRole || row.lifecycleStatus && row.lifecycleStatus !== 'active') continue;
      rows.actionable.push({ id: `performance:confirmation:${row.id}`, kind: 'confirmation',
        title: `${row.employee.name} · 转正办理`, status: row.status, nextAction: '办理当前转正环节', dueAt: null,
        requestId: row.id, path: `/confirmation-applications/manage/${encodeURIComponent(row.id)}` });
    }
    const mine = await allOperationPages((page, pageSize) => this.confirmation.findMine(pagination(page, pageSize), actor));
    for (const row of mine) {
      if (row.employeeId !== actor.id || row.workflowVersion !== 2 || row.lifecycleStatus && row.lifecycleStatus !== 'active') continue;
      const draft = row.status === 'draft';
      if (!draft && !['submitted', 'manager_approved', 'hr_approved'].includes(row.status)) continue;
      if (pending.some(item => item.id === row.id && item.pendingRole)) continue;
      (draft ? rows.actionable : rows.attention).push({ id: `performance:confirmation:${row.id}`, kind: 'confirmation',
        title: '我的转正申请', status: row.status, nextAction: draft ? '补充并提交转正申请' : '等待当前转正办理人处理',
        dueAt: null, requestId: row.id, path: `/confirmation-applications/mine/${encodeURIComponent(row.id)}` });
    }
    const departmentAssignment = await this.prisma.assessmentTask.findFirst({ where: {
      deptHeadId: actor.id, employeeId: { not: actor.id }, isExempt: false, status: 'dept_review', lifecycleStatus: 'active',
    }, select: { id: true } });
    const department = departmentAssignment ? await allOperationPages((page, pageSize) => this.tasks.findDepartmentReviews(
      Object.assign(new TaskQueryDto(), { page, pageSize, status: 'dept_review' }), actor)) : [];
    for (const row of department) {
      if (row.employeeId === actor.id || row.isExempt || row.status !== 'dept_review' || !row.departmentReview.canReview) continue;
      rows.actionable.push({ id: `performance:department:${row.id}`, kind: 'department_review', title: `${row.employeeName} · 部门复核`,
        status: row.status, nextAction: '复核该员工的周期结果', dueAt: null, taskId: row.id, cycleId: row.cycleId,
        path: operationPath(`/department-review/${encodeURIComponent(row.id)}`, { cycleId: row.cycleId }) });
    }
    const calibrationCapability = hasHrCapability(actor, 'performance_calibration');
    const calibrationCycles = await this.prisma.assessmentCycle.findMany({ where: {
      ...(!calibrationCapability ? { hrOwnerId: actor.id } : {}),
      status: { in: ['indicator_setting', 'self_eval', 'manager_score', 'hr_calibration', 'approval', 'published', 'appeal', 'closed'] },
      tasks: { some: { status: 'hr_calibration', isExempt: false, lifecycleStatus: 'active', employeeId: { not: actor.id } } },
    }, select: { id: true, hrOwnerId: true }, orderBy: { id: 'asc' } });
    for (const cycle of calibrationCycles) {
      if (!calibrationCapability && cycle.hrOwnerId !== actor.id) continue;
      const workbench = await this.calibration.getWorkbench(cycle.id, actor);
      for (const row of workbench.items) {
        if (row.status !== 'hr_calibration' || !row.canCalibrate || !row.canViewDetail) continue;
        rows.actionable.push({ id: `performance:calibration:${row.taskId}`, kind: 'calibration', title: `${row.employeeName} · 绩效校准`,
          status: row.status, nextAction: '核对原任务并办理校准', dueAt: null, taskId: row.taskId, cycleId: cycle.id,
          path: operationPath('/calibration', { cycleId: cycle.id, taskId: row.taskId }) });
      }
    }
    // Discover only frozen assignments; all-data viewing must never become an approval responsibility.
    const approvalCycles = await this.prisma.assessmentTask.findMany({ where: {
      approverId: actor.id, employeeId: { not: actor.id }, isExempt: false, status: 'approval', approvedAt: null, lifecycleStatus: 'active',
    }, select: { cycleId: true }, distinct: ['cycleId'] });
    for (const cycle of approvalCycles) {
      for (const row of await this.approvals.getApprovalList(cycle.cycleId, actor)) {
        if (row.cycleId !== cycle.cycleId || row.status !== 'approval' || row.approvedAt || row.approverId !== actor.id || row.employeeId === actor.id) continue;
        rows.actionable.push({ id: `performance:approval:${row.id}`, kind: 'result_approval', title: `${row.employeeName} · 绩效结果审批`,
          status: row.status, nextAction: '审批当前绩效结果', dueAt: null, taskId: row.id, cycleId: row.cycleId,
          path: operationPath('/approval', { cycleId: row.cycleId, taskId: row.id }) });
      }
    }
    const attention = await lifecycleAttention(this.prisma, actor);
    const managementTasks = new Set(attention.flatMap(row => row.taskId ? [row.taskId] : []));
    rows.actionable = rows.actionable.filter(row => !row.taskId || !managementTasks.has(row.taskId));
    rows.attention.push(...attention);
    return rows;
  }
}
