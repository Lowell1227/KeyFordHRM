import { GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DingtalkBotGateway } from './dingtalk-bot.gateway';
import { DingtalkCardPresenter } from './dingtalk-card.presenter';
import { AiProgressService } from '../ai-progress/ai-progress.service';

const listeners = new Map<string, (event: any) => Promise<void>>();
const sdk = {
  connect: jest.fn(),
  disconnect: jest.fn(),
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
const frame = (topic: string, body: object, appId = 'stream-app') => ({
  type: 'CALLBACK',
  headers: { topic, appId, messageId: 'delivery' },
  data: JSON.stringify(body),
});
const message = (changes = {}) =>
  frame(ROBOT, {
    chatbotCorpId: 'corp',
    senderCorpId: 'corp',
    robotCode: 'app-key',
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
  let presenter: DingtalkCardPresenter;
  let gateway: DingtalkBotGateway;
  let requests: any[];
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    listeners.clear();
    env = {
      DINGTALK_BOT_STREAM_ENABLED: 'true',
      DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'true',
      DINGTALK_APP_KEY: 'app-key',
      DINGTALK_APP_SECRET: 'fake-secret',
      DINGTALK_CORP_ID: 'corp',
      DINGTALK_STREAM_APP_ID: 'stream-app',
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
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });
    presenter = new DingtalkCardPresenter(
      config,
      ai,
      { getAccessToken: jest.fn().mockResolvedValue('fake-token') } as any,
      drafts,
    );
    gateway = new DingtalkBotGateway(
      config,
      eligibility,
      progress,
      drafts,
      presenter,
    );
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    fetchMock.mockRestore();
  });
  const receive = async (event: any) =>
    listeners.get(event.headers.topic)!(event);

  it('does not start or send when the environment switch is absent', async () => {
    delete env.DINGTALK_BOT_STREAM_ENABLED;
    await gateway.onModuleInit();
    await presenter.sendPreview(preview, sender);
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    'DINGTALK_APP_KEY',
    'DINGTALK_APP_SECRET',
    'DINGTALK_STREAM_APP_ID',
    'DINGTALK_BOT_CARD_TEMPLATE_ID',
    'DINGTALK_BOT_PREFLIGHT_CONFIRMED',
  ])('fails closed without %s', async (key) => {
    delete env[key];
    await gateway.onModuleInit();
    expect(sdk.connect).not.toHaveBeenCalled();
  });
  it('does not start without an active tested provider', async () => {
    ai.getPublicState.mockResolvedValue({
      botEnabled: true,
      activeProvider: null,
    });
    await gateway.onModuleInit();
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
      await gateway.onModuleInit();
      await receive(message(changes));
      expect(progress.prepare).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('rejects the wrong authenticated application header', async () => {
    await gateway.onModuleInit();
    const event = message();
    event.headers.appId = 'other';
    await receive(event);
    expect(progress.prepare).not.toHaveBeenCalled();
  });
  it('stops handling and disconnects when the bot is disabled', async () => {
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
    await receive(message());
    expect(requests[0].body).toEqual({
      robotCode: 'app-key',
      userIds: ['staff'],
      msgKey: 'sampleText',
      msgParam: '{"content":"功能暂未开放"}',
    });
    expect(requests[0].url).toBe(
      'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
    );
  });
  it('does not parse a non-text message or call recognition', async () => {
    await gateway.onModuleInit();
    await receive(message({ msgtype: 'image' }));
    expect(progress.prepare).not.toHaveBeenCalled();
    expect(requests[0].body.msgKey).toBe('sampleText');
  });
  it('sanitizes recognition errors and gives a manual route', async () => {
    progress.prepare.mockRejectedValue(new Error('secret-provider-error'));
    await gateway.onModuleInit();
    await receive(message());
    expect(requests[0].body.msgParam).toContain('https://hrm.example');
    expect(JSON.stringify(requests)).not.toContain('secret-provider-error');
  });
  it('does not save forwarded card', async () => {
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
    await receive(callback(changes));
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('resolves the actual clicker and uses the server conversation before owner-checked save', async () => {
    const save = jest.spyOn(progress, 'saveDraft');
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('rejects expired drafts without a save', async () => {
    drafts.get.mockResolvedValue(null);
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
    await receive(callback());
    expect(progressUpdate.create).not.toHaveBeenCalled();
  });
  it('preserves committed progress when card refresh fails and reports saved status', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive upstream payload'));
    await gateway.onModuleInit();
    await receive(callback());
    expect(progressUpdate.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sdk.send.mock.calls)).toContain('已保存');
    expect(JSON.stringify(sdk.send.mock.calls)).not.toContain('sensitive');
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
    await gateway.onModuleInit();
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
    await gateway.onModuleInit();
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
  it('treats a nested card delivery failure as an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: [{ success: false }] }),
    } as Response);
    await expect(presenter.sendPreview(preview, sender)).rejects.toThrow(
      '暂未送达',
    );
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
    await gateway.onModuleInit();
    await receive(callback());
    expect(JSON.stringify(sdk.send.mock.calls)).toContain('草稿已过期');
  });
});
