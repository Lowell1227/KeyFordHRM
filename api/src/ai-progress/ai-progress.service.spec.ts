import { BadRequestException, ConflictException, ForbiddenException, GoneException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { AiProgressController } from './ai-progress.controller';
import { AiProgressService } from './ai-progress.service';
import { ProgressDraftStore } from './progress-draft.store';
import { BotEligibilityService, BotSender } from './bot-eligibility.service';
import { DingtalkCardPresenter } from '../dingtalk/dingtalk-card.presenter';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));
import Redis from 'ioredis';

const sender: BotSender = { corpId: 'corp', senderStaffId: 'staff', conversationId: 'chat', conversationType: '1', deliveryId: 'delivery' };
const goal = { id: 'goal', title: '客户拜访', targetValue: '10', unit: '家', periodId: 'oct', periodKey: '2026-10' };
const candidate = { indicatorId: 'goal', content: '完成12家', actualValue: '12', healthStatus: null, uncertain: false };

function setup() {
  const entries = new Map<string, { value: string; expires: number }>();
  let now = Date.now();
  const get = async (key: string) => {
    const row = entries.get(key);
    if (!row || row.expires <= now) { entries.delete(key); return null; }
    return row.value;
  };
  const redis = {
    get: jest.fn(get),
    set: jest.fn(async (key: string, value: string, ...args: any[]) => {
      const old = await get(key);
      if (args.includes('NX') && old !== null || args.includes('XX') && old === null) return null;
      const expires = args.includes('KEEPTTL') ? entries.get(key)!.expires : now + args[args.indexOf('EX') + 1] * 1000;
      entries.set(key, { value, expires });
      return 'OK';
    }),
    eval: jest.fn(async (_script, _count, key, value) => {
      if (await get(key) !== value) return 0;
      entries.delete(key); return 1;
    }),
    on: jest.fn(), disconnect: jest.fn(),
  };
  (Redis as unknown as jest.Mock).mockImplementation(() => redis);
  const store = new ProgressDraftStore(new ConfigService({ REDIS_URL: 'redis://fixture.invalid' }));
  const identity = { kind: 'ready', viewer: { id: 'owner', name: 'Owner' } };
  const eligibility = { resolve: jest.fn().mockResolvedValue({ ...identity, goals: [goal] }), resolveIdentity: jest.fn().mockResolvedValue(identity) };
  const config = { getActiveRuntimeConfig: jest.fn().mockResolvedValue({ provider: 'kimi', modelId: 'kimi-k2', apiKey: 'test-only', configVersion: 2 }) };
  const provider = { recognize: jest.fn().mockResolvedValue(candidate) };
  let saved: any = null;
  const objectives = {
    findAiDraftProgress: jest.fn(async () => saved),
    findBotGoalAccess: jest.fn().mockResolvedValue({ kind: 'ready', goals: [goal] }),
    updateIndicatorProgress: jest.fn(async (id, input, viewer, options) => {
      saved = { id: 'saved', indicatorId: id, content: input.content, createdBy: viewer.id };
      return saved;
    }),
  };
  const service = new AiProgressService(store, eligibility as any, config as any, provider as any, objectives as any);
  return { service, store, redis, entries, eligibility, provider, config, objectives, advance: (ms: number) => { now += ms; } };
}

