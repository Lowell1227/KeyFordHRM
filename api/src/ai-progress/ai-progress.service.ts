import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable } from '@nestjs/common';
import { IndicatorProgressHealth, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ObjectivesService } from '../objectives/objectives.service';
import { AiConfigService } from './ai-config.service';
import { BotEligibilityService, BotSender } from './bot-eligibility.service';
import { ProgressDraft, ProgressDraftStore } from './progress-draft.store';
import { ProviderClient } from './provider-client';
import { ConfirmedDraftChanges, ProgressPreview, SavedProgress } from './recognition.types';

@Injectable()
export class AiProgressService {
  constructor(
    private readonly drafts: ProgressDraftStore,
    private readonly eligibility: BotEligibilityService,
    private readonly config: AiConfigService,
    private readonly provider: ProviderClient,
    private readonly objectives: ObjectivesService,
  ) {}

  async prepare(message: string, sender: BotSender): Promise<ProgressPreview> {
    const access = await this.eligibility.resolve(sender);
    if (access.kind === 'reply') return access;
    if (typeof message !== 'string' || !message.trim() || message.length > 10000)
      throw new BadRequestException('进展说明不能为空，且最多10000字');
    const draftId = randomUUID();
    const claimed = await this.drafts.claimDelivery(sender, draftId);
    if (claimed !== draftId) {
      const existing = await this.drafts.get(claimed);
      if (!existing) throw new ConflictException('消息正在处理中，请稍后重试或重新发送');
      this.assertOwner(existing, access.viewer.id, sender.conversationId);
      return this.getDraft(claimed, access.viewer.id);
    }
    try {
      const runtime = await this.config.getActiveRuntimeConfig();
      if (!runtime) {
        await this.drafts.releaseDelivery(sender, draftId);
        return { kind: 'reply', text: '进展助手暂不可用，请在HRM目标跟进中手动更新' };
      }
      // The provider recognizes an indicator; only the employee can resolve multiple writable months.
      const uniqueGoals = [...new Map(access.goals.map(goal => [goal.id, goal])).values()].map(goal =>
        access.goals.filter(item => item.id === goal.id).length > 1
          ? { ...goal, periodId: null, periodKey: null } : goal);
      const candidate = await this.provider.recognize({ message, goals: uniqueGoals }, runtime);
      const matches = access.goals.filter(goal => goal.id === candidate.indicatorId);
      const unique = !candidate.uncertain && matches.length === 1;
      const draft: ProgressDraft = {
        ...candidate, draftId, ownerId: access.viewer.id, sender: { ...sender }, goals: access.goals,
        indicatorId: matches.length ? candidate.indicatorId : null,
        periodId: unique ? matches[0].periodId : null, uncertain: !unique,
        provider: runtime.provider, configVersion: runtime.configVersion,
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      };
      await this.drafts.create(draft);
      return this.preview(draft, null);
    } catch (error) {
      await this.drafts.releaseDelivery(sender, draftId).catch(() => undefined);
      throw error;
    }
  }

  async getDraft(draftId: string, viewerId: string): Promise<ProgressPreview> {
    const { draft } = await this.ownedDraft(draftId, viewerId);
    return this.preview(draft, await this.objectives.findAiDraftProgress(draftId, viewerId));
  }

  async updateDraft(draftId: string, viewerId: string, changes: ConfirmedDraftChanges): Promise<ProgressPreview> {
    return this.drafts.withDraftLock(draftId, async () => {
      const { draft } = await this.ownedDraft(draftId, viewerId);
      if (await this.objectives.findAiDraftProgress(draftId, viewerId))
        throw new ConflictException('进展已保存，更正时请重新发送并保存一条新进展');
      this.validateChanges(changes);
      const updated = { ...draft, ...changes };
      if (changes.indicatorId !== undefined || changes.periodId !== undefined) {
        if (changes.periodId === undefined && draft.goals.filter(goal => goal.id === updated.indicatorId).length > 1)
          throw new BadRequestException('请选择要更新的月份');
        if (!draft.goals.some(goal => goal.id === updated.indicatorId && goal.periodId === updated.periodId))
          throw new BadRequestException('请选择本草稿中的目标和月份');
        updated.uncertain = false;
      }
      await this.drafts.update(updated);
      return this.preview(updated, null);
    });
  }

