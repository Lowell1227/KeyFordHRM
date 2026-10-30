import { GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DingtalkBotGateway } from './dingtalk-bot.gateway';
import { DingtalkCardPresenter } from './dingtalk-card.presenter';
import { AiProgressService } from '../ai-progress/ai-progress.service';
import { DWClient } from 'dingtalk-stream';

const listeners = new Map<string, (event: any) => Promise<void>>();
const sdk = {
  connected: false,
  connect: jest.fn(),
  _connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
  send: jest.fn(),
  config: { subscriptions: [] },
  registerCallbackListener: jest.fn((topic, handler) =>
    listeners.set(topic, handler),
  ),
};
jest.mock(
  'dingtalk-stream',
  () => ({
    DWClient: jest.fn(() => sdk),
    TOPIC_ROBOT: '/v1.0/im/bot/messages/get',
    TOPIC_CARD: '/v1.0/card/instances/callback',
  }),
  { virtual: true },
);

const ROBOT = '/v1.0/im/bot/messages/get';
const CARD = '/v1.0/card/instances/callback';
const draftId = '11111111-1111-4111-8111-111111111111';
const sender = {
  corpId: 'corp',
  senderStaffId: 'staff',
  conversationType: '1',
  conversationId: 'cid',
  deliveryId: 'msg',
};
const goal = {
  id: 'goal',
  title: '客户拜访',
  periodId: 'month',
  periodKey: '2026-10',
  targetValue: '10',
  unit: '家',
};
const preview: any = {
  kind: 'draft',
  draftId,
  state: 'pending',
  expiresAt: '2099-01-01T00:00:00Z',
  goals: [goal],
  indicatorId: 'goal',
  periodId: 'month',
  content: '已拜访12家',
  actualValue: '12',
  healthStatus: null,
  uncertain: false,
  canSave: true,
  targetValue: '10',
  unit: '家',
  completionPercent: 120,
  saved: null,
};
const frame = (topic: string, body: object, appId = 'bot-stream-app') => ({
  type: 'CALLBACK',
  headers: { topic, appId, messageId: 'delivery' },
  data: JSON.stringify(body),
});
const message = (changes = {}) =>
  frame(ROBOT, {
    chatbotCorpId: 'corp',
    senderCorpId: 'corp',
    robotCode: 'bot-app-key',
    senderStaffId: 'staff',
    conversationType: '1',
    conversationId: 'cid',
    msgId: 'msg',
    msgtype: 'text',
    text: { content: '已拜访12家' },
    ...changes,
  });
const callback = (changes = {}) =>
  frame(CARD, {
    corpId: 'corp',
    userId: 'staff',
    userIdType: 1,
    spaceType: 'IM_ROBOT',
    spaceId: 'staff',
    type: 'actionCallback',
    outTrackId: draftId,
    content: JSON.stringify({
      cardPrivateData: { actionIds: ['save'], params: { action: 'save' } },
    }),
    ...changes,
  });

