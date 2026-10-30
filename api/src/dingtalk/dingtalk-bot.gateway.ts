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
import { ArchiveAssistantService } from '../employee-archives/archive-assistant.service';
import { AiProgressService } from '../ai-progress/ai-progress.service';
import {
  BotEligibilityService,
  BotSender,
} from '../ai-progress/bot-eligibility.service';
import { ProgressDraftStore } from '../ai-progress/progress-draft.store';
import { DingtalkCardPresenter } from './dingtalk-card.presenter';
import { PerformanceCardService } from './performance-card.service';

@Injectable()
export class DingtalkBotGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DingtalkBotGateway.name);
  private client?: DWClient;
  private pending?: { client: DWClient; timer: NodeJS.Timeout };
  private syncing = false;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly eligibility: BotEligibilityService,
    private readonly progress: AiProgressService,
    private readonly drafts: ProgressDraftStore,
    private readonly cards: DingtalkCardPresenter,
    private readonly performance: PerformanceCardService,
    private readonly archives: ArchiveAssistantService,
  ) {}

  onModuleInit() {
    void this.syncConnection();
  }
  onModuleDestroy() {
    this.stopped = true;
    this.retire(this.client ?? this.pending?.client);
  }

  @Interval(30000)
  async syncConnection() {
    if (this.stopped || this.syncing) return;
    this.syncing = true;
    try {
      if (!(await this.cards.isEnabled()) || this.stopped) {
        this.retire(this.client ?? this.pending?.client);
        return;
      }
      // The stable SDK cannot cancel endpoint HTTP requests: retain at most one until settlement.
      if (this.pending || this.client?.connected) return;
      this.retire(this.client);
      {
        const client = new DWClient({
          clientId: this.config.get<string>('DINGTALK_BOT_APP_KEY')!,
          clientSecret: this.config.get<string>('DINGTALK_BOT_APP_SECRET')!,
          debug: false,
          keepAlive: false,
        });
        // Reconnection is governed by the current enable state; do not subscribe to unrelated EVENTs.
        client.config.autoReconnect = false;
        client.config.subscriptions = [];
        // connect() calls this public hook after endpoint discovery and resets its disconnect flag.
        const openSocket = client._connect.bind(client);
        client._connect = () =>
          this.client === client && !this.stopped
            ? openSocket()
            : Promise.resolve();
        client.registerCallbackListener(TOPIC_ROBOT, (event) =>
          this.onMessage(event, client),
        );
        client.registerCallbackListener(TOPIC_CARD, (event) =>
          this.onCard(event, client),
        );
        this.client = client;
        const timer = setTimeout(() => {
          this.retire(client);
          this.logger.warn('钉钉进展助手连接超时');
        }, 10000);
        timer.unref();
        this.pending = { client, timer };
        void Promise.resolve()
          .then(() => {
            if (this.client === client && !this.stopped) return client.connect();
          })
          .catch(() => {
            this.logger.warn('钉钉进展助手连接暂不可用');
            this.retire(client);
          })
          .finally(() => {
            clearTimeout(timer);
            if (this.client !== client || this.stopped || !client.connected)
              this.retire(client);
            if (this.pending?.client === client) this.pending = undefined;
          });
      }
    } catch {
      this.logger.warn('钉钉进展助手连接暂不可用');
    } finally {
      this.syncing = false;
    }
  }

  private retire(client?: DWClient) {
    if (!client) return;
    if (this.client === client) this.client = undefined;
    if (this.pending?.client === client) clearTimeout(this.pending.timer);
    client.removeAllListeners();
    try {
      client.disconnect();
    } catch {
      this.logger.warn('钉钉旧连接关闭暂未完成');
    }
  }

  private async validFrame(
    event: DWClientDownStream,
    topic: string,
    client: DWClient,
  ) {
    const enabled = await this.cards.isEnabled();
    return (
      this.client === client &&
      !this.stopped &&
      event.type === 'CALLBACK' &&
      event.headers?.topic === topic &&
      event.headers.appId === this.config.get('DINGTALK_BOT_STREAM_APP_ID') &&
      !!event.headers.messageId?.trim() &&
      typeof event.data === 'string' &&
      event.data.length <= 100000 &&
      enabled
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
        body.robotCode !== this.config.get('DINGTALK_BOT_APP_KEY') ||
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
      // Admission precedes every user-visible reply, including invalid-input and error tips.
      const identity = await this.eligibility.resolveIdentity(sender);
      if (identity.kind !== 'ready') return;
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
      const command = body.text.content.trim();
      if (command.startsWith('档案测试') || command.startsWith('档案帮助')) {
        if (command !== '档案测试' && command !== '档案帮助') {
          await this.cards.sendBusinessReply('请仅发送“档案测试”或“档案帮助”，不要附带人员资料；本次试用只提供虚构样例。', sender);
          return;
        }
        try {
          // prepare revalidates the single pilot, live capability, gate and binding without writes.
          const preview = await this.archives.prepare(identity.viewer, sender);
          const origin = new URL(this.config.get<string>('DINGTALK_BOT_HRM_URL') ?? '');
          if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
            throw new Error('Invalid HRM origin');
          const url = new URL(preview.url, origin.origin);
          if (url.origin !== origin.origin || !url.pathname.startsWith('/archive-assistant/preview/'))
            throw new Error('Invalid preview path');
          await this.cards.sendBusinessReply(command === '档案帮助'
            ? '档案助手仅供本人使用虚构样例试用。发送“档案测试”获取预览；预览不会保存，需本人登录HRM后点击“保存待核草稿”。测试草稿不能提交或审批。'
            : `虚构测试资料已准备，尚未保存。请登录本人HRM账号核对，点击“保存待核草稿”后才会接收：${url.href}`, sender);
        } catch {
          await this.cards.sendBusinessReply('档案助手试用暂不可用，请核对本人账号及试用权限后重新发送“档案测试”。', sender);
        }
        return;
      }
      try {
        const response = await this.performance.query(
          body.text.content,
          sender,
        );
        if (response) {
          if (response.kind === "reply")
            await this.cards.sendBusinessReply(response.text, sender);
          else {
            for (const card of response.cards)
              await this.cards.sendPerformanceCard(card, sender);
            if (response.text)
              await this.cards.sendBusinessReply(response.text, sender);
          }
          return;
        }
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
    let recipient: { corpId: string; staffId: string } | undefined;
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
      if ((await this.eligibility.resolveRecipient(body.corpId, body.userId)).kind !== 'ready') return;
      recipient = { corpId: body.corpId, staffId: body.userId };
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
      const saved = await this.progress.saveDraft(
        body.outTrackId,
        identity.viewer.id,
        sender.conversationId,
      );
      result = {
        cardUpdateOptions: { updateCardDataByKey: true },
        cardData: {
          cardParamMap: this.cards.savedCardParams(draft, saved),
        },
      };
      try {
        await this.cards.markSaved(body.outTrackId, saved);
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
      // A protocol ACK is not a message. Only admitted recipients may get card/error content,
      // and admission must still hold after the save or an expired-draft lookup.
      if (Object.keys(result).length) {
        try {
          if (!recipient || !(await this.cards.isEnabled()) ||
            (await this.eligibility.resolveRecipient(recipient.corpId, recipient.staffId)).kind !== 'ready') {
            result = {};
          }
        } catch {
          result = {};
        }
      }
      this.ack(client, event, result);
    }
  }

  private ack(client: DWClient, event: DWClientDownStream, result: object) {
    if (this.client !== client || this.stopped || !event.headers?.messageId)
      return;
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