describe('AiProgressService draft confirmation', () => {
  it('releases the draft lock after a pending owner-detail revalidation times out without a save', async () => {
    jest.useFakeTimers();
    try {
      const { service, objectives, redis } = setup();
      const { draftId }: any = await service.prepare('完成12家', sender);
      const eligibility = new BotEligibilityService(
        { externalIdentityBinding: { findFirst: async () => null } } as any,
        new ConfigService({ DINGTALK_CORP_ID: 'corp' }),
        { getPublicState: async () => ({ botEnabled: true, allowlist: ['owner'] }) } as any,
        {} as any, { fetchUserDetail: () => new Promise(() => undefined) } as any, objectives as any,
      );
      (service as any).eligibility = eligibility;
      let outcome: unknown;
      const pending = service.saveDraft(draftId, 'owner').catch(error => { outcome = error; });
      await jest.advanceTimersByTimeAsync(10001);
      expect(outcome).toBeInstanceOf(ForbiddenException);
      expect((outcome as Error).message).toContain('稍后重试');
      expect(await redis.get(`ai-progress:lock:${draftId}`)).toBeNull();
      expect(objectives.updateIndicatorProgress).not.toHaveBeenCalled();
      await pending;
    } finally { jest.useRealTimers(); }
  });
  it('prepares only Redis state for 24 hours and deduplicates deliveries without another provider call', async () => {
    const { service, store, entries, provider, objectives, redis } = setup();
    const preview: any = await service.prepare('完成12家', sender);
    expect(preview).toMatchObject({ kind: 'draft', canSave: true, indicatorId: 'goal', periodId: 'oct', completionPercent: 120, progress: 100 });
    expect(objectives.updateIndicatorProgress).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(`ai-progress:draft:${preview.draftId}`, expect.any(String), 'EX', 86400, 'NX');
    expect(await service.prepare('完成12家', sender)).toEqual(preview);
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    const raw: any = await store.get(preview.draftId);
    expect(raw).toMatchObject({ ownerId: 'owner', sender, provider: 'kimi', configVersion: 2, goals: [goal] });
    expect(JSON.stringify([...entries.values()])).not.toContain('test-only');
  });

  it('requires explicit month selection when the same indicator has two writable periods', async () => {
    const { service, eligibility, provider, objectives } = setup();
    const sep = { ...goal, periodId: 'sep', periodKey: '2026-09' };
    eligibility.resolve.mockResolvedValue({ kind: 'ready', viewer: { id: 'owner', name: 'Owner' }, goals: [sep, goal] });
    objectives.findBotGoalAccess.mockResolvedValue({ kind: 'ready', goals: [sep, goal] });
    const preview: any = await service.prepare('完成12家', sender);
    expect(preview.canSave).toBe(false);
    expect(preview.periodId).toBeNull();
    expect(preview.goals).toEqual([sep, goal]);
    expect(provider.recognize.mock.calls[0][0].goals).toHaveLength(1);
    await expect(service.saveDraft(preview.draftId, 'owner')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateDraft(preview.draftId, 'owner', { indicatorId: 'goal' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateDraft(preview.draftId, 'owner', { indicatorId: 'goal', periodId: 'foreign' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.updateDraft(preview.draftId, 'owner', { indicatorId: 'goal', periodId: 'sep' })).toMatchObject({ canSave: true, periodId: 'sep' });
    await service.saveDraft(preview.draftId, 'owner');
    expect(objectives.updateIndicatorProgress).toHaveBeenCalledWith('goal', expect.objectContaining({ periodId: 'sep', actualValue: '12', progress: null }), expect.objectContaining({ id: 'owner' }), { aiDraftId: preview.draftId, aiAssisted: true });
  });

  it('rejects expired, foreign-owner and forwarded-session drafts', async () => {
    const { service, advance, objectives } = setup();
    const { draftId }: any = await service.prepare('完成12家', sender);
    for (const operation of [() => service.getDraft(draftId, 'other'), () => service.updateDraft(draftId, 'other', { content: 'edit' }), () => service.saveDraft(draftId, 'other'), () => service.saveDraft(draftId, 'owner', 'forwarded')]) {
      await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    }
    advance(86400_000);
    await expect(service.saveDraft(draftId, 'owner')).rejects.toBeInstanceOf(GoneException);
    expect(objectives.updateIndicatorProgress).not.toHaveBeenCalled();
  });

  it('does not extend expiry on editing and rejects invalid or server-owned edits', async () => {
    const { service, advance } = setup();
    const { draftId }: any = await service.prepare('完成12家', sender);
    for (const changes of [{ actualValue: '-1' }, { content: ' ' }, { healthStatus: 'fake' }, { progress: 80 }, { targetValue: '999' }, { aiDraftId: 'fake' }, { content: null }]) {
      await expect(service.updateDraft(draftId, 'owner', changes as any)).rejects.toBeInstanceOf(BadRequestException);
    }
    advance(86399_000);
    expect(await service.updateDraft(draftId, 'owner', { actualValue: '11' })).toMatchObject({ completionPercent: 110 });
    advance(1000);
    await expect(service.getDraft(draftId, 'owner')).rejects.toBeInstanceOf(GoneException);
  });

  it('uses existing draft after provider switching, and survives card refresh failure after saving', async () => {
    const { service, config, provider, objectives } = setup();
    const { draftId }: any = await service.prepare('完成12家', sender);
    config.getActiveRuntimeConfig.mockRejectedValue(new Error('new provider unavailable'));
    const saved = await service.saveDraft(draftId, 'owner', 'chat');
    // Card refresh occurs after this return and can fail independently.
    objectives.findBotGoalAccess.mockResolvedValue({ kind: 'month_locked', message: '月份已关闭' } as any);
    expect((await service.saveDraft(draftId, 'owner', 'chat')).id).toBe(saved.id);
    expect(await service.getDraft(draftId, 'owner')).toMatchObject({ state: 'saved', saved: { id: saved.id } });
    expect(objectives.updateIndicatorProgress).toHaveBeenCalledTimes(1);
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    await expect(service.updateDraft(draftId, 'owner', { content: 'overwrite' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechecks identity even on a saved retry and checks latest month for a new write', async () => {
    const { service, eligibility, objectives } = setup();
    const { draftId }: any = await service.prepare('完成12家', sender);
    objectives.findBotGoalAccess.mockResolvedValueOnce({ kind: 'month_locked', message: '月份已关闭' } as any);
    await expect(service.saveDraft(draftId, 'owner')).rejects.toBeInstanceOf(ConflictException);
    expect(objectives.updateIndicatorProgress).not.toHaveBeenCalled();
    await service.saveDraft(draftId, 'owner');
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '账号已停用' } as any);
    await expect(service.saveDraft(draftId, 'owner')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not call AI or create drafts for ineligible senders and does not save on provider failure', async () => {
    const { service, eligibility, entries, provider, objectives } = setup();
    eligibility.resolve.mockResolvedValueOnce({ kind: 'reply', text: '功能暂未开放' } as any);
    expect(await service.prepare('hello', sender)).toEqual({ kind: 'reply', text: '功能暂未开放' });
    expect(entries.size).toBe(0);
    expect(provider.recognize).not.toHaveBeenCalled();
    provider.recognize.mockRejectedValueOnce(new Error('provider failure'));
    await expect(service.prepare('hello', sender)).rejects.toThrow();
    expect(entries.size).toBe(0);
    expect(objectives.updateIndicatorProgress).not.toHaveBeenCalled();
  });

  it('retains qualitative null percentages and requires a human choice for uncertain recognition', async () => {
    const { service, provider } = setup();
    provider.recognize.mockResolvedValue({ ...candidate, indicatorId: null, uncertain: true, actualValue: null } as any);
    const preview: any = await service.prepare('方案已评审', sender);
    expect(preview).toMatchObject({ canSave: false, progress: null, completionPercent: null });
    expect(await service.updateDraft(preview.draftId, 'owner', { indicatorId: 'goal', periodId: 'oct', content: '方案已评审', actualValue: null })).toMatchObject({ canSave: true, progress: null, completionPercent: null, healthStatus: null });
  });

  it('does not repeat recognition while a claimed delivery is in flight', async () => {
    const { service, provider } = setup();
    let finish!: (value: typeof candidate) => void;
    const reached = new Promise<void>(resolve => provider.recognize.mockImplementationOnce(() => {
      resolve(); return new Promise(done => { finish = done; });
    }));
    const preparing = service.prepare('完成12家', sender);
    await reached;
    await expect(service.prepare('完成12家', sender)).rejects.toBeInstanceOf(ConflictException);
    finish(candidate);
    await preparing;
    expect(provider.recognize).toHaveBeenCalledTimes(1);
  });

  it('keeps a committed save successful when releasing the Redis lock fails', async () => {
    const { service, redis, objectives } = setup();
    const { draftId }: any = await service.prepare('完成12家', sender);
    redis.eval.mockRejectedValueOnce(new Error('Redis disconnected'));
    expect(await service.saveDraft(draftId, 'owner')).toMatchObject({ id: 'saved' });
    expect(objectives.updateIndicatorProgress).toHaveBeenCalledTimes(1);
  });
});

describe('Authenticated draft HTTP boundary', () => {
  let app: INestApplication;
  let fixture: ReturnType<typeof setup>;
  let draftId: string;

  beforeEach(async () => {
    fixture = setup();
    const preview: any = await fixture.service.prepare('完成12家', sender);
    draftId = preview.draftId;
    const module = await Test.createTestingModule({
      controllers: [AiProgressController],
      providers: [
        { provide: AiProgressService, useValue: fixture.service },
        { provide: DingtalkCardPresenter, useValue: { markSaved: jest.fn() } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: JwtService, useValue: { verifyAsync: async (token: string) => ({ sub: token }) } },
        { provide: AuthService, useValue: { validateSession: async (payload: any) => ({ id: payload.sub }) } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  it('rejects unauthenticated and foreign users on every route', async () => {
    for (const [method, suffix] of [['get', ''], ['patch', ''], ['post', '/save']]) {
      await request(app.getHttpServer())[method](`/ai-progress/drafts/${draftId}${suffix}`).expect(401);
      await request(app.getHttpServer())[method](`/ai-progress/drafts/${draftId}${suffix}`).set('Authorization', 'Bearer other').send({ content: 'changed' }).expect(403);
    }
    expect(fixture.objectives.updateIndicatorProgress).not.toHaveBeenCalled();
  });

  it('loads and edits without writing, validates fields, and saves only the authenticated stored draft', async () => {
    const auth = 'Bearer owner';
    await request(app.getHttpServer()).get(`/ai-progress/drafts/${draftId}`).set('Authorization', auth).expect(200);
    await request(app.getHttpServer()).patch(`/ai-progress/drafts/${draftId}`).set('Authorization', auth).send({ content: null }).expect(400);
    await request(app.getHttpServer()).patch(`/ai-progress/drafts/${draftId}`).set('Authorization', auth).send({ content: '修正为11家', actualValue: '11', targetValue: '999', progress: 80, ownerId: 'other' }).expect(200);
    expect(fixture.objectives.updateIndicatorProgress).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(`/ai-progress/drafts/${draftId}/save`).set('Authorization', auth).send({ viewerId: 'other', actualValue: '999', content: 'forged' }).expect(201);
    expect(fixture.objectives.updateIndicatorProgress).toHaveBeenCalledWith('goal', expect.objectContaining({ content: '修正为11家', actualValue: '11', progress: null }), expect.objectContaining({ id: 'owner' }), { aiDraftId: draftId, aiAssisted: true });
  });
});
