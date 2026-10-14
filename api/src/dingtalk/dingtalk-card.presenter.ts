import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import type { PerformanceCard } from './performance-card.service';
import { AiConfigService } from '../ai-progress/ai-config.service';
import { BotEligibilityService, BotSender } from '../ai-progress/bot-eligibility.service';
import {
  ProgressDraft,
  ProgressDraftStore,
} from '../ai-progress/progress-draft.store';
import {
  ProgressPreview,
  SavedProgress,
} from '../ai-progress/recognition.types';
import { DingtalkBotCredentialsService } from './dingtalk-bot-credentials.service';
import { withDingtalkDeadline } from './dingtalk-request-deadline';

type DraftPreview = Extract<ProgressPreview, { kind: 'draft' }>;

@Injectable()
export class DingtalkCardPresenter {
  constructor(
    private readonly config: ConfigService,
    private readonly aiConfig: AiConfigService,
    private readonly dingtalkBot: DingtalkBotCredentialsService,
    private readonly drafts: ProgressDraftStore,
    private readonly eligibility: BotEligibilityService,
  ) {}

  async isEnabled() {
    if (
      this.config.get('DINGTALK_BOT_STREAM_ENABLED') !== 'true' ||
      this.config.get('DINGTALK_BOT_PREFLIGHT_CONFIRMED') !== 'true'
    )
      return false;
    for (const key of [
      'DINGTALK_BOT_APP_KEY',
      'DINGTALK_BOT_APP_SECRET',
      'DINGTALK_CORP_ID',
      'DINGTALK_BOT_STREAM_APP_ID',
      'DINGTALK_BOT_CARD_TEMPLATE_ID',
    ]) {
      const value = this.config.get<string>(key);
      if (!value?.trim() || value.includes('请填写')) return false;
    }
    try {
      const url = new URL(
        this.config.get<string>('DINGTALK_BOT_HRM_URL') ?? '',
      );
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        return false;
      const state = await this.aiConfig.getPublicState();
      return state.botEnabled && !!state.activeProvider;
    } catch {
      return false;
    }
  }

  previewCard(preview: DraftPreview) {
    const saved = preview.saved;
    const goal = preview.goals.find(
      (item) =>
        item.id === (saved?.indicatorId ?? preview.indicatorId) &&
        item.periodId === (saved ? (saved.periodId ?? null) : preview.periodId),
    );
    const canSave =
      preview.canSave &&
      !preview.uncertain &&
      !!goal &&
      preview.state === 'pending';
    const content = saved ? saved.content : preview.content;
    const actualValue = saved ? saved.actualValue : preview.actualValue;
    const targetValue = saved ? saved.targetValueSnapshot : preview.targetValue;
    const unit = saved ? saved.unitSnapshot : preview.unit;
    const healthStatus = saved ? saved.healthStatus : preview.healthStatus;
    const completion = saved
      ? saved.completionPercent
      : preview.completionPercent;
    const origin = this.config.get<string>('DINGTALK_BOT_HRM_URL')!.replace(/\/$/, '');
    const detailUrl = preview.state === 'saved'
      ? `${origin}/action-items?indicatorId=${encodeURIComponent(saved?.indicatorId ?? preview.indicatorId ?? '')}`
      : `${origin}/ai-progress/confirm/${encodeURIComponent(preview.draftId)}`;
    return {
      actions: canSave
        ? ['修改', '保存进展']
        : preview.state === 'saved'
          ? ['查看进展']
          : ['修改'],
      params: {
        state: preview.state === 'saved' ? '已保存' : '待保存进展',
        goal: goal?.title ?? '请选择目标和月份',
        month: goal?.periodKey ?? '',
        content,
        actualValue: actualValue == null ? '' : String(actualValue),
        targetValue: targetValue == null ? '' : String(targetValue),
        unit: unit ?? '',
        healthStatus:
          (
            {
              on_track: '正常',
              at_risk: '有风险',
              blocked: '受阻',
              completed: '已完成',
            } as Record<string, string>
          )[healthStatus ?? ''] ?? '',
        completion:
          completion == null
            ? ''
            : `${completion}%${completion > 100 ? '（超额完成）' : ''}`,
        canSave: String(canSave),
        editLabel: preview.state === 'saved' ? '查看进展' : '修改',
        saveLabel: '保存进展',
        saveAction: 'save',
        editUrl: detailUrl,
        detailUrl,
      },
    };
  }

