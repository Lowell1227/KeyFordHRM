import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { lifecycleTerminationProtected } from '@/performance-lifecycle/lifecycle-policy';
import { assertCycleOperator, isGlobalCycleOperator } from './cycle-operator-scope';
import { TerminateCycleDto } from './cycle-termination.dto';

export function canTerminateCycle(actor: AuthUser, cycle: { hrOwnerId?: string | null; terminatedAt?: Date | null; deletedAt?: Date | null; status: string }) {
  return !actor.isAssessorOnly && hasHrCapability(actor, 'cycle_terminate')
    && (isGlobalCycleOperator(actor) || cycle.hrOwnerId === actor.id) && !cycle.terminatedAt && !cycle.deletedAt
    && !['draft', 'scheduled', 'launch_blocked', 'closed'].includes(cycle.status);
}

@Injectable()
export class CycleTerminationService {
  constructor(private readonly prisma: PrismaService) {}

  private async read(tx: Prisma.TransactionClient, id: string, actor: AuthUser) {
    if (actor.isAssessorOnly || !hasHrCapability(actor, 'cycle_terminate')) throw new ForbiddenException('没有终止周期权限');
    const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
    if (!cycle) throw new NotFoundException('考核周期不存在');
    assertCycleOperator(actor, cycle, 'cycle_terminate');
    if (cycle.terminatedAt) throw new ConflictException('本周期已终止，请刷新查看终止记录');
    if (!canTerminateCycle(actor, cycle)) throw new ConflictException('仅已发起且尚未关闭的周期可以终止；草稿或预约请使用原办理入口');
    const rows = await tx.assessmentTask.findMany({ where: { cycleId: id }, orderBy: { id: 'asc' },
      include: { employee: { select: { name: true, employeeNo: true } }, gradeResult: {
        select: { approvedAt: true, employeeConfirmedAt: true, publishedAt: true, isPublished: true },
      } } });
    const tasks = rows.map(row => {
      const disposition = row.lifecycleStatus !== 'active' ? 'already_ended'
        : lifecycleTerminationProtected('task', row) ? 'protected' : 'terminate';
      return { id: row.id, employeeName: row.employee.name, employeeNo: row.employee.employeeNo,
        status: row.status, lifecycleStatus: row.lifecycleStatus, disposition,
        reason: disposition === 'terminate' ? '停止未完成办理，保留已有内容' : disposition === 'protected'
          ? '已审批、生效或豁免的事实保留，不执行终止' : '已经终止或移入历史，不重复办理' };
    });
    const ids = tasks.filter(row => row.disposition === 'terminate').map(row => row.id);
    const [changes, reminders, periods] = await Promise.all([
      tx.goalChangeRequest.findMany({ where: { taskId: { in: ids }, lifecycleStatus: 'active',
        status: { notIn: ['active', 'revoked'] }, effectiveVersionId: null }, orderBy: { id: 'asc' },
      select: { id: true, taskId: true, status: true, revision: true, lifecycleVersion: true, updatedAt: true } }),
      tx.notificationLog.findMany({ where: { taskId: { in: ids }, status: { in: ['pending', 'failed'] } },
        select: { id: true, status: true }, orderBy: { id: 'asc' } }),
      // Formal month submissions need not change the parent task's stage or timestamp.
      tx.assessmentPeriod.findMany({ where: { taskId: { in: ids } }, orderBy: { id: 'asc' },
        select: { id: true, taskId: true, status: true, indicatorVersionId: true, lockedAt: true,
          employeeSubmittedAt: true, managerSubmittedAt: true,
          revisions: { orderBy: { id: 'asc' }, select: { id: true, stage: true, revision: true } } } }),
    ]);
    const summary = { total: tasks.length, terminable: ids.length,
      protected: tasks.filter(row => row.disposition === 'protected').length,
      alreadyEnded: tasks.filter(row => row.disposition === 'already_ended').length,
      goalChanges: changes.length, reminders: reminders.length };
    const previewHash = createHash('sha256').update(JSON.stringify({ cycle, rows: rows.map(({ employee, ...row }) => row), changes, reminders, periods })).digest('hex');
    return { cycle, rows, changes, reminders, result: { cycle: { id, name: cycle.name, status: cycle.status,
      planVersion: cycle.planVersion, terminatedAt: cycle.terminatedAt }, canTerminate: summary.terminable > 0,
    previewHash, summary, tasks } };
  }

  async preview(id: string, viewer: AuthUser) {
    return (await this.read(this.prisma, id, viewer)).result;
  }

