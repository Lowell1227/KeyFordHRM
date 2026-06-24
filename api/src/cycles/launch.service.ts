import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IndicatorType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/notifications/notifications.service';
import { ExemptService } from './exempt.service';
import { serializeDecimals } from '@/common/interceptors/response.interceptor';

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
  entryDate: Date | null;
  leaveDate: Date | null;
}

/** launch 返回结果。 */
export interface LaunchResult {
  cycleId: string;
  totalTasks: number;
  exemptedTasks: number;
  activeTasks: number;
}

@Injectable()
export class LaunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exemptService: ExemptService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
  async launch(cycleId: string, operator: AuthUser): Promise<LaunchResult> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.assessmentCycle.findUnique({ where: { id: cycleId } });
      if (!cycle) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
      }
      if (cycle.status !== 'draft') {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '只能发起草稿状态的考核周期' });
      }

      const candidates = await this.findCandidates(tx);
      if (candidates.length === 0) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '当前没有符合被考核条件的员工' });
      }

      const templates = await this.findActiveTemplates(tx);
      if (templates.length === 0) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '当前没有可用的考核模板' });
      }

      const { matches, uncovered } = this.matchTemplates(candidates, templates);
      if (uncovered.length > 0) {
        const names = uncovered.map((u) => u.name).join('、');
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `以下员工未匹配到考核模板：${names}`,
        });
      }

      const usedTemplateIds = Array.from(new Set(matches.map((m) => m.template.id)));
      const snapshots = await this.createSnapshots(tx, cycleId, templates, usedTemplateIds);

      const deptIds = Array.from(new Set(candidates.map((c) => c.deptId).filter(Boolean))) as string[];
      const deptMap = await this.buildDeptMap(tx, deptIds);

      const ratio = await this.getExemptRatio(tx);
      const snapshotMap = new Map(snapshots.map((s) => [s.templateId, s.id]));

      let exemptedTasks = 0;
      const activeManagerIds = new Set<string>();

      for (const { candidate, template } of matches) {
        const snapshotId = snapshotMap.get(template.id)!;
        const dept = candidate.deptId ? deptMap.get(candidate.deptId) : null;

        const exempt = this.exemptService.calcExempt(candidate, cycle, ratio);

        if (exempt.isExempt) {
          await tx.assessmentTask.create({
            data: {
              cycleId,
              snapshotId,
              employeeId: candidate.id,
              deptId: candidate.deptId,
              managerId: candidate.directManagerId,
              deptHeadId: dept?.leaderId ?? null,
              approverId: dept?.approverId ?? null,
              status: 'exempted',
              isExempt: true,
              exemptReason: `在岗${exempt.onJobDays}天，不足周期1/3`,
            },
          });
          exemptedTasks++;
          continue;
        }

        const task = await tx.assessmentTask.create({
          data: {
            cycleId,
            snapshotId,
            employeeId: candidate.id,
            deptId: candidate.deptId,
            managerId: candidate.directManagerId,
            deptHeadId: dept?.leaderId ?? null,
            approverId: dept?.approverId ?? null,
            status: 'indicator_drafting',
            isExempt: false,
          },
        });

        await this.createIndicatorInstances(tx, task.id, template);

        if (candidate.directManagerId) {
          activeManagerIds.add(candidate.directManagerId);
        }
      }

      const totalTasks = matches.length;
      const activeTasks = totalTasks - exemptedTasks;

      await tx.assessmentCycle.update({
        where: { id: cycleId },
        data: { status: 'indicator_setting' },
      });

      // 通知在事务提交后发送，失败不阻断
      this.notifyManagers(cycleId, activeManagerIds, operator).catch(() => {
        // 错误已在 NotificationsService 内记录
      });

      return {
        cycleId,
        totalTasks,
        exemptedTasks,
        activeTasks,
      };
    }, { timeout: 60000, maxWait: 10000 });
  }

  /** 选出被考核候选人：deletedAt=null、status!=resigned、is_assessor_only=false。 */
  private async findCandidates(tx: Prisma.TransactionClient): Promise<Candidate[]> {
    return tx.user.findMany({
      where: {
        deletedAt: null,
        status: { not: 'resigned' },
        isAssessorOnly: false,
      },
      select: {
        id: true,
        name: true,
        deptId: true,
        directManagerId: true,
        entryDate: true,
        leaveDate: true,
      },
    });
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

    for (const candidate of candidates) {
      const template =
        templates.find((t) => t.applicableUsers.includes(candidate.id)) ??
        templates.find((t) => candidate.deptId != null && t.applicableDepts.includes(candidate.deptId)) ??
        (templates.length === 1 ? templates[0] : undefined);

      if (template) {
        matches.push({ candidate, template });
      } else {
        uncovered.push(candidate);
      }
    }

    return { matches, uncovered };
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
    deptIds: string[],
  ): Promise<Map<string, { leaderId: string | null; approverId: string | null }>> {
    if (deptIds.length === 0) return new Map();

    const depts = await tx.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, leaderId: true, approverId: true },
    });

    return new Map(depts.map((d) => [d.id, { leaderId: d.leaderId, approverId: d.approverId }]));
  }

  /** 读取系统配置的豁免阈值比例。 */
  private async getExemptRatio(tx: Prisma.TransactionClient): Promise<number> {
    const config = await tx.systemConfig.findUnique({ where: { key: 'exempt_threshold_ratio' } });
    if (!config) return 0.3333;
    const value = (config.value as { value?: number })?.value ?? config.value;
    return typeof value === 'number' ? value : 0.3333;
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

  /** 通知相关主管制定指标。 */
  private async notifyManagers(cycleId: string, managerIds: Set<string>, operator: AuthUser): Promise<void> {
    for (const managerId of managerIds) {
      await this.notificationsService.create({
        userId: managerId,
        senderId: operator.id,
        cycleId,
        type: 'indicator_setting_notice',
        title: '请制定指标',
        content: '您有新的绩效任务需要为员工制定考核指标，请及时处理。',
      });
    }
  }
}