  async saveDraft(draftId: string, viewerId: string, conversationId?: string): Promise<SavedProgress> {
    return this.drafts.withDraftLock(draftId, async () => {
      const { draft, viewer } = await this.ownedDraft(draftId, viewerId, conversationId);
      const saved = await this.objectives.findAiDraftProgress(draftId, viewerId);
      if (saved) return saved;
      if (!this.preview(draft, null).canSave) throw new ConflictException('请先选择目标和月份并核对进展内容');
      const access = await this.objectives.findBotGoalAccess(viewer);
      if (access.kind !== 'ready') throw new ConflictException(access.message);
      if (!access.goals.some(goal => goal.id === draft.indicatorId && goal.periodId === draft.periodId))
        throw new ConflictException('目标或考核月份已不可更新，请刷新后重试');
      return this.objectives.updateIndicatorProgress(draft.indicatorId!, {
        ...(draft.periodId ? { periodId: draft.periodId } : {}),
        content: draft.content, actualValue: draft.actualValue, healthStatus: draft.healthStatus, progress: null,
      }, viewer, { aiDraftId: draftId, aiAssisted: true });
    });
  }

  private async ownedDraft(draftId: string, viewerId: string, conversationId?: string) {
    const draft = await this.drafts.get(draftId);
    if (!draft) throw new GoneException('草稿已过期，请重新发送进展');
    this.assertOwner(draft, viewerId, conversationId);
    const identity = await this.eligibility.resolveIdentity(draft.sender);
    if (identity.kind !== 'ready') throw new ForbiddenException(identity.text);
    if (identity.viewer.id !== viewerId) throw new ForbiddenException('账号绑定已变化，请重新发送进展');
    return { draft, viewer: identity.viewer };
  }

  private assertOwner(draft: ProgressDraft, viewerId: string, conversationId?: string) {
    if (draft.ownerId !== viewerId || (conversationId !== undefined && conversationId !== draft.sender.conversationId))
      throw new ForbiddenException('只能查看和保存本人会话中的进展草稿');
  }

  private validateChanges(changes: ConfirmedDraftChanges) {
    if (!changes || Array.isArray(changes) || Object.keys(changes).some(key => !['indicatorId', 'periodId', 'content', 'actualValue', 'healthStatus'].includes(key)))
      throw new BadRequestException('只能修改目标、月份、进展说明、实际值和状态');
    if ('content' in changes && (typeof changes.content !== 'string' || !changes.content.trim() || changes.content.length > 10000))
      throw new BadRequestException('进展说明不能为空，且最多10000字');
    if ('indicatorId' in changes && (typeof changes.indicatorId !== 'string' || !changes.indicatorId.trim()))
      throw new BadRequestException('请选择目标');
    if ('actualValue' in changes && changes.actualValue !== null && (typeof changes.actualValue !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(changes.actualValue)))
      throw new BadRequestException('实际值须为非负数，最多8位整数和2位小数');
    if ('healthStatus' in changes && changes.healthStatus !== null && !Object.values(IndicatorProgressHealth).includes(changes.healthStatus!))
      throw new BadRequestException('请选择有效的进展状态');
  }

  private preview(draft: ProgressDraft, saved: SavedProgress | null): Extract<ProgressPreview, { kind: 'draft' }> {
    const target = draft.goals.find(goal => goal.id === draft.indicatorId && goal.periodId === draft.periodId);
    const targetValue = target?.targetValue ? new Prisma.Decimal(target.targetValue) : null;
    const completionPercent = targetValue?.gt(0) && draft.actualValue !== null
      ? new Prisma.Decimal(draft.actualValue).div(targetValue).mul(100).toDecimalPlaces(2).toNumber() : null;
    return {
      kind: 'draft', draftId: draft.draftId, state: saved ? 'saved' : 'pending', expiresAt: draft.expiresAt,
      goals: draft.goals, indicatorId: draft.indicatorId, periodId: draft.periodId, content: draft.content,
      actualValue: draft.actualValue, healthStatus: draft.healthStatus, uncertain: draft.uncertain,
      canSave: !saved && !draft.uncertain && !!target,
      targetValue: target?.targetValue ?? null, unit: target?.unit ?? null, completionPercent,
      progress: completionPercent === null ? null : Math.min(100, Math.round(completionPercent)), saved,
    };
  }
}
