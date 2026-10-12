import { ConflictException, GoneException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { BotSender } from './bot-eligibility.service';
import { BotGoalCandidate } from '../objectives/bot-goal-access.types';
import { ProgressCandidate } from './recognition.types';

export interface ProgressDraft extends ProgressCandidate {
  draftId: string;
  ownerId: string;
  sender: BotSender;
  goals: BotGoalCandidate[];
  periodId: string | null;
  provider: string;
  configVersion: number;
  expiresAt: string;
}

const TTL = 86400;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

@Injectable()
export class ProgressDraftStore implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  private client() {
    if (!this.redis) {
      const url = this.config.get<string>('REDIS_URL');
      if (!url) throw new ServiceUnavailableException('草稿服务暂不可用，请稍后重试');
      this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000, commandTimeout: 5000 });
      // ioredis errors may contain connection credentials; propagate only safe business errors.
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  private async run<T>(operation: (redis: Redis) => Promise<T>): Promise<T> {
    try { return await operation(this.client()); }
    catch { throw new ServiceUnavailableException('草稿服务暂不可用，请稍后重试'); }
  }

  onModuleDestroy() { this.redis?.disconnect(); }

  async get(id: string): Promise<ProgressDraft | null> {
    const value = await this.run(redis => redis.get(`ai-progress:draft:${id}`));
    return value ? JSON.parse(value) : null;
  }

  async create(draft: ProgressDraft) {
    const created = await this.run(redis => redis.set(`ai-progress:draft:${draft.draftId}`, JSON.stringify(draft), 'EX', TTL, 'NX'));
    if (!created) throw new ConflictException('草稿已存在，请重新发送');
  }

  async update(draft: ProgressDraft) {
    const updated = await this.run(redis => redis.set(`ai-progress:draft:${draft.draftId}`, JSON.stringify(draft), 'KEEPTTL', 'XX'));
    if (!updated) throw new GoneException('草稿已过期，请重新发送进展');
  }

  deliveryKey(sender: BotSender) {
    return `ai-progress:delivery:${createHash('sha256').update(JSON.stringify([sender.corpId, sender.deliveryId])).digest('hex')}`;
  }

  async claimDelivery(sender: BotSender, draftId: string): Promise<string> {
    const key = this.deliveryKey(sender);
    const created = await this.run(redis => redis.set(key, draftId, 'EX', TTL, 'NX'));
    if (created) return draftId;
    const existing = await this.run(redis => redis.get(key));
    if (!existing) throw new ConflictException('消息正在处理中，请稍后重试');
    return existing;
  }

  async releaseDelivery(sender: BotSender, draftId: string) {
    await this.run(redis => redis.eval(RELEASE, 1, this.deliveryKey(sender), draftId));
  }

  async withDraftLock<T>(draftId: string, operation: () => Promise<T>): Promise<T> {
    const key = `ai-progress:lock:${draftId}`;
    const token = randomUUID();
    const claimed = await this.run(redis => redis.set(key, token, 'EX', 60, 'NX'));
    if (!claimed) throw new ConflictException('进展正在处理中，请稍后重试');
    try { return await operation(); }
    finally {
      // A committed database save remains successful even if releasing this expiring lock fails.
      await this.run(redis => redis.eval(RELEASE, 1, key, token)).catch(() => undefined);
    }
  }
}
