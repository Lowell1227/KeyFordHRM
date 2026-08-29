import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  AssessmentPeriodType,
  CycleType,
  IndicatorType,
  Prisma,
  ScoringFrequency,
  UserStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { ExemptService } from './exempt.service';
import { serializeDecimals } from '@/common/interceptors/response.interceptor';
import { buildEffectiveApproverMap } from '@/departments/department-relations';
import { validateTemplateWeights } from '@/templates/templates.validation';
import { buildPeriodDefinitions, businessDateKey } from './cycle-scoring-plan';

/** 模板匹配所需的模板视图。 */
interface TemplateView {
  id: string;
  name: string;
  description: string | null;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore: Prisma.Decimal;
  version: number;
  dimensions: Array<{
    id: string;
    name: string;
    weight: Prisma.Decimal;
    type: string;
    sortOrder: number;
    indicators: Array<{
      id: string;
      indicatorId: string | null;
      name: string;
      description: string | null;
      scoringStandard: string | null;
      dataSource: string | null;
      dataCaliber: string | null;
      targetValue: Prisma.Decimal | null;
      targetValueText: string | null;
      unit: string | null;
      weight: Prisma.Decimal;
      sortOrder: number;
      indicator: { type: string } | null;
    }>;
  }>;
}

/** 被考核候选人视图。 */
interface Candidate {
  id: string;
  name: string;
  deptId: string | null;
  directManagerId: string | null;
  directManager: { name: string } | null;
  entryDate: Date | null;
  leaveDate: Date | null;
}

interface CandidateSelection {
  included: Candidate[];
  exclusions: Array<{
    employeeId: string;
    employeeName: string;
    reasonCode: 'PROBATION_NOT_IN_PLAN';
    reason: '试用期员工不进入本绩效计划';
  }>;
}

interface LaunchPeriodSchedule {
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  periodStart: Date;
  periodEnd: Date;
  selfEvalOpenAt: Date;
  selfEvalDueAt: Date;
  managerDueAt: Date;
  isException: boolean;
}

interface CompanyFinalApprover extends Candidate {
  status: UserStatus;
  deletedAt: Date | null;
}

type ParticipantDispositionValue = 'active' | 'cycle_exempt' | 'top_leader_exempt';

interface LaunchDepartment {
  name: string;
  parentId: string | null;
  leaderId: string | null;
  effectiveApproverId: string | null;
}

/** launch 返回结果。 */
export interface LaunchResult {
  cycleId: string;
  totalTasks: number;
  exemptedTasks: number;
  activeTasks: number;
  periodCount?: number;
  indicatorVersionCount?: number;
}

export interface LaunchOptions {
  source?: 'manual' | 'scheduled';
  now?: Date;
  expectedPlanHash?: string;
  overrideReason?: string;
}