  async sendPreview(preview: DraftPreview, sender: BotSender) {
    if (!(await this.allowedRecipient(sender))) return;
    await this.sendOnce(sender, `preview:${preview.draftId}`, () =>
      this.request('/card/instances/createAndDeliver', 'POST', {
        cardTemplateId: this.config.get('DINGTALK_BOT_CARD_TEMPLATE_ID'),
        outTrackId: preview.draftId,
        cardData: { cardParamMap: this.previewCard(preview).params },
        callbackType: 'STREAM',
        userIdType: 1,
        openSpaceId: `dtv1.card//IM_ROBOT.${sender.senderStaffId}`,
        imRobotOpenSpaceModel: { supportForward: false },
        imRobotOpenDeliverModel: {
          spaceType: 'IM_ROBOT',
          robotCode: this.config.get('DINGTALK_BOT_APP_KEY'),
        },
      }, sender),
    );
  }

  async sendBusinessReply(text: string, sender: BotSender) {
    if (!(await this.allowedRecipient(sender))) return;
    await this.sendOnce(sender, `reply:${sender.deliveryId}`, () =>
      this.request('/robot/oToMessages/batchSend', 'POST', {
        robotCode: this.config.get('DINGTALK_BOT_APP_KEY'),
        userIds: [sender.senderStaffId],
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content: text }),
      }, sender),
    );
  }

  async sendPerformanceCard(card: PerformanceCard, sender: BotSender) {
    if (!(await this.allowedRecipient(sender))) return;
    const origin = new URL(this.config.get<string>("DINGTALK_BOT_HRM_URL")!)
      .origin;
    for (const key of ["primaryUrl", "secondaryUrl"]) {
      if (!card.params[key]) continue;
      const url = new URL(card.params[key]);
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.hash ||
        !/^\/(tasks(?:\/[^/]+(?:\/final-grade|\/periods\/[^/]+)?)?|approval|calibration|improvement-plans(?:\/[^/]+)?)$/.test(
          url.pathname,
        )
      )
        throw new ServiceUnavailableException(
          "绩效入口暂不可用，请进入HRM办理",
        );
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          "performance-card-v1",
          this.config.get("DINGTALK_BOT_APP_KEY"),
          sender.corpId,
          sender.senderStaffId,
          sender.deliveryId,
          card.kind,
          card.subjectKey,
        ]),
      )
      .digest("hex");
    const templateKey = {
      todo: "DINGTALK_BOT_TODO_TEMPLATE_ID",
      goal: "DINGTALK_BOT_GOAL_TEMPLATE_ID",
      evaluation: "DINGTALK_BOT_EVALUATION_TEMPLATE_ID",
      result: "DINGTALK_BOT_RESULT_TEMPLATE_ID",
    }[card.kind];
    const template = this.config.get<string>(templateKey);
    if (!template?.trim() || template.includes("请填写")) {
      const title = {
        todo: "我的绩效待办",
        goal: "绩效目标",
        evaluation: "绩效评价",
        result: "绩效结果",
      }[card.kind];
      await this.sendBusinessReply(
        [
          title,
          card.params.cycleLabel,
          card.params.periodLabel,
          card.params.stateLabel,
          card.params.summary,
          `${card.params.primaryText}：${card.params.primaryUrl}`,
          "以上为查询时状态，打开页面查看最新进度。",
        ]
          .filter(Boolean)
          .join("\n"),
        { ...sender, deliveryId: `${sender.deliveryId}:${key}` },
      );
      return;
    }
    await this.sendOnce(sender, `performance:${key}`, () =>
      this.request("/card/instances/createAndDeliver", "POST", {
        cardTemplateId: template,
        outTrackId: key,
        cardData: { cardParamMap: card.params },
        callbackType: "STREAM",
        userIdType: 1,
        openSpaceId: `dtv1.card//IM_ROBOT.${sender.senderStaffId}`,
        imRobotOpenSpaceModel: { supportForward: false },
        imRobotOpenDeliverModel: {
          spaceType: "IM_ROBOT",
          robotCode: this.config.get("DINGTALK_BOT_APP_KEY"),
        },
      }, sender),
    );
  }

  savedCardParams(draft: ProgressDraft, saved: SavedProgress) {
    return this.previewCard({
      ...draft,
      kind: 'draft',
      state: 'saved',
      canSave: false,
      saved,
      targetValue: null,
      unit: null,
      completionPercent: null,
      progress: null,
    }).params;
  }

  async markSaved(draftId: string, saved: SavedProgress) {
    if (!(await this.isEnabled())) return;
    const draft = await this.drafts.get(draftId);
    if (!draft || !(await this.allowedRecipient(draft.sender))) return;
    await this.request('/card/instances', 'PUT', {
      outTrackId: draftId,
      cardData: {
        cardParamMap: this.savedCardParams(draft, saved),
      },
      cardUpdateOptions: { updateCardDataByKey: true },
    }, draft.sender);
  }

  private async allowedRecipient(sender: BotSender) {
    try {
      return (await this.isEnabled()) &&
        (await this.eligibility.resolveIdentity(sender)).kind === 'ready';
    } catch {
      // No error tip may bypass recipient admission, including an identity/config outage.
      return false;
    }
  }

  private async sendOnce(
    sender: BotSender,
    deliveryId: string,
    send: () => Promise<boolean>,
  ) {
    const delivery = { ...sender, deliveryId: `bot-outbound:${deliveryId}` };
    const token = randomUUID();
    // shortcut: a crash before send can suppress this reply for 24h; add a durable outbox if automatic recovery is required.
    if ((await this.drafts.claimDelivery(delivery, token)) !== token) return;
    try {
      if (!(await send())) await this.drafts.releaseDelivery(delivery, token);
    } catch (error) {
      await this.drafts.releaseDelivery(delivery, token);
      throw error;
    }
  }

  private async request(path: string, method: string, body: object, sender: BotSender) {
    try {
      return await withDingtalkDeadline(async (signal) => {
        const token = await this.dingtalkBot.getAccessToken(signal);
        signal.throwIfAborted();
        // Redis/token waits may outlive an allowlist change. Recheck at the actual dispatch boundary.
        if (!(await this.allowedRecipient(sender))) return false;
        signal.throwIfAborted();
        const response = await fetch(`https://api.dingtalk.com/v1.0${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          body: JSON.stringify(body),
          signal,
          redirect: 'error',
        });
        const data = (await response.json()) as {
          success?: boolean;
          code?: string;
          result?:
            | boolean
            | {
                outTrackId?: string;
                deliverResults?: Array<{ success?: boolean }>;
              };
          flowControlledStaffIdList?: string[];
          invalidStaffIdList?: string[];
          filteredStaffIdList?: string[];
        };
        signal.throwIfAborted();
        if (
          !response.ok ||
          data.success === false ||
          data.code ||
          data.flowControlledStaffIdList?.length ||
          data.invalidStaffIdList?.length ||
          data.filteredStaffIdList?.length
        )
          throw new Error();
        if (path === '/card/instances/createAndDeliver') {
          const result = data.result;
          if (
            data.success !== true ||
            !result ||
            typeof result !== 'object' ||
            result.outTrackId !== (body as { outTrackId: string }).outTrackId ||
            !Array.isArray(result.deliverResults) ||
            result.deliverResults.length !== 1 ||
            result.deliverResults.some((item) => item.success !== true)
          )
            throw new Error();
        } else if (
          path === '/card/instances' &&
          (data.success !== true || data.result !== true)
        ) {
          throw new Error();
        }
        return true;
      });
    } catch {
      throw new ServiceUnavailableException('钉钉消息暂未送达，请稍后重试');
    }
  }
}
