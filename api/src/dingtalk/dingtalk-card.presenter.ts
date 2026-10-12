import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AiConfigService } from '../ai-progress/ai-config.service';
import { BotSender } from '../ai-progress/bot-eligibility.service';
import { ProgressDraftStore } from '../ai-progress/progress-draft.store';
import { ProgressPreview } from '../ai-progress/recognition.types';
import { DingtalkService } from './dingtalk.service';

type DraftPreview = Extract<ProgressPreview, { kind: 'draft' }>;

@Injectable()
export class DingtalkCardPresenter {
  constructor(
    private readonly config: ConfigService,
    private readonly aiConfig: AiConfigService,
    private readonly dingtalk: DingtalkService,
    private readonly drafts: ProgressDraftStore,
  ) {}

  async isEnabled() {
    if (
      this.config.get('DINGTALK_BOT_STREAM_ENABLED') !== 'true' ||
      this.config.get('DINGTALK_BOT_PREFLIGHT_CONFIRMED') !== 'true'
    )
      return false;
    for (const key of [
      'DINGTALK_APP_KEY',
      'DINGTALK_APP_SECRET',
      'DINGTALK_CORP_ID',
      'DINGTALK_STREAM_APP_ID',
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
    const goal = preview.goals.find(
      (item) =>
        item.id === preview.indicatorId && item.periodId === preview.periodId,
    );
    const canSave =
      preview.canSave &&
      !preview.uncertain &&
      !!goal &&
      preview.state === 'pending';
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
        content: preview.content,
        actualValue: preview.actualValue ?? '',
        targetValue: preview.targetValue ?? '',
        unit: preview.unit ?? '',
        healthStatus:
          (
            {
              on_track: '正常',
              at_risk: '有风险',
              blocked: '受阻',
              completed: '已完成',
            } as Record<string, string>
          )[preview.healthStatus ?? ''] ?? '',
        completion:
          preview.completionPercent === null
            ? ''
            : `${preview.completionPercent}%${preview.completionPercent > 100 ? '（超额完成）' : ''}`,
        canSave: String(canSave),
        editLabel: '修改',
        saveLabel: '保存进展',
        saveAction: 'save',
        editUrl: `${this.config.get<string>('DINGTALK_BOT_HRM_URL')!.replace(/\/$/, '')}/ai-progress/confirm/${encodeURIComponent(preview.draftId)}`,
        detailUrl: `${this.config.get<string>('DINGTALK_BOT_HRM_URL')!.replace(/\/$/, '')}/ai-progress/confirm/${encodeURIComponent(preview.draftId)}`,
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
          robotCode: this.config.get('DINGTALK_APP_KEY'),
        },
      }),
    );
  }

  async sendBusinessReply(text: string, sender: BotSender) {
    if (!(await this.allowedRecipient(sender))) return;
    await this.sendOnce(sender, `reply:${sender.deliveryId}`, () =>
      this.request('/robot/oToMessages/batchSend', 'POST', {
        robotCode: this.config.get('DINGTALK_APP_KEY'),
        userIds: [sender.senderStaffId],
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content: text }),
      }),
    );
  }

  async markSaved(draftId: string) {
    if (!(await this.isEnabled())) return;
    await this.request('/card/instances', 'PUT', {
      outTrackId: draftId,
      cardData: {
        cardParamMap: {
          state: '已保存',
          canSave: 'false',
          editLabel: '查看进展',
        },
      },
      cardUpdateOptions: { updateCardDataByKey: true },
    });
  }

  private async allowedRecipient(sender: BotSender) {
    return (
      sender.corpId === this.config.get('DINGTALK_CORP_ID') &&
      sender.conversationType === '1' &&
      !!sender.senderStaffId?.trim() &&
      !!sender.conversationId?.trim() &&
      (await this.isEnabled())
    );
  }

  private async sendOnce(
    sender: BotSender,
    deliveryId: string,
    send: () => Promise<void>,
  ) {
    const delivery = { ...sender, deliveryId: `bot-outbound:${deliveryId}` };
    const token = randomUUID();
    // shortcut: a crash before send can suppress this reply for 24h; add a durable outbox if automatic recovery is required.
    if ((await this.drafts.claimDelivery(delivery, token)) !== token) return;
    try {
      await send();
    } catch (error) {
      await this.drafts.releaseDelivery(delivery, token);
      throw error;
    }
  }

  private async request(path: string, method: string, body: object) {
    try {
      const token = await this.dingtalk.getAccessToken();
      const response = await fetch(`https://api.dingtalk.com/v1.0${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      const data = (await response.json()) as {
        success?: boolean;
        code?: string;
        result?: Array<{ success?: boolean }>;
        flowControlledStaffIdList?: string[];
        invalidStaffIdList?: string[];
        filteredStaffIdList?: string[];
      };
      if (
        !response.ok ||
        data.success === false ||
        data.code ||
        data.flowControlledStaffIdList?.length ||
        data.invalidStaffIdList?.length ||
        data.filteredStaffIdList?.length ||
        (Array.isArray(data.result) &&
          data.result.some((item) => item.success === false))
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException('钉钉消息暂未送达，请稍后重试');
    }
  }
}
