import { Injectable } from '@nestjs/common';

/** 推送 provider 注入令牌（#06 钉钉实现将覆盖此 token）。 */
export const MESSAGE_PUSH_PROVIDER = Symbol('MESSAGE_PUSH_PROVIDER');

/** 单条推送入参。 */
export interface MessagePushInput {
  /** 接收人本地用户 id。 */
  userId: string;
  /** 接收人钉钉 userid（可能为空）。 */
  dingtalkId: string | null;
  /** 消息标题。 */
  title: string;
  /** 消息正文。 */
  content: string;
  /** 业务通知类型，用于执行周期通知策略。 */
  type: string;
  /** 所属绩效周期；为空时不允许通过周期通知通道外发。 */
  cycleId: string | null;
  /**
   * 本地通知记录 id。
   * Provider 可据此回写发送结果；未传时由调用方自行处理状态。
   */
  notificationId?: string;
  /** 钉钉工作通知跳转链接（可选）。 */
  url?: string;
}

/** 推送结果。 */
export interface MessagePushResult {
  /** 发送渠道标识。 */
  channel: string;
  /** 渠道侧消息/任务 id（可选）。 */
  externalId?: string;
}

/** 消息推送端口：解耦日志/限频与实际发送渠道。 */
export interface MessagePushProvider {
  push(input: MessagePushInput): Promise<MessagePushResult>;
}

/** 默认 stub：不真发，返回 system 渠道，便于联调。 */
@Injectable()
export class StubPushProvider implements MessagePushProvider {
  async push(): Promise<MessagePushResult> {
    return { channel: 'system' };
  }
}
