import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { lifecycleArchiveReady } from '@/performance-lifecycle/lifecycle-policy';
import { assertCycleOperator, isGlobalCycleOperator } from './cycle-operator-scope';
import { TerminateCycleDto } from './cycle-termination.dto';
import { ARCHIVE_INDICATORS, buildPerformanceArchive } from '@/reports/performance-archive';

export function canDeleteCycle(actor: AuthUser, cycle: {
  hrOwnerId?: string | null; status: string; terminatedAt?: Date | null; deletedAt?: Date | null; openedAt?: Date | null;
}) {
  const draft = cycle.status === 'draft' && !cycle.terminatedAt && !cycle.openedAt;
  return !actor.isAssessorOnly && !cycle.deletedAt && (draft || !!cycle.terminatedAt)
    && hasHrCapability(actor, draft ? 'cycle_plan_edit' : 'cycle_delete')
    && (isGlobalCycleOperator(actor) || cycle.hrOwnerId === actor.id);
}

@Injectable()
export class CycleDeletionService {
  constructor(private readonly prisma: PrismaService) {}

  private async read(tx: Prisma.TransactionClient, id: string, actor: AuthUser) {
    const cycle = await tx.assessmentCycle.findUnique({ where: { id } });
    if (!cycle) throw new NotFoundException('考核周期不存在');
    const draft = cycle.status === 'draft' && !cycle.terminatedAt && !cycle.openedAt;
    const capability = draft ? 'cycle_plan_edit' : 'cycle_delete';
    if (actor.isAssessorOnly || !hasHrCapability(actor, capability)) throw new ForbiddenException('没有删除该周期的权限');
    assertCycleOperator(actor, cycle, capability);
    if (cycle.deletedAt) throw new ConflictException('本周期已删除，历史记录保留');
    if (!canDeleteCycle(actor, cycle)) throw new ConflictException('已发起周期需先终止，不能直接删除进行中的周期');
    const rows = await tx.assessmentTask.findMany({ where: { cycleId: id }, orderBy: { id: 'asc' },
      include: { employee: { select: { name: true, employeeNo: true } }, dept: { select: { name: true } },
        indicatorInstances: { ...ARCHIVE_INDICATORS, orderBy: { id: 'asc' } }, gradeResult: {
        select: { approvedAt: true, employeeConfirmedAt: true, publishedAt: true, isPublished: true, updatedAt: true,
          calculatedScore: true, rawGrade: true, calibratedGrade: true, coefficient: true },
      } } });
    const changes = await tx.goalChangeRequest.findMany({ where: { taskId: { in: rows.map(row => row.id) } }, orderBy: { id: 'asc' } });
    const blockedChangeTasks = new Set(changes.filter(row => row.lifecycleStatus !== 'deleted' && !lifecycleArchiveReady('goal_change', row)).map(row => row.taskId));
    const tasks = rows.map(row => {
      const blocked = (draft && rows.length > 0) || blockedChangeTasks.has(row.id)
        || (row.lifecycleStatus !== 'deleted' && !lifecycleArchiveReady('task', row));
      const disposition = blocked ? 'blocked' : row.lifecycleStatus === 'deleted' ? 'already_deleted' : 'delete';
      return { id: row.id, employeeName: row.employee.name, employeeNo: row.employee.employeeNo,
        status: row.status, lifecycleStatus: row.lifecycleStatus, disposition,
        reason: blocked ? draft ? '草稿存在实际任务，须先核查，不能直接删除'
          : blockedChangeTasks.has(row.id) ? '所属目标变更仍未办结，须先处理'
            : '仍有未办结的结果确认、公示、申诉或其他流程'
          : disposition === 'already_deleted' ? '此前已删除，保持原记录' : '仅逻辑删除，保留原状态、内容和审计' };
    });
    const summary = { total: tasks.length, deletable: tasks.filter(row => row.disposition === 'delete').length,
      blocked: tasks.filter(row => row.disposition === 'blocked').length,
      alreadyDeleted: tasks.filter(row => row.disposition === 'already_deleted').length,
      goalChanges: changes.filter(row => row.lifecycleStatus !== 'deleted').length };
    const previewHash = createHash('sha256').update(JSON.stringify({ cycle, rows, changes })).digest('hex');
    return { cycle, rows, changes, result: { cycle: { id, name: cycle.name, status: cycle.status,
      planVersion: cycle.planVersion, terminatedAt: cycle.terminatedAt, deletedAt: cycle.deletedAt },
      canDelete: summary.blocked === 0, previewHash, summary, tasks } };
  }

  async preview(id: string, viewer: AuthUser) {
    return (await this.read(this.prisma, id, viewer)).result;
  }