export interface LaunchPreflightResult {
  ready: boolean;
  planHash: string | null;
  cycle: {
    id: string;
    name: string;
    status: string;
    goalSettingOpenAt: Date | null;
    planVersion: number;
  };
  participantCount: number;
  templateCount: number;
  participants: Array<{
    employeeId: string;
    employeeName: string;
    deptId: string | null;
    deptName: string | null;
    managerId: string | null;
    managerName: string | null;
    deptHeadId: string | null;
    approverId: string | null;
    templateId: null;
    templateName: null;
    templateVersion: null;
    isExempt: boolean;
    exemptReason: string | null;
    participantDisposition?: ParticipantDispositionValue;
  }>;
  exclusions?: CandidateSelection['exclusions'];
  companyFinalApprover?: { id: string; name: string } | null;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

@Injectable()
export class LaunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exemptService: ExemptService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async preflight(cycleId: string): Promise<LaunchPreflightResult> {
    const client = this.prisma as unknown as Prisma.TransactionClient;
    const cycle = await client.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    if (!(['draft', 'scheduled', 'launch_blocked'] as string[]).includes(cycle.status)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '当前周期已发起，不能重新执行发起检查' });
    }

    const blockers: LaunchPreflightResult['blockers'] = [];
    const warnings: LaunchPreflightResult['warnings'] = [];
    if (cycle.reviewStatus !== 'approved') {
      blockers.push({ code: 'CYCLE_NOT_APPROVED', message: '周期计划需由审核人通过后才能发起' });
    }
    const isWorkflowV2 = this.isWorkflowV2(cycle);
    const configuredCompanyFinalApproverId = isWorkflowV2
      ? await this.resolveConfiguredCompanyFinalApproverId(client)
      : null;
    const effectiveCycle = isWorkflowV2
      ? { ...cycle, companyFinalApproverId: configuredCompanyFinalApproverId }
      : cycle;
    const selection = await this.findCandidates(client, effectiveCycle);
    const schedules = isWorkflowV2
      ? await this.findPeriodSchedules(client, cycle.id)
      : [];
    const companyFinalApprover = isWorkflowV2
      ? await this.findCompanyFinalApprover(client, configuredCompanyFinalApproverId)
      : null;
    if (isWorkflowV2) {
      blockers.push(...this.workflowV2ConfigurationBlockers(
        effectiveCycle,
        schedules,
        companyFinalApprover,
      ));
    }
    const candidates = isWorkflowV2
      ? this.includeCompanyFinalApprover(selection.included, companyFinalApprover)
      : selection.included;
    const exclusions = isWorkflowV2 && this.isEligibleCompanyFinalApprover(companyFinalApprover)
      ? selection.exclusions.filter(({ employeeId }) => employeeId !== companyFinalApprover.id)
      : selection.exclusions;
    const deptMap = await this.buildDeptMap(client);
    const exemptRatio = await this.getExemptRatio(client);

    if (candidates.length === 0) {
      blockers.push({ code: 'NO_PARTICIPANTS', message: '当前没有符合被考核条件的员工' });
    }
    if (candidates.length > 0) {
      try {
        this.assertLaunchRelations(candidates, deptMap, effectiveCycle);
      } catch (error) {
        blockers.push(this.toPreflightBlocker('ORGANIZATION_RELATION_INVALID', error));
      }
    }

    const plan = blockers.length === 0
      ? this.buildLaunchPlan(candidates, effectiveCycle, deptMap, exemptRatio, schedules)
      : null;

    return {
      ready: blockers.length === 0,
      planHash: plan ? this.hashLaunchPlan(plan) : null,
      cycle: {
        id: cycle.id,
        name: cycle.name,
        status: cycle.status,
        goalSettingOpenAt: cycle.goalSettingOpenAt,
        planVersion: cycle.planVersion ?? 1,
      },
      participantCount: candidates.length,
      templateCount: 0,
      participants: plan?.participants ?? [],
      ...(isWorkflowV2 && { exclusions }),
      ...(isWorkflowV2 && {
        companyFinalApprover: this.isEligibleCompanyFinalApprover(companyFinalApprover)
          ? { id: companyFinalApprover.id, name: companyFinalApprover.name }
          : null,
      }),
      blockers,
      warnings,
    };
  }

  async schedule(cycleId: string, operator: AuthUser, expectedPlanHash: string) {
    const result = await this.preflight(cycleId);
    if (!result.ready) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: result.blockers.map((blocker) => blocker.message).join('；'),
        blockers: result.blockers,
      });
    }
    if (!['draft', 'launch_blocked'].includes(result.cycle.status)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '周期已预约发起，无需重复预约' });
    }
    if (!result.planHash || result.planHash !== expectedPlanHash) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '发起检查结果已变化，请重新检查后再预约',
      });
    }

    const scheduledAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const update = await tx.assessmentCycle.updateMany({
        where: {
          id: cycleId,
          status: { in: ['draft', 'launch_blocked'] },
          openedAt: null,
          planVersion: result.cycle.planVersion,
          reviewStatus: 'approved',
        },
        data: {
          status: 'scheduled',
          scheduledAt,
          scheduledById: operator.id,
          launchPlan: {
            participantCount: result.participantCount,
            templateCount: result.templateCount,
            participants: result.participants,
          } as Prisma.InputJsonValue,
          launchPlanHash: result.planHash,
          launchBlockedAt: null,
          launchBlockedReason: null,
        },
      });
      if (update.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '周期状态已变化，请刷新后重新执行发起检查' });
      }
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'cycle_launch_scheduled',
          entityType: 'assessment_cycle',
          entityId: cycleId,
          newValue: { scheduledAt: scheduledAt.toISOString(), planHash: result.planHash },
        },
      });
    });

    return {
      cycleId,
      status: 'scheduled' as const,
      goalSettingOpenAt: result.cycle.goalSettingOpenAt,
      participantCount: result.participantCount,
      templateCount: result.templateCount,
    };
  }

  async cancelSchedule(cycleId: string, operator: AuthUser) {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }
    if (!['scheduled', 'launch_blocked'].includes(cycle.status)) {
      throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '只有待发起或发起受阻的周期可以取消预约' });
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.assessmentCycle.updateMany({
        where: {
          id: cycleId,
          status: { in: ['scheduled', 'launch_blocked'] },
          openedAt: null,
        },
        data: {
          status: 'draft',
          scheduledAt: null,
          scheduledById: null,
          launchPlan: Prisma.DbNull,
          launchPlanHash: null,
          launchBlockedAt: null,
          launchBlockedReason: null,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '周期状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'cycle_launch_schedule_cancelled',
          entityType: 'assessment_cycle',
          entityId: cycleId,
        },
      });
    });
    return this.prisma.assessmentCycle.findUnique({ where: { id: cycleId } });
  }

  /**
   * 发起考核周期。
   *
   * 整体事务：
   * 1. 校验周期为 draft 状态。
   * 2. 选出被考核候选人。
   * 3. 为每人匹配模板（applicableUsers 优先于 applicableDepts）；未覆盖则 4001。
   * 4. 为每个被用模板生成快照。
   * 5. 计算豁免并批量创建 task / indicator_instance。
   * 6. 周期状态推进为 indicator_setting。
   * 7. 异步通知相关主管（失败不阻断）。
   */
  async launch(cycleId: string, operator: AuthUser, options: LaunchOptions = {}): Promise<LaunchResult> {
    const launch = await this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id: cycleId } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (!(['draft', 'scheduled', 'launch_blocked'] as const).includes(
        cycle.status as 'draft' | 'scheduled' | 'launch_blocked',
      )) {
        if (cycle.openedAt) return this.existingLaunchResult(tx, cycleId, cycle.workflowVersion);
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '当前周期状态不能开放目标制定' });
      }
      if (options.source === 'scheduled' && cycle.status !== 'scheduled') {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '周期已不处于待发起状态，定时任务不会自动重试',
        });
      }

      if (cycle.reviewStatus !== 'approved') {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '周期计划需由审核人通过后才能发起',
        });
      }

      const isWorkflowV2 = this.isWorkflowV2(cycle);
      if (isWorkflowV2) await this.lockCompanyFinalApproverConfig(tx);
      const configuredCompanyFinalApproverId = isWorkflowV2
        ? await this.resolveConfiguredCompanyFinalApproverId(tx)
        : null;
      const effectiveCycle = isWorkflowV2
        ? { ...cycle, companyFinalApproverId: configuredCompanyFinalApproverId }
        : cycle;
      const selection = await this.findCandidates(tx, effectiveCycle);
      const schedules = isWorkflowV2
        ? await this.findPeriodSchedules(tx, cycle.id)
        : [];
      const companyFinalApprover = isWorkflowV2
        ? await this.findCompanyFinalApprover(tx, configuredCompanyFinalApproverId)
        : null;
      if (isWorkflowV2) {
        const configurationBlockers = this.workflowV2ConfigurationBlockers(
          effectiveCycle,
          schedules,
          companyFinalApprover,
        );
        if (configurationBlockers.length > 0) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: configurationBlockers.map((blocker) => blocker.message).join('；'),
            blockers: configurationBlockers,
          });
        }
      }
      const candidates = isWorkflowV2
        ? this.includeCompanyFinalApprover(selection.included, companyFinalApprover)
        : selection.included;
      if (candidates.length === 0) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '当前没有符合被考核条件的员工' });
      }

      const openedAt = options.now ?? new Date();
      const opensEarly = Boolean(cycle.goalSettingOpenAt && openedAt < cycle.goalSettingOpenAt);
      if (opensEarly) {
        if (operator.sysRole !== 'system_admin' || options.source === 'scheduled') {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: `目标制定开放窗口尚未开始，开放时间为 ${cycle.goalSettingOpenAt!.toISOString()}`,
          });
        }
        if (!options.overrideReason?.trim()) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: '管理员提前开放必须填写原因',
          });
        }
      }

      const deptMap = await this.buildDeptMap(tx);
      this.assertLaunchRelations(candidates, deptMap, effectiveCycle);

      const ratio = await this.getExemptRatio(tx);
      const currentPlan = this.buildLaunchPlan(candidates, effectiveCycle, deptMap, ratio, schedules);
      const currentPlanHash = this.hashLaunchPlan(currentPlan);
      const expectedPlanHash = options.source === 'scheduled'
        ? cycle.launchPlanHash
        : options.expectedPlanHash;
      if (!expectedPlanHash || expectedPlanHash !== currentPlanHash) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '人员、组织关系或周期配置已变化，请重新执行发起检查',
        });
      }

      const claim = await tx.assessmentCycle.updateMany({
        where: {
          id: cycleId,
          status: cycle.status,
          openedAt: null,
          planVersion: cycle.planVersion ?? 1,
          reviewStatus: 'approved',
        },
        data: {
          status: 'indicator_setting',
          openedAt,
          openedById: operator.id,
          openSource: options.source ?? 'manual',
          launchPlan: currentPlan as Prisma.InputJsonValue,
          launchPlanHash: currentPlanHash,
          launchBlockedAt: null,
          launchBlockedReason: null,
          ...(isWorkflowV2 && { companyFinalApproverId: configuredCompanyFinalApproverId }),
        },
      });
      if (claim.count !== 1) {
        const latest = await tx.assessmentCycle.findUnique({ where: { id: cycleId } });
        if (latest?.openedAt) return this.existingLaunchResult(tx, cycleId, latest.workflowVersion);
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '周期状态已变化，请刷新后重试' });
      }

      let exemptedTasks = 0;
      const activeEmployeeIds = new Set<string>();
      const activeManagerIds = new Set<string>();
      const exemptEmployeeIds = new Set<string>();
      const exemptManagerIds = new Set<string>();
      let periodCount = 0;
      let indicatorVersionCount = 0;

      for (const candidate of candidates) {
        const dept = candidate.deptId ? deptMap.get(candidate.deptId) : null;
        const manager = this.resolveLaunchManager(candidate, dept, effectiveCycle);

        const disposition = this.resolveParticipantDisposition(candidate, effectiveCycle, ratio);

        if (disposition.isExempt) {
          await tx.assessmentTask.create({
            data: {
              cycleId,
              snapshotId: null,
              employeeId: candidate.id,
              deptId: candidate.deptId,
              managerId: manager.id,
              deptHeadId: dept?.leaderId ?? null,
              approverId: dept?.effectiveApproverId ?? null,
              status: 'exempted',
              isExempt: true,
              exemptReason: disposition.reason,
              ...(isWorkflowV2 && {
                participantDisposition: disposition.participantDisposition,
              }),
            },
          });
          exemptedTasks++;
          exemptEmployeeIds.add(candidate.id);
          if (manager.id) exemptManagerIds.add(manager.id);
          continue;
        }

        const task = await tx.assessmentTask.create({
          data: {
            cycleId,
            snapshotId: null,
            employeeId: candidate.id,
            deptId: candidate.deptId,
            managerId: manager.id,
            deptHeadId: dept?.leaderId ?? null,
            approverId: dept?.effectiveApproverId ?? null,
            status: 'indicator_drafting',
            isExempt: false,
            ...(isWorkflowV2 && { participantDisposition: 'active' }),
          },
        });

        if (isWorkflowV2) {
          await tx.indicatorVersion.create({
            data: {
              taskId: task.id,
              version: 1,
              status: 'draft',
              effectiveFromPeriodKey: schedules[0].periodKey,
              createdById: operator.id,
            },
          });
          indicatorVersionCount++;

          await tx.assessmentPeriod.createMany({
            data: schedules.map((schedule) => ({
              taskId: task.id,
              periodKey: schedule.periodKey,
              periodType: schedule.periodType,
              sequence: schedule.sequence,
              periodStart: schedule.periodStart,
              periodEnd: schedule.periodEnd,
              managerId: task.managerId,
              indicatorVersionId: null,
              status: 'unopened',
              selfEvalOpenAt: schedule.selfEvalOpenAt,
              selfEvalDueAt: schedule.selfEvalDueAt,
              managerDueAt: schedule.managerDueAt,
            })),
          });
          periodCount += schedules.length;
        }

        activeEmployeeIds.add(candidate.id);

        if (manager.id) {
          activeManagerIds.add(manager.id);
        }
      }

      const totalTasks = candidates.length;
      const activeTasks = totalTasks - exemptedTasks;

      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'cycle_goal_setting_opened',
          entityType: 'assessment_cycle',
          entityId: cycleId,
          newValue: {
            openedAt: openedAt.toISOString(),
            source: options.source ?? 'manual',
            totalTasks,
            exemptedTasks,
            planHash: currentPlanHash,
            overrideReason: opensEarly ? options.overrideReason!.trim() : null,
          },
        },
      });

      return {
        cycleId,
        totalTasks,
        exemptedTasks,
        activeTasks,
        ...(isWorkflowV2 && { periodCount, indicatorVersionCount }),
        activeEmployeeIds,
        activeManagerIds,
        exemptEmployeeIds,
        exemptManagerIds,
      };
    }, { timeout: 60000, maxWait: 10000 });

    const { activeEmployeeIds, activeManagerIds, exemptEmployeeIds, exemptManagerIds, ...result } = launch;
    await this.notifyLaunchParticipants(
      cycleId,
      activeEmployeeIds,
      activeManagerIds,
      exemptEmployeeIds,
      exemptManagerIds,
      operator,
    );
    return result;
  }

  /** 选出被考核候选人；v2 将试用期员工单列为可解释的排除项。 */
  private async findCandidates(
    tx: Prisma.TransactionClient,
    cycle: {
      workflowVersion?: number | null;
      participantDeptIds: string[];
      participantUserIds: string[];
      explicitExemptDeptIds: string[];
      explicitExemptUserIds: string[];
    },
  ): Promise<CandidateSelection> {
    const participantDeptIds = cycle.participantDeptIds ?? [];
    const participantUserIds = cycle.participantUserIds ?? [];
    const explicitExemptDeptIds = cycle.explicitExemptDeptIds ?? [];
    const explicitExemptUserIds = cycle.explicitExemptUserIds ?? [];
    const hasScopedParticipants = participantDeptIds.length > 0 || participantUserIds.length > 0;
    const explicitlyIncludedUserIds = [...new Set([
      ...participantUserIds,
      ...explicitExemptUserIds,
    ])];
    const scopeWhere = {
      deletedAt: null,
      isAssessorOnly: false,
      ...(explicitlyIncludedUserIds.length === 0
        ? { accountType: AccountType.employee }
        : {
            AND: [{
              OR: [
                { accountType: AccountType.employee },
                { id: { in: explicitlyIncludedUserIds } },
              ],
            }],
          }),
      ...(hasScopedParticipants && {
        OR: [
          ...(participantDeptIds.length > 0 ? [{ deptId: { in: participantDeptIds } }] : []),
          ...(participantUserIds.length > 0 ? [{ id: { in: participantUserIds } }] : []),
          ...(explicitExemptDeptIds.length > 0 ? [{ deptId: { in: explicitExemptDeptIds } }] : []),
          ...(explicitExemptUserIds.length > 0 ? [{ id: { in: explicitExemptUserIds } }] : []),
        ],
      }),
    };
    const select = {
      id: true,
      name: true,
      deptId: true,
      directManagerId: true,
      directManager: { select: { name: true } },
      entryDate: true,
      leaveDate: true,
    } as const;

    if (!this.isWorkflowV2(cycle)) {
      const included = await tx.user.findMany({
        where: { ...scopeWhere, status: { not: 'resigned' } },
        select,
      });
      return { included, exclusions: [] };
    }

    const eligible = await tx.user.findMany({
      where: {
        ...scopeWhere,
        status: { in: [UserStatus.active, UserStatus.probation] },
      },
      select: { ...select, status: true },
    });
    const included = eligible.filter((employee) => employee.status === UserStatus.active);
    const probation = eligible.filter((employee) => employee.status === UserStatus.probation);
    return {
      included,
      exclusions: probation.map((employee) => ({
        employeeId: employee.id,
        employeeName: employee.name,
        reasonCode: 'PROBATION_NOT_IN_PLAN' as const,
        reason: '试用期员工不进入本绩效计划' as const,
      })),
    };
  }

  /** 查询所有未删除的生效模板（含维度、指标、指标类型）。 */
  private async findActiveTemplates(tx: Prisma.TransactionClient): Promise<TemplateView[]> {
    return tx.assessmentTemplate.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      include: {
        dimensions: {
          orderBy: { sortOrder: 'asc' },
          include: {
            indicators: {
              orderBy: { sortOrder: 'asc' },
              include: {
                indicator: { select: { type: true } },
              },
            },
          },
        },
      },
    }) as unknown as TemplateView[];
  }

  /**
   * 模板匹配：applicableUsers 优先于 applicableDepts。
   * 返回匹配结果与未覆盖人员列表。
   */
  private matchTemplates(
    candidates: Candidate[],
    templates: TemplateView[],
  ): { matches: Array<{ candidate: Candidate; template: TemplateView }>; uncovered: Candidate[] } {
    const matches: Array<{ candidate: Candidate; template: TemplateView }> = [];
    const uncovered: Candidate[] = [];
    const companyTemplates = templates.filter((template) =>
      template.applicableUsers.length === 0 && template.applicableDepts.length === 0,
    );
    if (companyTemplates.length > 1) {
      const affectedCount = candidates.filter((candidate) => {
        const hasPersonTemplate = templates.some((template) =>
          template.applicableUsers.includes(candidate.id),
        );
        const hasDepartmentTemplate = Boolean(candidate.deptId) && templates.some((template) =>
          template.applicableDepts.includes(candidate.deptId!),
        );
        return !hasPersonTemplate && !hasDepartmentTemplate;
      }).length;
      if (affectedCount > 0) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `存在 ${companyTemplates.length} 套启用的公司默认模板，影响 ${affectedCount} 名员工：${companyTemplates.map((template) => template.name).join('、')}`,
        });
      }
    }

    for (const candidate of candidates) {
      const personTemplates = templates.filter((template) =>
        template.applicableUsers.includes(candidate.id),
      );
      if (personTemplates.length > 1) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `员工“${candidate.name}”匹配到多个人员模板：${personTemplates.map((template) => template.name).join('、')}`,
        });
      }

      const departmentTemplates = personTemplates.length === 0 && candidate.deptId
        ? templates.filter((template) => template.applicableDepts.includes(candidate.deptId!))
        : [];
      if (departmentTemplates.length > 1) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `员工“${candidate.name}”匹配到多个部门模板：${departmentTemplates.map((template) => template.name).join('、')}`,
        });
      }

      const candidateCompanyTemplates = personTemplates.length === 0 && departmentTemplates.length === 0
        ? companyTemplates
        : [];

      const template = personTemplates[0]
        ?? departmentTemplates[0]
        ?? candidateCompanyTemplates[0];

      if (template) {
        matches.push({ candidate, template });
      } else {
        uncovered.push(candidate);
      }
    }

    return { matches, uncovered };
  }

  private assertMatchedTemplateWeights(templates: TemplateView[]): void {
    const uniqueTemplates = [...new Map(templates.map((template) => [template.id, template])).values()];
    for (const template of uniqueTemplates) {
      const result = validateTemplateWeights(template.dimensions.map((dimension) => ({
        name: dimension.name,
        type: dimension.type,
        weight: dimension.weight.toNumber(),
        indicators: dimension.indicators.map((indicator) => ({
          name: indicator.name,
          weight: indicator.weight.toNumber(),
        })),
      })));
      if (!result.valid) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `模板“${template.name}”权重无效：${result.message}`,
        });
      }
    }
  }

  private toPreflightBlocker(code: string, error: unknown): { code: string; message: string } {
    if (error instanceof BadRequestException || error instanceof ConflictException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response && 'message' in response) {
        return { code, message: String(response.message) };
      }
      return { code, message: String(response) };
    }
    return { code, message: error instanceof Error ? error.message : '发起检查失败' };
  }

  private buildLaunchPlan(
    candidates: Candidate[],
    cycle: {
      startDate: Date;
      endDate: Date;
      goalSettingOpenAt: Date | null;
      selfEvalOpenAt: Date | null;
      deadlineIndicatorSetting: Date | null;
      deadlineIndicatorConfirm: Date | null;
      deadlineSelfEval: Date | null;
      deadlineManagerScore: Date | null;
      deadlineHrCalibration: Date | null;
      deadlineApproval: Date | null;
      deadlinePublish: Date | null;
      hrOwnerId: string | null;
      participantDeptIds: string[];
      participantUserIds: string[];
      explicitExemptDeptIds: string[];
      explicitExemptUserIds: string[];
      workflowVersion?: number | null;
      scoringFrequency?: string | null;
      companyFinalApproverId?: string | null;
    },
    deptMap: Map<string, LaunchDepartment>,
    exemptRatio: number,
    schedules: LaunchPeriodSchedule[] = [],
  ) {
    const isWorkflowV2 = this.isWorkflowV2(cycle);
    const participants = candidates.map((candidate) => {
      const dept = candidate.deptId ? deptMap.get(candidate.deptId) : null;
      const manager = this.resolveLaunchManager(candidate, dept, cycle);
      const disposition = this.resolveParticipantDisposition(candidate, cycle, exemptRatio);
      return {
        employeeId: candidate.id,
        employeeName: candidate.name,
        deptId: candidate.deptId,
        deptName: dept?.name ?? null,
        managerId: manager.id,
        managerName: manager.name,
        deptHeadId: dept?.leaderId ?? null,
        approverId: dept?.effectiveApproverId ?? null,
        entryDate: candidate.entryDate?.toISOString() ?? null,
        leaveDate: candidate.leaveDate?.toISOString() ?? null,
        templateId: null,
        templateName: null,
        templateVersion: null,
        isExempt: disposition.isExempt,
        exemptReason: disposition.reason,
        ...(isWorkflowV2 && {
          participantDisposition: disposition.participantDisposition,
        }),
      };
    }).sort((a, b) => a.employeeId.localeCompare(b.employeeId));

    const plan = {
      cycleStartDate: cycle.startDate.toISOString(),
      cycleEndDate: cycle.endDate.toISOString(),
      goalSettingOpenAt: cycle.goalSettingOpenAt?.toISOString() ?? null,
      selfEvalOpenAt: cycle.selfEvalOpenAt?.toISOString() ?? null,
      deadlines: {
        indicatorSetting: cycle.deadlineIndicatorSetting?.toISOString() ?? null,
        indicatorConfirm: cycle.deadlineIndicatorConfirm?.toISOString() ?? null,
        selfEval: cycle.deadlineSelfEval?.toISOString() ?? null,
        managerScore: cycle.deadlineManagerScore?.toISOString() ?? null,
        hrCalibration: cycle.deadlineHrCalibration?.toISOString() ?? null,
        approval: cycle.deadlineApproval?.toISOString() ?? null,
        publish: cycle.deadlinePublish?.toISOString() ?? null,
      },
      hrOwnerId: cycle.hrOwnerId ?? null,
      participantDeptIds: [...(cycle.participantDeptIds ?? [])].sort(),
      participantUserIds: [...(cycle.participantUserIds ?? [])].sort(),
      explicitExemptDeptIds: [...(cycle.explicitExemptDeptIds ?? [])].sort(),
      explicitExemptUserIds: [...(cycle.explicitExemptUserIds ?? [])].sort(),
      exemptRatio,
      participants,
    };

    if (!isWorkflowV2) return plan;
    return {
      ...plan,
      workflowVersion: 2,
      scoringFrequency: cycle.scoringFrequency ?? null,
      companyFinalApproverId: cycle.companyFinalApproverId ?? null,
      periodSchedules: schedules.map((schedule) => ({
        periodKey: schedule.periodKey,
        periodType: schedule.periodType,
        sequence: schedule.sequence,
        periodStart: schedule.periodStart.toISOString(),
        periodEnd: schedule.periodEnd.toISOString(),
        selfEvalOpenAt: schedule.selfEvalOpenAt.toISOString(),
        selfEvalDueAt: schedule.selfEvalDueAt.toISOString(),
        managerDueAt: schedule.managerDueAt.toISOString(),
        isException: schedule.isException,
      })),
    };
  }

  private resolveParticipantDisposition(
    candidate: Candidate,
    cycle: {
      startDate: Date;
      endDate: Date;
      workflowVersion?: number | null;
      companyFinalApproverId?: string | null;
      explicitExemptDeptIds: string[];
      explicitExemptUserIds: string[];
    },
    exemptRatio: number,
  ): {
    participantDisposition: ParticipantDispositionValue;
    isExempt: boolean;
    reason: string | null;
  } {
    if (this.isWorkflowV2(cycle) && candidate.id === cycle.companyFinalApproverId) {
      return {
        participantDisposition: 'top_leader_exempt',
        isExempt: true,
        reason: '最高负责人豁免',
      };
    }
    const exemption = this.resolveExemption(candidate, cycle, exemptRatio);
    return {
      participantDisposition: exemption.isExempt ? 'cycle_exempt' : 'active',
      isExempt: exemption.isExempt,
      reason: exemption.reason,
    };
  }

  private resolveExemption(
    candidate: Candidate,
    cycle: {
      startDate: Date;
      endDate: Date;
      explicitExemptDeptIds: string[];
      explicitExemptUserIds: string[];
    },
    exemptRatio: number,
  ): { isExempt: boolean; reason: string | null } {
    if (candidate.deptId && (cycle.explicitExemptDeptIds ?? []).includes(candidate.deptId)) {
      return { isExempt: true, reason: 'HR 按部门设置为本周期豁免' };
    }
    if ((cycle.explicitExemptUserIds ?? []).includes(candidate.id)) {
      return { isExempt: true, reason: 'HR 在本周期中明确设置为豁免' };
    }
    const automatic = this.exemptService.calcExempt(candidate, cycle, exemptRatio);
    return {
      isExempt: automatic.isExempt,
      reason: automatic.isExempt ? `在岗${automatic.onJobDays}天，不足周期1/3` : null,
    };
  }

  private hashLaunchPlan(plan: ReturnType<LaunchService['buildLaunchPlan']>): string {
    return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  }

  private async existingLaunchResult(
    tx: Prisma.TransactionClient,
    cycleId: string,
    workflowVersion?: number | null,
  ) {
    if (workflowVersion !== 2) {
      const [totalTasks, exemptedTasks] = await Promise.all([
        tx.assessmentTask.count({ where: { cycleId } }),
        tx.assessmentTask.count({ where: { cycleId, isExempt: true } }),
      ]);
      return {
        cycleId,
        totalTasks,
        exemptedTasks,
        activeTasks: totalTasks - exemptedTasks,
        activeEmployeeIds: new Set<string>(),
        activeManagerIds: new Set<string>(),
        exemptEmployeeIds: new Set<string>(),
        exemptManagerIds: new Set<string>(),
      };
    }

    const [totalTasks, exemptedTasks, periodCount, indicatorVersionCount] = await Promise.all([
      tx.assessmentTask.count({ where: { cycleId } }),
      tx.assessmentTask.count({ where: { cycleId, isExempt: true } }),
      tx.assessmentPeriod.count({ where: { task: { cycleId } } }),
      tx.indicatorVersion.count({ where: { task: { cycleId } } }),
    ]);
    return {
      cycleId,
      totalTasks,
      exemptedTasks,
      activeTasks: totalTasks - exemptedTasks,
      periodCount,
      indicatorVersionCount,
      activeEmployeeIds: new Set<string>(),
      activeManagerIds: new Set<string>(),
      exemptEmployeeIds: new Set<string>(),
      exemptManagerIds: new Set<string>(),
    };
  }

  private isWorkflowV2(cycle: { workflowVersion?: number | null }): boolean {
    return cycle.workflowVersion === 2;
  }

  private async findPeriodSchedules(
    tx: Prisma.TransactionClient,
    cycleId: string,
  ): Promise<LaunchPeriodSchedule[]> {
    return tx.cyclePeriodSchedule.findMany({
      where: { cycleId },
      orderBy: { sequence: 'asc' },
    });
  }

  private async findCompanyFinalApprover(
    tx: Prisma.TransactionClient,
    companyFinalApproverId: string | null | undefined,
  ): Promise<CompanyFinalApprover | null> {
    if (!companyFinalApproverId) return null;
    return tx.user.findUnique({
      where: { id: companyFinalApproverId },
      select: {
        id: true,
        name: true,
        deptId: true,
        directManagerId: true,
        directManager: { select: { name: true } },
        entryDate: true,
        leaveDate: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  private async resolveConfiguredCompanyFinalApproverId(
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const config = await tx.systemConfig.findUnique({
      where: { key: 'performance_company_final_approver' },
    });
    const value = config?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const userId = (value as Prisma.JsonObject).userId;
    return typeof userId === 'string' && userId.trim() ? userId : null;
  }

  private async lockCompanyFinalApproverConfig(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "key"
      FROM "system_configs"
      WHERE "key" = 'performance_company_final_approver'
      FOR SHARE
    `);
  }

  private includeCompanyFinalApprover(
    candidates: Candidate[],
    companyFinalApprover: CompanyFinalApprover | null,
  ): Candidate[] {
    if (!this.isEligibleCompanyFinalApprover(companyFinalApprover)
      || candidates.some((candidate) => candidate.id === companyFinalApprover.id)) {
      return candidates;
    }
    return [...candidates, companyFinalApprover];
  }

  private isEligibleCompanyFinalApprover(
    companyFinalApprover: CompanyFinalApprover | null,
  ): companyFinalApprover is CompanyFinalApprover {
    return Boolean(
      companyFinalApprover
      && companyFinalApprover.status === UserStatus.active
      && companyFinalApprover.deletedAt === null,
    );
  }

  private workflowV2ConfigurationBlockers(
    cycle: {
      companyFinalApproverId?: string | null;
      type: CycleType;
      scoringFrequency: ScoringFrequency;
      startDate: Date;
      endDate: Date;
    },
    schedules: LaunchPeriodSchedule[],
    companyFinalApprover: CompanyFinalApprover | null,
  ): LaunchPreflightResult['blockers'] {
    const blockers: LaunchPreflightResult['blockers'] = [];
    if (!cycle.companyFinalApproverId || !this.isEligibleCompanyFinalApprover(companyFinalApprover)) {
      blockers.push({
        code: 'COMPANY_FINAL_APPROVER_MISSING',
        message: '未设置有效的公司最终审定人，请先完成配置',
      });
    } else if (companyFinalApprover.directManagerId) {
      blockers.push({
        code: 'ORGANIZATION_RELATION_INVALID',
        message: `公司最终审定人必须是没有直属上级的最高负责人：${companyFinalApprover.name}`,
      });
    }
    if (schedules.length === 0) {
      blockers.push({
        code: 'PERIOD_SCHEDULE_MISSING',
        message: '评分周期排期为空，请返回周期计划补齐后重新审核',
      });
    } else if (!this.persistedSchedulesMatchPlan(cycle, schedules)) {
      blockers.push({
        code: 'PERIOD_SCHEDULE_INVALID',
        message: '已保存的评分排期与周期类型或考核期间不一致，请返回周期计划重新生成并审核',
      });
    }
    return blockers;
  }

  private persistedSchedulesMatchPlan(
    cycle: {
      type: CycleType;
      scoringFrequency: ScoringFrequency;
      startDate: Date;
      endDate: Date;
    },
    schedules: LaunchPeriodSchedule[],
  ): boolean {
    let expected: ReturnType<typeof buildPeriodDefinitions>;
    try {
      expected = buildPeriodDefinitions({
        type: cycle.type,
        scoringFrequency: cycle.scoringFrequency,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      });
    } catch {
      return false;
    }
    if (schedules.length !== expected.length) return false;

    const schedulesByKey = new Map<string, LaunchPeriodSchedule>();
    for (const schedule of schedules) {
      if (schedulesByKey.has(schedule.periodKey)) return false;
      schedulesByKey.set(schedule.periodKey, schedule);
    }

    return expected.every((period) => {
      const schedule = schedulesByKey.get(period.periodKey);
      return Boolean(
        schedule
        && schedule.periodType === period.periodType
        && schedule.sequence === period.sequence
        && businessDateKey(schedule.periodStart) === businessDateKey(period.periodStart)
        && businessDateKey(schedule.periodEnd) === businessDateKey(period.periodEnd),
      );
    });
  }

  /** 为每个被使用模板生成快照。 */
  private async createSnapshots(
    tx: Prisma.TransactionClient,
    cycleId: string,
    templates: TemplateView[],
    usedTemplateIds: string[],
  ): Promise<Array<{ id: string; templateId: string }>> {
    const usedTemplates = templates.filter((t) => usedTemplateIds.includes(t.id));
    const snapshots: Array<{ id: string; templateId: string }> = [];

    for (const template of usedTemplates) {
      const snapshotData = serializeDecimals({
        templateId: template.id,
        name: template.name,
        description: template.description,
        maxScore: template.maxScore,
        version: template.version,
        dimensions: template.dimensions.map((dim) => ({
          id: dim.id,
          name: dim.name,
          weight: dim.weight,
          type: dim.type,
          sortOrder: dim.sortOrder,
          indicators: dim.indicators.map((ind) => ({
            id: ind.id,
            indicatorId: ind.indicatorId,
            name: ind.name,
            description: ind.description,
            scoringStandard: ind.scoringStandard,
            targetValue: ind.targetValue,
            targetValueText: ind.targetValueText,
            unit: ind.unit,
            weight: ind.weight,
            sortOrder: ind.sortOrder,
            indicatorType: (ind.indicator?.type === 'veto' ? 'veto' : dim.type) as any,
          })),
        })),
      });

      const snapshot = await tx.assessmentTemplateSnapshot.create({
        data: {
          cycleId,
          templateId: template.id,
          snapshotData: snapshotData as Prisma.InputJsonValue,
        },
      });

      snapshots.push({ id: snapshot.id, templateId: template.id });
    }

    return snapshots;
  }

  /** 构建部门信息映射（leaderId / approverId）。 */
  private async buildDeptMap(
    tx: Prisma.TransactionClient,
  ): Promise<Map<string, LaunchDepartment>> {
    const depts = await tx.department.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        leaderId: true,
        leader: {
          select: {
            name: true,
            directManagerId: true,
            directManager: { select: { name: true } },
          },
        },
        approverId: true,
        approver: { select: { name: true } },
      },
    });

    const effectiveApproverMap = buildEffectiveApproverMap(
      depts.map((dept) => ({
        id: dept.id,
        name: dept.name,
        parentId: dept.parentId ?? null,
        leaderId: dept.leaderId ?? null,
        leaderName: dept.leader?.name ?? null,
        leaderDirectManagerId: dept.leader?.directManagerId ?? null,
        leaderDirectManagerName: dept.leader?.directManager?.name ?? null,
        approverId: dept.approverId ?? null,
        approverName: dept.approver?.name ?? null,
      })),
    );

    return new Map(
      depts.map((dept) => [
        dept.id,
        {
          name: dept.name,
          parentId: dept.parentId ?? null,
          leaderId: dept.leaderId ?? null,
          effectiveApproverId: effectiveApproverMap.get(dept.id)?.effectiveApproverId ?? null,
        },
      ]),
    );
  }

  private assertLaunchRelations(
    candidates: Candidate[],
    deptMap: Map<string, LaunchDepartment>,
    cycle: {
      workflowVersion?: number | null;
      companyFinalApproverId?: string | null;
    },
  ): void {
    const missingDeptUsers = new Set<string>();
    const missingManagers = new Set<string>();
    const missingDeptLeaders = new Set<string>();
    const missingApprovers = new Set<string>();

    for (const candidate of candidates) {
      if (!candidate.deptId) {
        missingDeptUsers.add(candidate.name);
        continue;
      }

      const dept = deptMap.get(candidate.deptId);
      if (!dept) {
        missingDeptUsers.add(candidate.name);
        continue;
      }

      if (!this.resolveLaunchManager(candidate, dept, cycle).id
        && !(this.isWorkflowV2(cycle) && candidate.id === cycle.companyFinalApproverId)) {
        missingManagers.add(candidate.name);
      }

      if (!dept.leaderId) {
        missingDeptLeaders.add(dept.name);
      }

      if (!dept.effectiveApproverId) {
        missingApprovers.add(dept.name);
      }
    }

    const messages: string[] = [];
    if (missingDeptUsers.size > 0) {
      messages.push(`以下员工未分配部门：${Array.from(missingDeptUsers).join('、')}`);
    }
    if (missingManagers.size > 0) {
      messages.push(`以下员工未设置直属上级：${Array.from(missingManagers).join('、')}`);
    }
    if (missingDeptLeaders.size > 0) {
      messages.push(`以下部门未设置部门负责人：${Array.from(missingDeptLeaders).join('、')}`);
    }
    if (missingApprovers.size > 0) {
      const approverCopy = this.isWorkflowV2(cycle)
        ? '分管总审核人/公司最终审定人'
        : '最终业务审批人';
      messages.push(
        `以下部门未设置${approverCopy}，请补齐部门负责人及其直属上级；最高层级可手动设置：${Array.from(missingApprovers).join('、')}`,
      );
    }

    if (messages.length > 0) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: messages.join('；'),
      });
    }
  }

  /** v1 保留最高层负责人自管；v2 只使用结构化直属上级，最高负责人单独豁免。 */
  private resolveLaunchManager(
    candidate: Candidate,
    dept: LaunchDepartment | null | undefined,
    cycle: {
      workflowVersion?: number | null;
      companyFinalApproverId?: string | null;
    },
  ): { id: string | null; name: string | null } {
    if (candidate.directManagerId) {
      return {
        id: candidate.directManagerId,
        name: candidate.directManager?.name ?? null,
      };
    }
    if (this.isWorkflowV2(cycle)) {
      return { id: null, name: null };
    }
    if (dept?.parentId === null && dept.leaderId === candidate.id) {
      return { id: candidate.id, name: candidate.name };
    }
    return { id: null, name: null };
  }

  /** 读取系统配置的豁免阈值比例。 */
  private async getExemptRatio(tx: Prisma.TransactionClient): Promise<number> {
    const config = await tx.systemConfig.findUnique({ where: { key: 'exempt_threshold_ratio' } });
    if (!config) return 0.3333;
    const value = (config.value as { value?: number })?.value ?? config.value;
    return typeof value === 'number' ? value : 0.3333;
  }

  private findValidHrOwner(tx: Prisma.TransactionClient, hrOwnerId: string | null | undefined) {
    if (!hrOwnerId) return Promise.resolve(null);
    return tx.user.findFirst({
      where: {
        id: hrOwnerId,
        sysRole: 'hr',
        deletedAt: null,
        status: { not: 'resigned' },
      },
      select: { id: true, name: true },
    });
  }

  /** 从模板快照为任务创建指标实例。 */
  private async createIndicatorInstances(tx: Prisma.TransactionClient, taskId: string, template: TemplateView): Promise<void> {
    const instances = template.dimensions.flatMap((dim) =>
      dim.indicators.map((ind) => ({
        taskId,
        templateIndicatorId: ind.id,
        name: ind.name,
        description: ind.description,
        scoringStandard: ind.scoringStandard,
        dataSource: ind.dataSource,
        dataCaliber: ind.dataCaliber,
        targetValue: ind.targetValue != null ? new Prisma.Decimal(ind.targetValue.toString()) : null,
        targetValueText: ind.targetValueText,
        unit: ind.unit,
        weight: new Prisma.Decimal(ind.weight.toString()),
        indicatorType: this.resolveIndicatorType(ind.name, dim.type, ind.indicator?.type),
        dimensionName: dim.name,
        dimensionWeight: new Prisma.Decimal(dim.weight.toString()),
        sortOrder: ind.sortOrder,
      })),
    );

    if (instances.length > 0) {
      await tx.indicatorInstance.createMany({ data: instances });
    }
  }

  private resolveIndicatorType(name: string, dimensionType: string, linkedType?: string | null): IndicatorType {
    if (linkedType === 'veto') return 'veto';
    if (name.includes('否决') || name.includes('鍚﹀喅') || name.toLowerCase().includes('veto')) return 'veto';
    if (name.includes('减') || name.includes('鍑忓垎') || name.toLowerCase().includes('penalty')) return 'penalty';
    if (name.includes('加') || name.includes('鍔犲垎') || name.toLowerCase().includes('bonus')) return 'bonus';
    return dimensionType as IndicatorType;
  }

  /** 事务提交后通知员工开始填目标，同时提醒相关主管关注团队进度。 */
  private async notifyLaunchParticipants(
    cycleId: string,
    employeeIds: Set<string>,
    managerIds: Set<string>,
    exemptEmployeeIds: Set<string>,
    exemptManagerIds: Set<string>,
    operator: AuthUser,
  ): Promise<void> {
    const notifications = [
      ...Array.from(employeeIds, (employeeId) => ({
        userId: employeeId,
        senderId: operator.id,
        cycleId,
        type: 'indicator_setting_notice',
        title: '季度目标制定已开放',
        content: '新的绩效周期已开放，请在截止时间前填写并提交目标。',
      })),
      ...Array.from(managerIds, (managerId) => ({
        userId: managerId,
        senderId: operator.id,
        cycleId,
        type: 'indicator_setting_notice',
        title: '团队目标制定已开放',
        content: '新的绩效周期已开放，请关注团队成员的目标制定进度。',
      })),
      ...Array.from(exemptEmployeeIds, (employeeId) => ({
        userId: employeeId,
        senderId: operator.id,
        cycleId,
        type: 'indicator_setting_notice',
        title: '本季度绩效任务已豁免',
        content: '新的绩效周期已开放，您在本周期中已被标记为豁免，可进入周期查看原因。',
      })),
      ...Array.from(exemptManagerIds, (managerId) => ({
        userId: managerId,
        senderId: operator.id,
        cycleId,
        type: 'indicator_setting_notice',
        title: '团队成员存在绩效豁免',
        content: '新的绩效周期已开放，您的团队中有成员被标记为本周期豁免，请进入团队任务查看。',
      })),
    ];

    await Promise.allSettled(
      notifications.map((notification) => this.notificationsService.create(notification)),
    );
  }
}