  async terminate(id: string, input: TerminateCycleDto, viewer: AuthUser) {
    const reason = input.reason?.trim();
    if (!reason || reason.length > 1000 || !/^[a-f0-9]{64}$/.test(input.expectedPreviewHash ?? '')) {
      throw new BadRequestException('请填写终止原因并重新读取完整影响清单');
    }
    if (!hasHrCapability(viewer, 'cycle_terminate') || viewer.isAssessorOnly) throw new ForbiddenException('没有终止周期权限');
    return this.prisma.$transaction(async tx => {
      // Existing writers lock periods/tasks before stage aggregation takes the cycle lock.
      await tx.$queryRaw`SELECT p.id FROM assessment_periods p JOIN assessment_tasks t ON t.id=p.task_id WHERE t.cycle_id=${id}::uuid ORDER BY p.id FOR UPDATE OF p`;
      await tx.$queryRaw`SELECT id FROM assessment_tasks WHERE cycle_id=${id}::uuid ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM assessment_cycles WHERE id=${id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id=${viewer.id}::uuid FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: viewer.id }, select: { id: true, sysRole: true, hrCapabilities: true,
        isAssessorOnly: true, status: true, archivedAt: true, deletedAt: true } });
      if (!actor || actor.archivedAt || actor.deletedAt || !['active', 'probation'].includes(actor.status)
        || !hasHrCapability(actor, 'cycle_terminate') || actor.isAssessorOnly) throw new ForbiddenException('当前终止周期权限已失效');
      const snapshot = await this.read(tx, id, { ...viewer, ...actor });
      if (snapshot.result.previewHash !== input.expectedPreviewHash) throw new ConflictException('影响范围已经变化，请重新核对清单；已填写的原因保留');
      if (!snapshot.result.canTerminate) throw new ConflictException('当前没有允许终止的未完成任务，既有结果保持不变');
      const now = new Date();
      let cancelledGoalChangeCount = 0;
      for (const task of snapshot.rows) {
        if (task.lifecycleStatus !== 'active' || lifecycleTerminationProtected('task', task)) continue;
        for (const change of snapshot.changes.filter(row => row.taskId === task.id)) {
          const result = await tx.goalChangeRequest.updateMany({ where: { id: change.id, lifecycleStatus: 'active', revision: change.revision },
            data: { lifecycleStatus: 'terminated', lifecycleVersion: { increment: 1 }, terminatedAt: now,
              terminatedById: actor.id, terminationReason: reason, updatedAt: now } });
          if (result.count !== 1) throw new ConflictException('目标变更已变化，请重新核对影响清单');
          cancelledGoalChangeCount++;
          await tx.auditLog.create({ data: { userId: actor.id, entityType: 'goal_change', entityId: change.id,
            action: 'lifecycle_terminated', oldValue: { status: change.status, lifecycleVersion: change.lifecycleVersion },
            newValue: { status: change.status, reason, source: 'cycle_terminated', cycleId: id, taskId: task.id } } });
        }
        const result = await tx.assessmentTask.updateMany({ where: { id: task.id, lifecycleStatus: 'active', lifecycleVersion: task.lifecycleVersion },
          data: { lifecycleStatus: 'terminated', lifecycleVersion: { increment: 1 }, terminatedAt: now,
            terminatedById: actor.id, terminationReason: reason, updatedAt: now } });
        if (result.count !== 1) throw new ConflictException('任务已变化，请重新核对影响清单');
        await tx.auditLog.create({ data: { userId: actor.id, entityType: 'assessment_task', entityId: task.id,
          action: 'lifecycle_terminated', oldValue: { status: task.status, lifecycleStatus: task.lifecycleStatus, lifecycleVersion: task.lifecycleVersion },
          newValue: { status: task.status, lifecycleStatus: 'terminated', reason, source: 'cycle_terminated', cycleId: id } } });
      }
      const ids = snapshot.result.tasks.filter(row => row.disposition === 'terminate').map(row => row.id);
      await tx.notificationLog.updateMany({ where: { taskId: { in: ids }, status: { in: ['pending', 'failed'] } },
        data: { status: 'cancelled', errorMsg: 'performance_cycle_terminated' } });
      await tx.assessmentCycle.update({ where: { id }, data: { terminatedAt: now, terminatedById: actor.id,
        terminationReason: reason, terminationVersion: 1, updatedAt: now } });
      const { terminable, protected: protectedCount, alreadyEnded } = snapshot.result.summary;
      await tx.auditLog.create({ data: { userId: actor.id, entityType: 'assessment_cycle', entityId: id, action: 'cycle_terminated',
        oldValue: { status: snapshot.cycle.status, terminationVersion: snapshot.cycle.terminationVersion },
        newValue: { status: snapshot.cycle.status, reason, expectedPreviewHash: input.expectedPreviewHash,
          terminatedCount: terminable, protectedCount, alreadyEndedCount: alreadyEnded, cancelledGoalChangeCount } } });
      return { id, terminatedAt: now, terminatedCount: terminable, protectedCount, alreadyEndedCount: alreadyEnded, cancelledGoalChangeCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 30000 });
  }
}