  async remove(id: string, input: TerminateCycleDto, viewer: AuthUser) {
    const reason = input.reason?.trim();
    if (!reason || reason.length > 1000 || !/^[a-f0-9]{64}$/.test(input.expectedPreviewHash ?? '')) throw new BadRequestException('请填写删除原因并重新读取完整影响清单');
    if (viewer.isAssessorOnly || !(hasHrCapability(viewer, 'cycle_delete') || hasHrCapability(viewer, 'cycle_plan_edit'))) throw new ForbiddenException('没有删除周期权限');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT p.id FROM assessment_periods p JOIN assessment_tasks t ON t.id=p.task_id WHERE t.cycle_id=${id}::uuid ORDER BY p.id FOR UPDATE OF p`;
      await tx.$queryRaw`SELECT id FROM assessment_tasks WHERE cycle_id=${id}::uuid ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT g.id FROM goal_change_requests g JOIN assessment_tasks t ON t.id=g.task_id WHERE t.cycle_id=${id}::uuid ORDER BY g.id FOR UPDATE OF g`;
      await tx.$queryRaw`SELECT id FROM assessment_cycles WHERE id=${id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id=${viewer.id}::uuid FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: viewer.id }, select: {
        id: true, sysRole: true, hrCapabilities: true, isAssessorOnly: true, status: true, archivedAt: true, deletedAt: true,
      } });
      if (!actor || actor.archivedAt || actor.deletedAt || !['active', 'probation'].includes(actor.status)) throw new ForbiddenException('当前账号不可办理删除');
      const snapshot = await this.read(tx, id, { ...viewer, ...actor });
      if (snapshot.result.previewHash !== input.expectedPreviewHash) throw new ConflictException('影响范围已变化，请重新核对；已填写的原因保留');
      if (!snapshot.result.canDelete) throw new ConflictException('仍有未办结事项，本次未删除任何记录，请按影响清单先处理');
      const latest = [...snapshot.rows, ...snapshot.changes].reduce((value, row) => Math.max(value, row.updatedAt.getTime()), snapshot.cycle.updatedAt.getTime());
      const now = new Date(Math.max(Date.now(), latest + 1));
      const data = { lifecycleStatus: 'deleted' as const, lifecycleVersion: { increment: 1 },
        deletedAt: now, deletedById: actor.id, deletionReason: reason, updatedAt: now };
      let deletedGoalChangeCount = 0, deletedTaskCount = 0;
      for (const change of snapshot.changes.filter(row => row.lifecycleStatus !== 'deleted')) {
        const changed = await tx.goalChangeRequest.updateMany({ where: { id: change.id, lifecycleVersion: change.lifecycleVersion }, data });
        if (changed.count !== 1) throw new ConflictException('目标变更已变化，本次删除已回退，请重新核对');
        deletedGoalChangeCount++;
        await tx.auditLog.create({ data: { userId: actor.id, entityType: 'goal_change', entityId: change.id,
          action: 'lifecycle_deleted', oldValue: { status: change.status, lifecycleStatus: change.lifecycleStatus, lifecycleVersion: change.lifecycleVersion },
          newValue: { status: change.status, lifecycleStatus: 'deleted', reason, source: 'cycle_deleted', cycleId: id, taskId: change.taskId } } });
      }
      for (const task of snapshot.rows.filter(row => row.lifecycleStatus !== 'deleted')) {
        if (!task.terminatedAt && !task.isExempt && ['closed', 'published', 'confirmed'].includes(task.status)) {
          const archive = buildPerformanceArchive(task, id, now);
          if (archive) await tx.performanceArchive.upsert({
            where: { employeeId_cycleId: { employeeId: task.employeeId, cycleId: id } }, create: archive, update: {},
          });
        }
        const changed = await tx.assessmentTask.updateMany({ where: { id: task.id, lifecycleVersion: task.lifecycleVersion }, data });
        if (changed.count !== 1) throw new ConflictException('任务已变化，本次删除已回退，请重新核对');
        deletedTaskCount++;
        await tx.auditLog.create({ data: { userId: actor.id, entityType: 'assessment_task', entityId: task.id,
          action: 'lifecycle_deleted', oldValue: { status: task.status, lifecycleStatus: task.lifecycleStatus, lifecycleVersion: task.lifecycleVersion },
          newValue: { status: task.status, lifecycleStatus: 'deleted', reason, source: 'cycle_deleted', cycleId: id } } });
      }
      await tx.notificationLog.updateMany({ where: { taskId: { in: snapshot.rows.map(row => row.id) }, status: { in: ['pending', 'failed'] } },
        data: { status: 'cancelled', errorMsg: 'performance_cycle_deleted' } });
      const changed = await tx.assessmentCycle.updateMany({ where: { id, deletedAt: null, deletionVersion: snapshot.cycle.deletionVersion },
        data: { deletedAt: now, deletedById: actor.id, deletionReason: reason, deletionVersion: 1, updatedAt: now } });
      if (changed.count !== 1) throw new ConflictException('周期已变化，本次删除已回退，请重新核对');
      await tx.auditLog.create({ data: { userId: actor.id, entityType: 'assessment_cycle', entityId: id, action: 'cycle_deleted',
        oldValue: { status: snapshot.cycle.status, deletionVersion: snapshot.cycle.deletionVersion },
        newValue: { status: snapshot.cycle.status, reason, deletedTaskCount, deletedGoalChangeCount,
          alreadyDeletedTaskCount: snapshot.result.summary.alreadyDeleted, expectedPreviewHash: input.expectedPreviewHash } } });
      return { id, deletedAt: now, deletedTaskCount, deletedGoalChangeCount, alreadyDeletedTaskCount: snapshot.result.summary.alreadyDeleted };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 30000 });
  }
}
