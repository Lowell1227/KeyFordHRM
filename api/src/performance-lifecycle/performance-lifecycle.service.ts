import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { TasksService } from '@/tasks/tasks.service';
import { GoalPlansService } from '@/goal-plans/goal-plans.service';
import { GoalChangesService } from '@/goal-changes/goal-changes.service';
import { ImprovementWorkflowService } from '@/improvement-plans/improvement-workflow.service';
import { ConfirmationService } from '@/confirmation/confirmation.service';
import { LifecycleMutationDto } from './lifecycle.dto';
import { assertLifecycleAction, canManageLifecycle, LifecycleAction, LifecycleKind, LifecycleRecord, lifecycleProjection } from './lifecycle-policy';
import { lockLifecycleRow } from './lifecycle-lock';
import { performanceHandover } from './lifecycle-handover';

const entities: Record<LifecycleKind, string> = {
  task: 'assessment_task', goal_change: 'goal_change', improvement_plan: 'improvement_plan', confirmation: 'confirmation_application',
};

@Injectable()
export class PerformanceLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly changes: GoalChangesService,
    private readonly improvements: ImprovementWorkflowService,
    private readonly confirmations: ConfirmationService,
    private readonly goals: GoalPlansService,
  ) {}

  private async assertView(kind: LifecycleKind, id: string, viewer: AuthUser) {
    // Reuse the original projection's authorization; lifecycle capabilities never disclose domain content.
    switch (kind) {
      case 'task':
        try { return await this.tasks.findOne(id, viewer); }
        catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          // Goal-ledger operators need not receive full assessment/result access.
          return this.goals.findOne(id, viewer);
        }
      case 'goal_change': return this.changes.findOne(id, viewer);
      case 'improvement_plan': return this.improvements.findOne(id, viewer);
      case 'confirmation': return this.confirmations.findOne(id, viewer);
    }
  }

  private read(tx: Prisma.TransactionClient, kind: LifecycleKind, id: string) {
    switch (kind) {
      case 'task': return tx.assessmentTask.findUnique({ where: { id }, include: { gradeResult: {
        select: { approvedAt: true, employeeConfirmedAt: true, publishedAt: true, isPublished: true },
      } } });
      case 'goal_change': return tx.goalChangeRequest.findUnique({ where: { id } });
      case 'improvement_plan': return tx.improvementPlan.findUnique({ where: { id } });
      case 'confirmation': return tx.confirmationApplication.findUnique({ where: { id } });
    }
  }

  async findOne(kind: LifecycleKind, id: string, viewer: AuthUser) {
    const detail = await this.assertView(kind, id, viewer);
    const row = await this.read(this.prisma, kind, id);
    if (!row) throw new NotFoundException('记录不存在');
    const events = await this.prisma.auditLog.findMany({ where: { entityType: entities[kind], entityId: id,
      action: { in: ['lifecycle_terminated', 'lifecycle_deleted'] } },
      select: { id: true, action: true, createdAt: true, user: { select: { name: true } }, newValue: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const projection = detail as { currentOwnerId?: string | null; currentHandlerId?: string | null;
      workflowContext?: { currentHandler?: { id: string; nodeType: string } | null }; pendingRole?: string | null;
      managerId?: string | null; companyApproverId?: string | null };
    const taskHandler = projection.workflowContext?.currentHandler;
    const goalHandlerId = projection.currentHandlerId && 'employeeId' in row && projection.currentHandlerId !== row.employeeId
      ? projection.currentHandlerId : null;
    const reviewerIds = row.lifecycleStatus !== 'active' ? [] : kind === 'task'
      ? (taskHandler ? taskHandler.nodeType !== 'employee' ? [taskHandler.id] : [] : [goalHandlerId])
      : kind === 'confirmation' ? [projection.pendingRole === 'manager' ? projection.managerId
        : projection.pendingRole === 'company' ? projection.companyApproverId : null]
      : [projection.currentOwnerId];
    return { id, kind, ...lifecycleProjection(kind, row, viewer), ...await performanceHandover(this.prisma, reviewerIds), events: events.map((event) => ({
      id: event.id, action: event.action, createdAt: event.createdAt, actorName: event.user?.name ?? null,
      reason: (event.newValue as { reason?: string } | null)?.reason ?? null,
    })) };
  }

  async mutate(kind: LifecycleKind, id: string, action: LifecycleAction, input: LifecycleMutationDto, viewer: AuthUser) {
    if (!canManageLifecycle(viewer, action)) throw new ForbiddenException('没有该记录管理权限');
    if (!input.reason?.trim() || input.reason.trim().length > 1000 || !Number.isInteger(input.expectedLifecycleVersion)
      || input.expectedLifecycleVersion < 0 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
      throw new BadRequestException('请填写原因并提供有效读取版本');
    }
    await this.assertView(kind, id, viewer);
    return this.prisma.$transaction(async (tx) => {
      const row = await lockLifecycleRow(tx, kind, id);
      if (!row) throw new NotFoundException('记录不存在');
      // HR capability revocation updates this same user row. A queued action must see that commit.
      await tx.$queryRaw`SELECT id FROM users WHERE id=${viewer.id}::uuid FOR SHARE`;
      const currentActor = await tx.user.findUnique({ where: { id: viewer.id },
        select: { id: true, sysRole: true, hrCapabilities: true, isAssessorOnly: true, status: true, deletedAt: true, archivedAt: true } });
      if (!currentActor || !['active', 'probation'].includes(currentActor.status) || currentActor.deletedAt || currentActor.archivedAt
        || !canManageLifecycle({ ...viewer, ...currentActor }, action)) throw new ForbiddenException('当前管理权限已失效');
      await this.assertView(kind, id, { ...viewer, ...currentActor });
      if (row.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt) || row.lifecycleVersion !== input.expectedLifecycleVersion) {
        throw new ConflictException('记录已变化，请刷新后重试');
      }
      assertLifecycleAction(kind, row, action);
      const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
      if (kind === 'task' && action === 'terminate') {
        const children = await tx.goalChangeRequest.findMany({ where: { taskId: id, lifecycleStatus: 'active',
          status: { notIn: ['active', 'revoked'] }, effectiveVersionId: null }, orderBy: { id: 'asc' } });
        for (const child of children) {
          await tx.goalChangeRequest.updateMany({ where: { id: child.id, lifecycleStatus: 'active', revision: child.revision },
            data: { lifecycleStatus: 'terminated', lifecycleVersion: { increment: 1 }, terminatedAt: now,
              terminatedById: viewer.id, terminationReason: input.reason.trim(), updatedAt: now } });
          await tx.auditLog.create({ data: { userId: viewer.id, entityType: 'goal_change', entityId: child.id,
            action: 'lifecycle_terminated', oldValue: { status: child.status, lifecycleVersion: child.lifecycleVersion },
            newValue: { status: child.status, reason: input.reason.trim(), source: 'parent_task_terminated', taskId: id } } });
        }
      }
      const data = {
        lifecycleStatus: action === 'terminate' ? 'terminated' : 'deleted',
        lifecycleVersion: { increment: 1 }, updatedAt: now,
        ...(action === 'terminate' ? { terminatedAt: now, terminatedById: viewer.id, terminationReason: input.reason.trim() }
          : { deletedAt: now, deletedById: viewer.id, deletionReason: input.reason.trim() }),
      };
      // The row is locked and re-read above. Do not round-trip a timestamptz(6) via JS milliseconds in SQL equality.
      const where = { id, lifecycleVersion: row.lifecycleVersion };
      let result: { count: number };
      switch (kind) {
        case 'task': result = await tx.assessmentTask.updateMany({ where, data }); break;
        case 'goal_change': result = await tx.goalChangeRequest.updateMany({ where, data }); break;
        case 'improvement_plan': result = await tx.improvementPlan.updateMany({ where, data }); break;
        case 'confirmation': result = await tx.confirmationApplication.updateMany({ where, data }); break;
      }
      if (result.count !== 1) throw new ConflictException('记录已变化，请刷新后重试');
      await tx.auditLog.create({ data: {
        userId: viewer.id, entityType: entities[kind], entityId: id,
        action: action === 'terminate' ? 'lifecycle_terminated' : 'lifecycle_deleted',
        oldValue: { status: row.status, lifecycleStatus: row.lifecycleStatus, lifecycleVersion: row.lifecycleVersion },
        newValue: { status: row.status, lifecycleStatus: data.lifecycleStatus, lifecycleVersion: row.lifecycleVersion + 1,
          reason: input.reason.trim(), source: 'explicit_management', employmentRecordId: 'employmentRecordId' in row ? row.employmentRecordId : null },
      } });
      if (kind === 'task') {
        // Keep delivery history but cancel unsent reminders for this task.
        await tx.notificationLog.updateMany({ where: { taskId: id, status: { in: ['pending', 'failed'] } },
          data: { status: 'cancelled', errorMsg: 'performance_lifecycle_ended' } });
      }
      return { id, kind, ...lifecycleProjection(kind, { ...row, ...data, lifecycleVersion: row.lifecycleVersion + 1 }, viewer) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