describe('DingTalk Stream progress adapter', () => {
  let env: Record<string, string>;
  let config: ConfigService;
  let ai: any;
  let eligibility: any;
  let drafts: any;
  let progressUpdate: any;
  let progress: any;
  let performance: any;
  let archives: any;
  let presenter: DingtalkCardPresenter;
  let gateway: DingtalkBotGateway;
  let requests: any[];
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    (DWClient as unknown as jest.Mock).mockImplementation(() => sdk);
    sdk.connected = false;
    sdk._connect = jest.fn(async () => {
      sdk.connected = true;
    });
    sdk.connect.mockReset().mockImplementation(async () => sdk._connect());
    sdk.disconnect.mockReset().mockImplementation(() => {
      sdk.connected = false;
    });
    listeners.clear();
    env = {
      DINGTALK_BOT_STREAM_ENABLED: 'true',
      DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'true',
      DINGTALK_BOT_APP_KEY: 'bot-app-key',
      DINGTALK_BOT_APP_SECRET: 'fake-bot-secret',
      DINGTALK_CORP_ID: 'corp',
      DINGTALK_BOT_STREAM_APP_ID: 'bot-stream-app',
      DINGTALK_BOT_CARD_TEMPLATE_ID: 'template',
      DINGTALK_BOT_HRM_URL: 'https://hrm.example',
    };
    config = { get: (key: string) => env[key] } as any;
    ai = {
      getPublicState: jest
        .fn()
        .mockResolvedValue({ botEnabled: true, activeProvider: 'kimi' }),
    };
    eligibility = {
      resolveIdentity: jest
        .fn()
        .mockResolvedValue({ kind: 'ready', viewer: { id: 'owner' } }),
      resolveRecipient: jest
        .fn()
        .mockResolvedValue({ kind: 'ready', viewer: { id: 'owner' } }),
    };
    const claims = new Map();
    drafts = {
      get: jest
        .fn()
        .mockResolvedValue({ ...preview, ownerId: 'owner', sender }),
      withDraftLock: jest.fn((_id, work) => work()),
      claimDelivery: jest.fn(async (s, id) => {
        const key = s.deliveryId;
        if (!claims.has(key)) claims.set(key, id);
        return claims.get(key);
      }),
      releaseDelivery: jest.fn(async (s) => claims.delete(s.deliveryId)),
    };
    progressUpdate = { create: jest.fn().mockResolvedValue({ id: 'saved' }) };
    const objectives = {
      findAiDraftProgress: jest.fn().mockResolvedValue(null),
      findBotGoalAccess: jest
        .fn()
        .mockResolvedValue({ kind: 'ready', goals: [goal] }),
      updateIndicatorProgress: progressUpdate.create,
    };
    progress = new AiProgressService(
      drafts,
      eligibility,
      ai,
      {} as any,
      objectives as any,
    );
    jest.spyOn(progress, 'prepare').mockResolvedValue(preview);
    requests = [];
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url, init) => {
        requests.push({ url, ...init, body: JSON.parse(init!.body as string) });
        return {
          ok: true,
          json: async () =>
            String(url).endsWith('createAndDeliver')
              ? {
                  success: true,
                  result: {
                    outTrackId: JSON.parse(init!.body as string).outTrackId,
                    deliverResults: [{ success: true }],
                  },
                }
              : String(url).endsWith('/card/instances')
                ? { success: true, result: true }
                : { processQueryKey: 'query' },
        } as Response;
      });
    presenter = new DingtalkCardPresenter(
      config,
      ai,
      { getAccessToken: jest.fn().mockResolvedValue('fake-token') } as any,
      drafts,
      eligibility,
    );
    performance = { query: jest.fn().mockResolvedValue(null) };
    archives = { prepare: jest.fn().mockResolvedValue({ url: '/archive-assistant/preview/event#preview=signed' }) };
    gateway = new DingtalkBotGateway(
      config,
      eligibility,
      progress,
      drafts,
      presenter,
      performance,
      archives,
    );
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    fetchMock.mockRestore();
    jest.useRealTimers();
  });
  const flush = async () => {
    for (let step = 0; step < 12; step++) await Promise.resolve();
  };
  const startGateway = async () => {
    void gateway.onModuleInit();
    await flush();
  };
  const receive = async (event: any) =>
    listeners.get(event.headers.topic)!(event);

  const performanceCard = {
    kind: "goal",
    subjectKey: "task:one",
    params: {
      cycleLabel: "合成周期",
      stateLabel: "待制定目标",
      summary: "请完善本期目标。",
      primaryText: "制定目标",
      primaryUrl: "https://hrm.example/tasks/one?stage=goal-setting",
    },
  };
  it.each([
    ['progress', {}],
    ['help', { text: { content: '帮助' } }],
    ['query', { text: { content: '我的目标' } }],
    ['image', { msgtype: 'image' }],
    ['empty text', { text: { content: '' } }],
    ['oversized text', { text: { content: '字'.repeat(10001) } }],
  ])('silently acknowledges an excluded recipient: %s', async (_label, changes) => {
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    await startGateway();
    await receive(message(changes));
    expect(requests.length).toBe(0);
    expect(performance.query).not.toHaveBeenCalled();
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', {});
  });
  it.each(['档案测试', '档案帮助'])('handles exact archive command %s without recognition or writes', async (command) => {
    await startGateway();
    await receive(message({ text: { content: command } }));
    expect(performance.query).not.toHaveBeenCalled();
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(progressUpdate.create).not.toHaveBeenCalled();
    expect(archives.prepare).toHaveBeenCalledWith({ id: 'owner' }, sender);
    expect(requests[0].body.userIds).toEqual(['staff']);
    expect(requests[0].body.msgParam).toContain(command === '档案测试' ? 'https://hrm.example/archive-assistant/preview/' : '预览不会保存');
  });
  it('rechecks outbound archive recipient after prepare revokes admission', async () => {
    archives.prepare.mockImplementation(async () => {
      eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply' });
      return { url: '/archive-assistant/preview/event#preview=signed' };
    });
    await startGateway();
    await receive(message({ text: { content: '档案测试' } }));
    expect(requests).toHaveLength(0);
    expect(progress.prepare).not.toHaveBeenCalled();
  });
  it('deduplicates repeated archive command deliveries without saving', async () => {
    await startGateway();
    await receive(message({ text: { content: '档案测试' } }));
    await receive(message({ text: { content: '档案测试' } }));
    expect(requests).toHaveLength(1);
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it.each(['http://hrm.example', 'https://user:pass@hrm.example', 'https://hrm.example/other', 'https://hrm.example?other'])('refuses an invalid configured HRM origin %s', async origin => {
    env.DINGTALK_BOT_HRM_URL = origin;
    // Keep the existing connection test separate from URL validation of archive replies.
    jest.spyOn(presenter, 'isEnabled').mockResolvedValue(true);
    await startGateway();
    const reply = jest.spyOn(presenter, 'sendBusinessReply').mockResolvedValue(undefined);
    await receive(message({ text: { content: '档案测试' } }));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('档案助手试用暂不可用'), sender);
    expect(progress.prepare).not.toHaveBeenCalled();
  });
  it('handles archive admission failure without falling through or leaking details', async () => {
    archives.prepare.mockRejectedValue(new Error('private-token'));
    await startGateway();
    await receive(message({ text: { content: '档案测试' } }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(performance.query).not.toHaveBeenCalled();
    expect(JSON.stringify(requests)).toContain('档案助手');
    expect(JSON.stringify(requests)).not.toContain('private-token');
  });
  it.each([{ conversationType: '2' }, { senderStaffId: 'excluded' }])('does not prepare excluded archive sender %j', async changes => {
    eligibility.resolveIdentity.mockImplementation(async (s: any) => s.senderStaffId === 'excluded' ? { kind: 'reply' } : { kind: 'ready', viewer: { id: 'owner' } });
    await startGateway();
    await receive(message({ ...changes, text: { content: '档案测试' } }));
    expect(archives.prepare).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it('fails closed without a fallback message when identity lookup fails', async () => {
    eligibility.resolveIdentity.mockRejectedValue(new Error('identity unavailable'));
    await startGateway();
    await receive(message());
    expect(requests.length).toBe(0);
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(performance.query).not.toHaveBeenCalled();
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', {});
  });
  it.each(['text', 'preview', 'performance', 'refresh'])('blocks direct %s delivery to an excluded recipient', async kind => {
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    env.DINGTALK_BOT_GOAL_TEMPLATE_ID = 'goal-template';
    if (kind === 'text') await presenter.sendBusinessReply('提示', sender);
    if (kind === 'preview') await presenter.sendPreview(preview, sender);
    if (kind === 'performance') await presenter.sendPerformanceCard(performanceCard as any, sender);
    if (kind === 'refresh') await presenter.markSaved(draftId, { content: '已保存' } as any);
    expect(requests.length).toBe(0);
    expect(drafts.claimDelivery).not.toHaveBeenCalled();
  });
  it('rechecks the recipient after a query revokes access, including fallback replies', async () => {
    performance.query.mockImplementation(async () => {
      eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
      throw new Error('query unavailable');
    });
    await startGateway();
    await receive(message());
    expect(performance.query).toHaveBeenCalledTimes(1);
    expect(requests.length).toBe(0);
  });
  it.each(['text', 'preview', 'performance', 'refresh'])('rechecks %s at dispatch after token lookup revokes access', async kind => {
    env.DINGTALK_BOT_GOAL_TEMPLATE_ID = 'goal-template';
    const token = (presenter as any).dingtalkBot.getAccessToken;
    token.mockImplementationOnce(async () => {
      eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
      return 'fake-token';
    });
    const send = async () => {
      if (kind === 'text') await presenter.sendBusinessReply('提示', sender);
      if (kind === 'preview') await presenter.sendPreview(preview, sender);
      if (kind === 'performance') await presenter.sendPerformanceCard(performanceCard as any, sender);
      if (kind === 'refresh') await presenter.markSaved(draftId, { content: '已保存' } as any);
    };
    await send();
    expect(token).toHaveBeenCalledTimes(1);
    expect(requests.length).toBe(0);
    if (kind !== 'refresh') expect(drafts.releaseDelivery).toHaveBeenCalledTimes(1);
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'ready', viewer: { id: 'owner' } });
    await send();
    expect(requests.length).toBe(1);
  });
  it('rechecks the global switch after the delivery claim disables the bot', async () => {
    drafts.claimDelivery.mockImplementationOnce(async (_sender, token) => {
      env.DINGTALK_BOT_STREAM_ENABLED = 'false';
      return token;
    });
    await presenter.sendBusinessReply('提示', sender);
    expect(requests.length).toBe(0);
    expect(drafts.releaseDelivery).toHaveBeenCalledTimes(1);
  });
  it.each(['existing', 'expired', 'malformed'])('silently rejects an excluded clicker on a %s card', async kind => {
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    eligibility.resolveRecipient.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    if (kind === 'expired') drafts.get.mockResolvedValue(null);
    await startGateway();
    await receive(callback(kind === 'malformed' ? { content: '{' } : {}));
    expect(progressUpdate.create).not.toHaveBeenCalled();
    expect(drafts.get).not.toHaveBeenCalled();
    expect(requests.length).toBe(0);
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', {});
  });
  it('suppresses card refresh and callback content when access is revoked during save', async () => {
    progressUpdate.create.mockImplementation(async () => {
      eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
      eligibility.resolveRecipient.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
      return { id: 'saved', content: '已保存' };
    });
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    expect(requests.length).toBe(0);
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', {});
  });
  it("routes explicit performance queries without calling progress recognition and deduplicates their cards", async () => {
    env.DINGTALK_BOT_GOAL_TEMPLATE_ID = "goal-template";
    performance.query.mockResolvedValue({
      kind: "cards",
      cards: [performanceCard],
    });
    await startGateway();
    await receive(message({ text: { content: "我的目标" } }));
    await receive(message({ text: { content: "我的目标" } }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      cardTemplateId: "goal-template",
      cardData: { cardParamMap: performanceCard.params },
      openSpaceId: "dtv1.card//IM_ROBOT.staff",
      imRobotOpenSpaceModel: { supportForward: false },
      imRobotOpenDeliverModel: { robotCode: "bot-app-key" },
    });
  });
  it("uses a safe text entry when the additional template is not configured", async () => {
    performance.query.mockResolvedValue({
      kind: "cards",
      cards: [performanceCard],
    });
    await startGateway();
    await receive(message({ text: { content: "我的目标" } }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(requests[0].url).toContain("/robot/oToMessages/batchSend");
    const content = JSON.parse(requests[0].body.msgParam).content;
    expect(content).toContain(
      "https://hrm.example/tasks/one?stage=goal-setting",
    );
    expect(content).not.toContain("undefined");
  });
  it("does not convert a denied query into a model request", async () => {
    performance.query.mockResolvedValue({
      kind: "reply",
      text: "功能暂未开放",
    });
    await startGateway();
    await receive(message({ text: { content: "我的结果" } }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(JSON.parse(requests[0].body.msgParam).content).toBe("功能暂未开放");
    expect(requests).toHaveLength(1);
  });
  it("does not send a query card with an external link even when passed by an internal caller", async () => {
    env.DINGTALK_BOT_GOAL_TEMPLATE_ID = "goal-template";
    performance.query.mockResolvedValue({
      kind: "cards",
      cards: [
        {
          ...performanceCard,
          params: {
            ...performanceCard.params,
            primaryUrl: "https://evil.example/tasks/one",
          },
        },
      ],
    });
    await startGateway();
    await receive(message({ text: { content: "我的目标" } }));
    expect(requests.some((r) => r.url.endsWith("createAndDeliver"))).toBe(
      false,
    );
    expect(JSON.stringify(requests)).not.toContain("evil.example");
  });

  it('does not hold API startup while SDK endpoint discovery is pending', async () => {
    sdk.connect.mockImplementation(() => new Promise(() => undefined));
    let ready = false;
    void Promise.resolve(gateway.onModuleInit()).then(() => {
      ready = true;
    });
    await flush();
    expect(ready).toBe(true);
  });
  it('disables a pending attempt, blocks its late handshake and recovers after it settles', async () => {
    let endpointReady!: () => void;
    const endpoint = new Promise<void>((resolve) => {
      endpointReady = resolve;
    });
    const handshake = sdk._connect;
    sdk.connect.mockImplementationOnce(async () => {
      await endpoint;
      await sdk._connect();
    });
    await startGateway();
    ai.getPublicState.mockResolvedValue({
      botEnabled: false,
      activeProvider: 'kimi',
    });
    await gateway.syncConnection();
    expect(sdk.disconnect).toHaveBeenCalled();
    endpointReady();
    await flush();
    expect(handshake).not.toHaveBeenCalled();
    ai.getPublicState.mockResolvedValue({
      botEnabled: true,
      activeProvider: 'kimi',
    });
    const next = freshClient();
    (DWClient as unknown as jest.Mock).mockImplementation(() => next);
    await gateway.syncConnection();
    await flush();
    expect(next.connect).toHaveBeenCalledTimes(1);
  });
  it('times out an attempt without accumulating uncancellable SDK requests', async () => {
    jest.useFakeTimers();
    let endpointReady!: () => void;
    const endpoint = new Promise<void>((resolve) => {
      endpointReady = resolve;
    });
    const handshake = sdk._connect;
    sdk.connect.mockImplementationOnce(async () => {
      await endpoint;
      await sdk._connect();
    });
    await startGateway();
    await jest.advanceTimersByTimeAsync(10000);
    expect(sdk.disconnect).toHaveBeenCalled();
    await gateway.syncConnection();
    await gateway.syncConnection();
    expect(DWClient).toHaveBeenCalledTimes(1);
    endpointReady();
    await flush();
    expect(handshake).not.toHaveBeenCalled();
    const next = freshClient();
    (DWClient as unknown as jest.Mock).mockImplementation(() => next);
    await gateway.syncConnection();
    await flush();
    expect(next.connected).toBe(true);
  });
  it('uses a fresh client after SYSTEM disconnect and ignores old close/callbacks', async () => {
    await startGateway();
    const staleCallback = listeners.get(ROBOT)!;
    sdk.connected = false; // SYSTEM disconnect arrives before this socket closes.
    const next = freshClient();
    (DWClient as unknown as jest.Mock).mockImplementation(() => next);
    await gateway.syncConnection();
    await flush();
    expect(sdk.disconnect).toHaveBeenCalled();
    expect(next.connect).toHaveBeenCalledTimes(1);
    sdk.connected = false; // The old SDK's eventual close handler.
    await staleCallback(message());
    expect(progress.prepare).not.toHaveBeenCalled();
    await gateway.syncConnection();
    await flush();
    expect(DWClient).toHaveBeenCalledTimes(2);
    expect(next.connected).toBe(true);
    await receive(message());
    expect(progress.prepare).toHaveBeenCalledTimes(1);
  });
  it('cleans up a handshake that completes after its timeout before allowing recovery', async () => {
    jest.useFakeTimers();
    let open!: () => void;
    sdk._connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          open = () => {
            sdk.connected = true;
            resolve();
          };
        }),
    );
    await startGateway();
    await jest.advanceTimersByTimeAsync(10000);
    expect(sdk.disconnect).toHaveBeenCalledTimes(1);
    open();
    await flush();
    expect(sdk.disconnect).toHaveBeenCalledTimes(2);
    expect(sdk.connected).toBe(false);
    const next = freshClient();
    (DWClient as unknown as jest.Mock).mockImplementation(() => next);
    await gateway.syncConnection();
    await flush();
    expect(next.connected).toBe(true);
  });
  const freshClient = () => {
    const next: any = {
      ...sdk,
      connected: false,
      config: { subscriptions: [] },
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
      send: jest.fn(),
      registerCallbackListener: jest.fn((topic, handler) =>
        listeners.set(topic, handler),
      ),
    };
    next._connect = jest.fn(async () => {
      next.connected = true;
    });
    next.connect = jest.fn(async () => next._connect());
    next.disconnect.mockImplementation(() => {
      next.connected = false;
    });
    return next;
  };

  it('does not start or send when the environment switch is absent', async () => {
    delete env.DINGTALK_BOT_STREAM_ENABLED;
    await startGateway();
    await presenter.sendPreview(preview, sender);
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    'DINGTALK_BOT_APP_KEY',
    'DINGTALK_BOT_APP_SECRET',
    'DINGTALK_BOT_STREAM_APP_ID',
    'DINGTALK_BOT_CARD_TEMPLATE_ID',
    'DINGTALK_BOT_PREFLIGHT_CONFIRMED',
  ])('fails closed without %s', async (key) => {
    delete env[key];
    await startGateway();
    expect(sdk.connect).not.toHaveBeenCalled();
  });
  it('uses the dedicated robot application credentials while HRM credentials remain configured', async () => {
    await startGateway();
    expect(DWClient).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'bot-app-key',
      clientSecret: 'fake-bot-secret',
    }));
    expect(DWClient).not.toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'app-key',
    }));
  });
  it('does not start without an active tested provider', async () => {
    ai.getPublicState.mockResolvedValue({
      botEnabled: true,
      activeProvider: null,
    });
    await startGateway();
    expect(sdk.connect).not.toHaveBeenCalled();
  });
  it.each([
    { senderCorpId: 'other' },
    { chatbotCorpId: 'other' },
    { robotCode: 'other' },
    { conversationType: '2' },
    { senderStaffId: '' },
  ])(
    'rejects wrong enterprise/application/group/sender %j',
    async (changes) => {
      await startGateway();
      await receive(message(changes));
      expect(progress.prepare).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('rejects the wrong authenticated application header', async () => {
    await startGateway();
    const event = message();
    event.headers.appId = 'other';
    await receive(event);
    expect(progress.prepare).not.toHaveBeenCalled();
  });
  it('stops handling and disconnects when the bot is disabled', async () => {
    await startGateway();
    ai.getPublicState.mockResolvedValue({
      botEnabled: false,
      activeProvider: 'kimi',
    });
    await receive(message());
    await gateway.syncConnection();
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(sdk.disconnect).toHaveBeenCalled();
  });
  it('deduplicates Stream delivery and sends a non-forwardable preview to the authenticated single-chat user', async () => {
    await startGateway();
    await receive(message());
    await receive(message());
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      outTrackId: draftId,
      callbackType: 'STREAM',
      userIdType: 1,
      openSpaceId: 'dtv1.card//IM_ROBOT.staff',
      imRobotOpenSpaceModel: { supportForward: false },
    });
    expect(requests[0].body.cardData.cardParamMap.completion).toBe(
      '120%（超额完成）',
    );
    expect(requests[0].body.cardData.cardParamMap.editUrl).toBe(
      `https://hrm.example/ai-progress/confirm/${draftId}`,
    );
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('does not offer one-click save for ambiguous goal/month pairs', async () => {
    const card = presenter.previewCard({
      ...preview,
      canSave: false,
      uncertain: true,
      periodId: null,
      goals: [goal, { ...goal, periodId: 'another', periodKey: '2026-11' }],
    });
    expect(card.actions).not.toContain('保存进展');
    expect(card.params.canSave).toBe('false');
    expect(card.actions).toContain('修改');
  });
  it.each([
    ['blocked', '受阻'],
    ['completed', '已完成'],
  ])('shows the business status %s', (healthStatus, label) => {
    expect(
      presenter.previewCard({ ...preview, healthStatus }).params.healthStatus,
    ).toBe(label);
  });
  it('does not invent completion for qualitative progress', () => {
    expect(
      presenter.previewCard({
        ...preview,
        actualValue: null,
        targetValue: null,
        completionPercent: null,
      }).params.completion,
    ).toBe('');
  });
  it('replies to unavailable identities without generating a card', async () => {
    progress.prepare.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    await startGateway();
    await receive(message());
    expect(requests[0].body).toEqual({
      robotCode: 'bot-app-key',
      userIds: ['staff'],
      msgKey: 'sampleText',
      msgParam: '{"content":"功能暂未开放"}',
    });
    expect(requests[0].url).toBe(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
    );
  });
  it('does not parse a non-text message or call recognition', async () => {
    await startGateway();
    await receive(message({ msgtype: 'image' }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(requests[0].body.msgKey).toBe('sampleText');
  });
  it('sanitizes recognition errors and gives a manual route', async () => {
    progress.prepare.mockRejectedValue(new Error('secret-provider-error'));
    await startGateway();
    await receive(message());
    expect(requests[0].body.msgParam).toContain('https://hrm.example');
    expect(JSON.stringify(requests)).not.toContain('secret-provider-error');
  });
  it('does not save forwarded card', async () => {
    await startGateway();
    await receive(callback({ userId: 'other', spaceId: 'other' }));
    expect(progressUpdate.create).not.toHaveBeenCalled();
    expect(eligibility.resolveIdentity).not.toHaveBeenCalled();
  });
  it.each([
    { corpId: 'other' },
    { userIdType: 2 },
    { spaceType: 'IM_GROUP' },
    { spaceId: 'other' },
    { spaceId: undefined },
    { type: 'other' },
  ])('rejects untrusted callback context %j', async (changes) => {
    await startGateway();
    await receive(callback(changes));
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('resolves the actual clicker and uses the server conversation before owner-checked save', async () => {
    const save = jest.spyOn(progress, 'saveDraft');
    await startGateway();
    await receive(callback());
    expect(save).toHaveBeenCalledWith(draftId, 'owner', 'cid');
    expect(eligibility.resolveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        senderStaffId: 'staff',
        conversationId: 'cid',
        corpId: 'corp',
      }),
    );
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    expect(requests[0].body.cardData.cardParamMap.state).toBe('已保存');
  });
  it('does not save when the actual clicker maps to a different HRM owner', async () => {
    eligibility.resolveIdentity.mockResolvedValue({
      kind: 'ready',
      viewer: { id: 'other-owner' },
    });
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('rejects expired drafts without a save', async () => {
    drafts.get.mockResolvedValue(null);
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
    expect(sdk.send).toHaveBeenLastCalledWith(
      'delivery',
      expect.objectContaining({ userPrivateData: expect.any(Object) }),
    );
  });
  it('does not save an ambiguous draft even if the save action is forged', async () => {
    drafts.get.mockResolvedValue({
      ...preview,
      ownerId: 'owner',
      sender,
      uncertain: true,
    });
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('preserves committed progress when card refresh fails and reports saved status', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive upstream payload'));
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sdk.send.mock.calls)).toContain('已保存');
    expect(JSON.stringify(sdk.send.mock.calls)).not.toContain('sensitive');
  });
  it('uses the saved goal and month even if the callback loaded the draft before a page correction', () => {
    const otherGoal = { ...goal, id: 'other-goal', title: '更正后的目标', periodId: 'sep', periodKey: '2026-09' };
    const params = presenter.previewCard({ ...preview, goals: [goal, otherGoal], state: 'saved',
      saved: { indicatorId: 'other-goal', periodId: 'sep', actualValue: null, targetValueSnapshot: null,
        unitSnapshot: null, completionPercent: null, content: '已修正', healthStatus: 'completed' } as any }).params;
    expect(params).toMatchObject({ goal: '更正后的目标', month: '2026-09', content: '已修正', actualValue: '', targetValue: '', completion: '' });
  });
  it('keeps saved progress reachable after draft expiry using the persisted indicator', () => {
    const params = presenter.previewCard({ ...preview, state: 'saved', saved: {
      indicatorId: 'corrected-goal', periodId: 'month', content: '已核对',
    } as any }).params;
    expect(params.editUrl).toBe('https://hrm.example/action-items?indicatorId=corrected-goal');
    expect(params.detailUrl).toBe(params.editUrl);
    expect(presenter.previewCard(preview).params.editUrl)
      .toBe(`https://hrm.example/ai-progress/confirm/${draftId}`);
  });
  it('projects persisted values into both saved previews and old-card callbacks', async () => {
    const saved = { id: 'saved', content: '核对后实际9家', actualValue: 9, targetValueSnapshot: 10,
      unitSnapshot: '家', completionPercent: 90, progress: 90, healthStatus: 'at_risk' };
    (progress as any).objectives.findAiDraftProgress.mockResolvedValue(saved);
    const expected = { state: '已保存', content: '核对后实际9家', actualValue: '9', targetValue: '10', unit: '家',
      healthStatus: '有风险', completion: '90%', canSave: 'false', editLabel: '查看进展' };
    expect(presenter.previewCard({ ...preview, state: 'saved', saved }).params).toMatchObject(expected);
    await startGateway();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
    expect(requests[0].body.cardData.cardParamMap).toMatchObject(expected);
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', expect.objectContaining({
      cardData: { cardParamMap: expect.objectContaining(expected) },
    }));
  });
  it('repeated callback after refresh failure returns the committed row without creating another', async () => {
    let saved: any = null;
    (progress as any).objectives.findAiDraftProgress.mockImplementation(
      async () => saved,
    );
    progressUpdate.create.mockImplementation(
      async () => (saved = { id: 'saved' }),
    );
    fetchMock.mockRejectedValueOnce(new Error('temporary'));
    await startGateway();
    await receive(callback());
    await receive(callback());
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    expect(sdk.send).toHaveBeenLastCalledWith(
      'delivery',
      expect.objectContaining({
        cardData: {
          cardParamMap: expect.objectContaining({ state: '已保存' }),
        },
      }),
    );
  });
  it('does not trust owner/conversation/action data as the clicker identity', async () => {
    const save = jest.spyOn(progress, 'saveDraft');
    await startGateway();
    await receive(
      callback({
        content: JSON.stringify({
          cardPrivateData: {
            params: {
              action: 'save',
              ownerId: 'other',
              conversationId: 'other',
              draftId: 'other',
            },
          },
        }),
      }),
    );
    expect(save).toHaveBeenCalledWith(draftId, 'owner', 'cid');
  });
  it('retries failed outbound delivery without a permanent deduplication claim', async () => {
    fetchMock.mockRejectedValueOnce(new Error('transport'));
    await expect(presenter.sendPreview(preview, sender)).rejects.toThrow(
      '暂未送达',
    );
    await presenter.sendPreview(preview, sender);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('bounds a stalled token lookup, releases its claim, and suppresses a late send', async () => {
    jest.useFakeTimers();
    const tokens = (presenter as any).dingtalkBot;
    let finish!: (value: string) => void;
    tokens.getAccessToken.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    let outcome: unknown;
    const pending = presenter.sendPreview(preview, sender).catch(error => { outcome = error; });
    await jest.advanceTimersByTimeAsync(10001);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('暂未送达');
    expect(drafts.releaseDelivery).toHaveBeenCalledTimes(1);
    await pending;
    await presenter.sendPreview(preview, sender);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish('late-sensitive-token');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('includes token time and response body time in one card deadline', async () => {
    jest.useFakeTimers();
    const tokens = (presenter as any).dingtalkBot;
    tokens.getAccessToken.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve('synthetic-token'), 6000)));
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return { ok: true, json: () => new Promise(() => undefined) } as any;
    });
    let outcome: unknown;
    const pending = presenter.sendPreview(preview, sender).catch(error => { outcome = error; });
    await jest.advanceTimersByTimeAsync(10001);
    expect(outcome).toBeInstanceOf(Error);
    expect(requestSignal?.aborted).toBe(true);
    expect(drafts.releaseDelivery).toHaveBeenCalledTimes(1);
    await pending;
  });
  it('ACKs a committed callback even when card token lookup stalls', async () => {
    jest.useFakeTimers();
    await startGateway();
    (presenter as any).dingtalkBot.getAccessToken.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = receive(callback());
    await jest.advanceTimersByTimeAsync(10001);
    expect(sdk.send).toHaveBeenLastCalledWith('delivery', expect.objectContaining({
      cardData: { cardParamMap: expect.objectContaining({ state: '已保存' }) },
    }));
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    await pending;
  });
  it('rejects actual nested delivery failure, releases its claim and allows retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: { outTrackId: draftId, deliverResults: [{ success: false }] },
      }),
    } as Response);
    await expect(presenter.sendPreview(preview, sender)).rejects.toThrow(
      '暂未送达',
    );
    expect(drafts.releaseDelivery).toHaveBeenCalled();
    await presenter.sendPreview(preview, sender);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects a false boolean update result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, result: false }),
    } as Response);
    await expect(presenter.markSaved(draftId, { id: 'saved' } as any)).rejects.toThrow('暂未送达');
  });
  it.each([
    'flowControlledStaffIdList',
    'invalidStaffIdList',
    'filteredStaffIdList',
  ])(
    'does not mark a rejected text recipient delivered (%s)',
    async (field) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ [field]: ['staff'] }),
      } as Response);
      await expect(
        presenter.sendBusinessReply('请稍后重试', sender),
      ).rejects.toThrow('暂未送达');
      expect(drafts.releaseDelivery).toHaveBeenCalled();
    },
  );
  it('returns safe business errors and never leaks an upstream failure', async () => {
    jest
      .spyOn(progress, 'saveDraft')
      .mockRejectedValue(new GoneException('草稿已过期，请重新发送进展'));
    await startGateway();
    await receive(callback());
    expect(JSON.stringify(sdk.send.mock.calls)).toContain('草稿已过期');
  });
});
