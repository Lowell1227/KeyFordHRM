import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  DWClient,
  DWClientDownStream,
  TOPIC_CARD,
  TOPIC_ROBOT,
} from 'dingtalk-stream';
import { AiProgressService } from '../ai-progress/ai-progress.service';
import {
  BotEligibilityService,
  BotSender,
} from '../ai-progress/bot-eligibility.service';
import { ProgressDraftStore } from '../ai-progress/progress-draft.store';
import { DingtalkCardPresenter } from './dingtalk-card.presenter';

@Injectable()
export class DingtalkBotGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DingtalkBotGateway.name);
  private client?: DWClient;
  private syncing = false;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly eligibility: BotEligibilityService,
    private readonly progress: AiProgressService,
    private readonly drafts: ProgressDraftStore,
    private readonly cards: DingtalkCardPresenter,
  ) {}

  async onModuleInit() {
    await this.syncConnection();
  }
  onModuleDestroy() {
    this.stopped = true;
    this.client?.disconnect();
    this.client = undefined;
  }

  @Interval(30000)
  async syncConnection() {
    if (this.stopped || this.syncing) return;
    this.syncing = true;
    try {
      if (!(await this.cards.isEnabled())) {
        this.client?.disconnect();
        this.client = undefined;
        return;
      }
      if (!this.client) {
        const client = new DWClient({
          clientId: this.config.get<string>('DINGTALK_APP_KEY')!,
          clientSecret: this.config.get<string>('DINGTALK_APP_SECRET')!,
          debug: false,
          keepAlive: false,
        });
        // Reconnection is governed by the current enable state; do not subscribe to unrelated EVENTs.
        client.config.autoReconnect = false;
        client.config.subscriptions = [];
        client.registerCallbackListener(TOPIC_ROBOT, (event) =>
          this.onMessage(event, client),
        );
        client.registerCallbackListener(TOPIC_CARD, (event) =>
          this.onCard(event, client),
        );
        this.client = client;
      }
      if (!this.client.connected) await this.client.connect();
    } catch {
      this.logger.warn('钉钉进展助手连接暂不可用');
    } finally {
      this.syncing = false;
    }
  }

  private async validFrame(
    event: DWClientDownStream,
    topic: string,
    client: DWClient,
  ) {
    return (
      this.client === client &&
      !this.stopped &&
      event.type === 'CALLBACK' &&
      event.headers?.topic === topic &&
      event.headers.appId === this.config.get('DINGTALK_STREAM_APP_ID') &&
      !!event.headers.messageId?.trim() &&
      typeof event.data === 'string' &&
      event.data.length <= 100000 &&
      (await this.cards.isEnabled())
    );
  }

  private async onMessage(event: DWClientDownStream, client: DWClient) {
    try {
      if (!(await this.validFrame(event, TOPIC_ROBOT, client))) return;
      const body = JSON.parse(event.data);
      const corp = this.config.get('DINGTALK_CORP_ID');
      if (
        body.chatbotCorpId !== corp ||
        body.senderCorpId !== corp ||
        body.robotCode !== this.config.get('DINGTALK_APP_KEY') ||
        body.conversationType !== '1' ||
        !this.nonempty(body.senderStaffId) ||
        !this.nonempty(body.conversationId) ||
        !this.nonempty(body.msgId)
      )
        return;
      const sender: BotSender = {
        corpId: corp,
        senderStaffId: body.senderStaffId,
        conversationId: body.conversationId,
        conversationType: '1',
        deliveryId: body.msgId,
      };
      if (
        body.msgtype !== 'text' ||
        !this.nonempty(body.text?.content) ||
        body.text.content.length > 10000
      ) {
        await this.cards.sendBusinessReply(
          '请发送一条文字进展，最多10000字。',
          sender,
        );
        return;
      }
      try {
        const preview = await this.progress.prepare(body.text.content, sender);
        if (preview.kind === 'reply')
          await this.cards.sendBusinessReply(preview.text, sender);
        else await this.cards.sendPreview(preview, sender);
      } catch {
        await this.cards.sendBusinessReply(
          `进展助手暂不可用，请在HRM目标跟进中手动更新：${this.config.get('DINGTALK_BOT_HRM_URL')}`,
          sender,
        );
      }
    } catch {
      this.logger.warn('钉钉进展消息处理失败');
    } finally {
      this.ack(client, event, {});
    }
  }

  private async onCard(event: DWClientDownStream, client: DWClient) {
    let result: object = {};
    try {
      if (!(await this.validFrame(event, TOPIC_CARD, client))) return;
      const body = JSON.parse(event.data);
      if (
        body.corpId !== this.config.get('DINGTALK_CORP_ID') ||
        body.type !== 'actionCallback' ||
        body.userIdType !== 1 ||
        !this.nonempty(body.userId) ||
        body.spaceType !== 'IM_ROBOT' ||
        body.spaceId !== body.userId ||
        typeof body.outTrackId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.outTrackId,
        )
      )
        throw new ForbiddenException('请在本人机器人单聊中重新发送进展');
      const content = JSON.parse(body.content);
      if (content?.cardPrivateData?.params?.action !== 'save') return;
      const draft = await this.drafts.get(body.outTrackId);
      if (!draft) throw new GoneException('草稿已过期，请重新发送进展');
      if (
        draft.sender.corpId !== body.corpId ||
        draft.sender.senderStaffId !== body.userId ||
        draft.sender.conversationType !== '1'
      )
        throw new ForbiddenException('只能保存本人会话中的进展，请重新发送');
      // IM_ROBOT callbacks identify the user-space, not the original cid. Map only after verifying that space and clicker.
      const sender: BotSender = {
        corpId: body.corpId,
        senderStaffId: body.userId,
        conversationType: '1',
        conversationId: draft.sender.conversationId,
        deliveryId: event.headers.messageId,
      };
      const identity = await this.eligibility.resolveIdentity(sender);
      if (identity.kind !== 'ready')
        throw new ForbiddenException(identity.text);
      await this.progress.saveDraft(
        body.outTrackId,
        identity.viewer.id,
        sender.conversationId,
      );
      result = {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: {
            state: '已保存',
            canSave: 'false',
            editLabel: '查看进展',
          },
        },
      };
      try {
        await this.cards.markSaved(body.outTrackId);
      } catch {
        this.logger.warn('进展已保存，钉钉卡片刷新暂未完成');
      }
    } catch (error) {
      const text =
        error instanceof ForbiddenException ||
        error instanceof GoneException ||
        error instanceof ConflictException
          ? error.message
          : '操作暂未完成，请稍后重试或进入HRM目标跟进查看';
      result = {
        cardUpdateOptions: { updatePrivateDataByKey: true },
        userPrivateData: { cardParamMap: { notice: text } },
      };
    } finally {
      this.ack(client, event, result);
    }
  }

  private ack(client: DWClient, event: DWClientDownStream, result: object) {
    if (!event.headers?.messageId) return;
    try {
      client.send(event.headers.messageId, result);
    } catch {
      this.logger.warn('钉钉回执暂未送达');
    }
  }

  private nonempty(value: unknown): value is string {
    return typeof value === 'string' && !!value.trim();
  }
}
