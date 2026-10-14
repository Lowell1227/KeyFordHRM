import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, SysRole, User } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import request from 'supertest';
import { AiConfigController } from '@/ai-progress/ai-config.controller';
import { AiConfigService } from '@/ai-progress/ai-config.service';
import { AiProgressController } from '@/ai-progress/ai-progress.controller';
import { AiProgressService } from '@/ai-progress/ai-progress.service';
import { BotEligibilityService } from '@/ai-progress/bot-eligibility.service';
import { ProgressDraftStore } from '@/ai-progress/progress-draft.store';
import { ProviderClient } from '@/ai-progress/provider-client';
import { ProgressCandidate } from '@/ai-progress/recognition.types';
import { AuthService } from '@/auth/auth.service';
import { BusinessCapabilitiesService } from '@/auth/business-capabilities.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { DataScopeService } from '@/common/services/data-scope.service';
import { DingtalkBotGateway } from '@/dingtalk/dingtalk-bot.gateway';
import { DingtalkCardPresenter } from '@/dingtalk/dingtalk-card.presenter';
import { PerformanceCardService } from '@/dingtalk/performance-card.service';
import { TasksService } from '@/tasks/tasks.service';
import { ScoringService } from '@/tasks/scoring.service';
import { IndicatorVisibilityService } from '@/tasks/indicator-visibility.service';
import { IndicatorVersionService } from '@/tasks/indicator-version.service';
import { ImprovementWorkflowService } from '@/improvement-plans/improvement-workflow.service';
import { DingtalkService } from '@/dingtalk/dingtalk.service';
import { DingtalkBotCredentialsService } from '@/dingtalk/dingtalk-bot-credentials.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';
import { ObjectivesController } from '@/objectives/objectives.controller';
import { ObjectivesService } from '@/objectives/objectives.service';
import { shanghaiMonthKey } from '@/objectives/goal-tracking-progress';
import { NotificationsService } from '@/notifications/notifications.service';
import { MESSAGE_PUSH_PROVIDER } from '@/notifications/message-push.provider';
import { PeriodReviewsController } from '@/period-reviews/period-reviews.controller';
import { PeriodReviewsService } from '@/period-reviews/period-reviews.service';
import { PeriodMonitoringService } from '@/period-reviews/period-monitoring.service';
import { PeriodAggregationService } from '@/period-reviews/period-aggregation.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { FlowService } from '@/tasks/flow.service';
import { FixtureFactory } from '../fixtures/fixture-factory';

const ROBOT = '/v1.0/im/bot/messages/get';
const CARD = '/v1.0/card/instances/callback';
const listeners = new Map<string, (event: unknown) => Promise<void>>();
const stream = {
  connected: false,
  config: { subscriptions: [] },
  connect: async () => { stream.connected = true; },
  _connect: async () => undefined,
  disconnect: () => { stream.connected = false; },
  removeAllListeners: () => listeners.clear(),
  send: jest.fn(),
  registerCallbackListener: (topic: string, callback: (event: unknown) => Promise<void>) => listeners.set(topic, callback),
};
jest.mock('dingtalk-stream', () => ({
  DWClient: jest.fn(() => stream),
  TOPIC_ROBOT: '/v1.0/im/bot/messages/get',
  TOPIC_CARD: '/v1.0/card/instances/callback',
}));

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Every connection below is derived from a container this suite started, never from process.env.
describe('AI progress integration (disposable PostgreSQL/Redis, fake external transports)', () => {
  let postgres: StartedPostgreSqlContainer | undefined;
  let redisContainer: StartedTestContainer | undefined;
  let prisma: PrismaService;
  let redis: Redis;
  let app: INestApplication;
  let factory: FixtureFactory;
  let config: AiConfigService;
  let gateway: DingtalkBotGateway;
  let provider: ProviderClient;
  let recognize: jest.SpyInstance;
  let fetchMock: jest.SpyInstance;
  let administrator: User;
  let manager: User;
  let other: User;
  let hr: User;
  let deptId: string;
  let jwt: JwtService;
  let sequence = 0;
  let candidate: ProgressCandidate;
  const outbound: Array<{ url: string; body: any }> = [];
  const providerInputs: any[] = [];
  const [year, month] = shanghaiMonthKey(new Date()).split('-').map(Number);
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const dingtalk = {
    getAccessToken: jest.fn(async () => 'synthetic-transport-token'),
    fetchUserDetail: jest.fn(async () => { throw new Error('No external identity lookup in this fixture'); }),
  };

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_ai_progress_e2e').withStartupTimeout(60000).start();
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379).withStartupTimeout(60000).start();
    const databaseUrl = postgres.getConnectionUri();
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    console.info(`AI integration owns PostgreSQL ${postgres.getId()} and Redis ${redisContainer.getId()}`);
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60000,
      });
    } catch {
      throw new Error('Migration failed in the suite-owned disposable AI progress database');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    redis = new Redis(redisUrl);
    await redis.ping();
    factory = new FixtureFactory(prisma);
    deptId = (await factory.createDept({ name: 'Synthetic AI integration department' })).id;
    [administrator, manager, other, hr] = await Promise.all([
      createUser('admin', SysRole.system_admin), createUser('manager', SysRole.manager),
      createUser('other', SysRole.employee), createUser('hr', SysRole.hr),
    ]);
    const values: Record<string, string> = {
      REDIS_URL: redisUrl, AI_PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      DINGTALK_BOT_STREAM_ENABLED: 'true', DINGTALK_BOT_PREFLIGHT_CONFIRMED: 'true',
      DINGTALK_APP_KEY: 'synthetic-hrm-app', DINGTALK_APP_SECRET: 'synthetic-hrm-secret',
      DINGTALK_BOT_APP_KEY: 'synthetic-bot-app', DINGTALK_BOT_APP_SECRET: 'synthetic-bot-secret',
      DINGTALK_CORP_ID: 'synthetic-corp', DINGTALK_BOT_STREAM_APP_ID: 'synthetic-stream',
      DINGTALK_BOT_CARD_TEMPLATE_ID: 'synthetic-template', DINGTALK_BOT_HRM_URL: 'https://hrm.example',
      DINGTALK_BOT_TODO_TEMPLATE_ID: 'synthetic-todo', DINGTALK_BOT_GOAL_TEMPLATE_ID: 'synthetic-goal',
      DINGTALK_BOT_EVALUATION_TEMPLATE_ID: 'synthetic-evaluation', DINGTALK_BOT_RESULT_TEMPLATE_ID: 'synthetic-result',
    };
    // No ConfigModule or .env loading: unlisted keys cannot fall through to live process settings.
    const isolatedConfig = { get: (key: string, fallback?: string) => values[key] ?? fallback };
    jwt = new JwtService({ secret: randomBytes(32).toString('hex'), signOptions: { expiresIn: '5m' } });
    provider = new ProviderClient();
    recognize = jest.spyOn(provider, 'recognize');
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(init!.body as string);
      if (String(url) === 'https://api.moonshot.cn/v1/chat/completions') {
        const input = JSON.parse(body.messages[1].content);
        providerInputs.push(input);
        const result = input.goals[0].id === 'synthetic-goal'
          ? { indicatorId: 'synthetic-goal', content: '连接样例', actualValue: '2', healthStatus: null, uncertain: false }
          : candidate;
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
          role: 'assistant', content: JSON.stringify(result),
        } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!String(url).startsWith('https://api.dingtalk.com/v1.0/'))
        throw new Error('Unexpected external URL blocked by the test transport');
      outbound.push({ url: String(url), body });
      return new Response(JSON.stringify(String(url).endsWith('createAndDeliver')
        ? { success: true, result: { outTrackId: body.outTrackId, deliverResults: [{ success: true }] } }
        : String(url).endsWith('/card/instances') ? { success: true, result: true } : { processQueryKey: 'synthetic' }),
      { status: 200 });
    });
    const module = await Test.createTestingModule({
      controllers: [AiConfigController, AiProgressController, ObjectivesController, PeriodReviewsController],
      providers: [
        { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: isolatedConfig },
        { provide: JwtService, useValue: jwt }, { provide: DingtalkService, useValue: dingtalk },
        { provide: DingtalkBotCredentialsService, useValue: { getAccessToken: jest.fn().mockResolvedValue('synthetic-bot-token') } },
        { provide: ProviderClient, useValue: provider },
        { provide: MESSAGE_PUSH_PROVIDER, useValue: { push: async () => ({ channel: 'synthetic' }) } },
        { provide: StorageService, useValue: {} },
        AiConfigService, AiProgressService, ProgressDraftStore, BotEligibilityService,
        AuthService, BusinessCapabilitiesService, EmployeeEffectiveDateService, DataScopeService,
        ObjectivesService, DingtalkCardPresenter, DingtalkBotGateway, FlowService,
        PerformanceCardService, TasksService, ScoringService, IndicatorVisibilityService, IndicatorVersionService, ImprovementWorkflowService,
        NotificationsService, PeriodReviewsService, PeriodMonitoringService, PeriodAggregationService,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(new JwtAuthGuard(new Reflector(), jwt, module.get(AuthService)), new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    config = module.get(AiConfigService);
    gateway = module.get(DingtalkBotGateway);
    await config.saveProvider('kimi', { apiKey: 'synthetic-provider-key', modelId: 'synthetic-model' }, administrator.id);
    expect(await config.testProvider('kimi', administrator.id)).toMatchObject({ success: true });
    await config.activate('kimi', administrator.id);
    await config.setBotEnabled(true, administrator.id);
    await gateway.syncConnection();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(listeners.has(ROBOT)).toBe(true);
  }, 120000);

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      redis?.disconnect();
      await prisma?.$disconnect();
      fetchMock?.mockRestore();
      recognize?.mockRestore();
      await Promise.all([postgres?.stop(), redisContainer?.stop()]);
    }
  }, 30000);

  beforeEach(() => {
    recognize.mockClear();
    stream.send.mockClear();
    outbound.length = 0;
    providerInputs.length = 0;
  });

  async function createUser(label: string, role: SysRole = SysRole.employee) {
    const user = await factory.createUser({ employeeNo: `AI-${label}`, name: `Synthetic ${label}`, sysRole: role, deptId, password: randomUUID() });
    await prisma.employmentRecord.create({ data: {
      userId: user.id, employeeNo: user.employeeNo, company: 'fuede', deptId,
      effectiveFrom: new Date('2020-01-01'), changeType: 'initial', employeeStatus: 'active',
    } });
    return user;
  }

  const http = (user: User) => {
    const token = jwt.sign({ sub: user.id, employeeNo: user.employeeNo });
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(`/api/v1${url}`).auth(token, { type: 'bearer' }),
      put: (url: string) => request(server).put(`/api/v1${url}`).auth(token, { type: 'bearer' }),
      patch: (url: string) => request(server).patch(`/api/v1${url}`).auth(token, { type: 'bearer' }),
      post: (url: string) => request(server).post(`/api/v1${url}`).auth(token, { type: 'bearer' }),
    };
  };

  async function fixture(quantitative = true) {
    const employee = await createUser(`employee-${++sequence}`);
    const staffId = `synthetic-staff-${sequence}`;
    await prisma.externalIdentityBinding.create({ data: {
      userId: employee.id, externalUserId: staffId, externalUnionId: `synthetic-union-${sequence}`,
    } });
    const cycle = await factory.createCycle({ name: `Synthetic AI cycle ${sequence}`, createdBy: administrator.id, status: 'self_eval', startDate: start, endDate: end });
    await prisma.assessmentCycle.update({ where: { id: cycle.id }, data: {
      workflowVersion: 2, scoringFrequency: 'monthly', monthlyFollowUpRequired: true, openedAt: start, notificationMode: 'off',
    } });
    const task = await factory.createTaskInStatus({ cycleId: cycle.id, employeeId: employee.id, managerId: manager.id, deptId, status: 'self_eval' });
    await prisma.assessmentTask.update({ where: { id: task.id }, data: { indicatorConfirmedAt: start } });
    const original = await prisma.indicatorInstance.findFirstOrThrow({ where: { taskId: task.id, indicatorType: 'kpi' }, orderBy: { sortOrder: 'asc' } });
    const indicator = await prisma.indicatorInstance.update({ where: { id: original.id }, data: {
      name: quantitative ? 'Synthetic client visits' : 'Synthetic launch preparation',
      targetValue: quantitative ? new Prisma.Decimal(10) : null, unit: quantitative ? '家' : null,
    } });
    const version = await prisma.indicatorVersion.create({ data: {
      taskId: task.id, version: 1, status: 'active', effectiveFromPeriodKey: periodKey,
      createdById: employee.id, activatedAt: start, items: { create: {
        sourceInstanceId: indicator.id, name: indicator.name, weight: new Prisma.Decimal(1),
        indicatorType: 'kpi', dimensionWeight: new Prisma.Decimal(1), sortOrder: 0,
      } },
    }, include: { items: true } });
    const period = await prisma.assessmentPeriod.create({ data: {
      taskId: task.id, periodKey, periodType: 'month', sequence: 1, periodStart: start, periodEnd: end,
      managerId: manager.id, indicatorVersionId: version.id, status: 'self_eval', openedAt: start,
      selfEvalOpenAt: start, selfEvalDueAt: end, managerDueAt: end,
    } });
    await config.setAllowlist([employee.id], administrator.id);
    candidate = { indicatorId: indicator.id, content: quantitative ? '已拜访12家' : '已完成上线准备',
      actualValue: quantitative ? '12' : null, healthStatus: quantitative ? 'on_track' : 'completed', uncertain: false };
    return { employee, staffId, cycle, task, indicator, period, item: version.items[0] };
  }

  function frame(topic: string, body: object, deliveryId = randomUUID()) {
    return { type: 'CALLBACK', headers: { topic, appId: 'synthetic-stream', messageId: deliveryId }, data: JSON.stringify(body) };
  }
  const receive = (event: ReturnType<typeof frame>) => listeners.get(event.headers.topic)!(event);
  const message = (staffId: string, changes = {}, deliveryId = randomUUID()) => frame(ROBOT, {
    chatbotCorpId: 'synthetic-corp', senderCorpId: 'synthetic-corp', robotCode: 'synthetic-bot-app',
    senderStaffId: staffId, conversationType: '1', conversationId: `synthetic-conversation-${staffId}`,
    msgId: deliveryId, msgtype: 'text', text: { content: candidate.content }, ...changes,
  });
  const saveCard = (draftId: string, staffId: string) => frame(CARD, {
    corpId: 'synthetic-corp', type: 'actionCallback', userIdType: 1,
    userId: staffId, spaceType: 'IM_ROBOT', spaceId: staffId, outTrackId: draftId,
    content: JSON.stringify({ cardPrivateData: { params: { action: 'save' } } }),
  });
  async function prepare(data: Awaited<ReturnType<typeof fixture>>) {
    await receive(message(data.staffId));
    const card = outbound.find(item => item.url.endsWith('createAndDeliver'));
    expect(card).toBeDefined();
    return card!.body.outTrackId as string;
  }

  it('queries a real owned period through the Stream adapter without model calls or business writes', async () => {
    const data = await fixture();
    const before = await assessmentEvidence(data.task.id);
    const event = message(data.staffId, { text: { content: '我的自评' } });
    await receive(event);
    await receive(event);
    expect(provider.recognize).not.toHaveBeenCalled();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body).toMatchObject({ cardTemplateId: 'synthetic-evaluation',
      openSpaceId: `dtv1.card//IM_ROBOT.${data.staffId}`, cardData: { cardParamMap: {
        periodLabel: periodKey, primaryUrl: `https://hrm.example/tasks/${data.task.id}/periods/${data.period.id}`,
      } } });
    expect(await assessmentEvidence(data.task.id)).toEqual(before);
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: data.indicator.id } })).toBe(0);
  });

  it('keeps personal goal queries owner-only even with a real HR role', async () => {
    const own = await fixture();
    const colleague = await fixture();
    await prisma.user.update({ where: { id: own.employee.id }, data: { sysRole: SysRole.hr } });
    await config.setAllowlist([own.employee.id], administrator.id);
    await receive(message(own.staffId, { text: { content: '我的目标' } }));
    expect(provider.recognize).not.toHaveBeenCalled();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body.cardData.cardParamMap.primaryUrl).toContain(own.task.id);
    expect(JSON.stringify(outbound)).not.toContain(colleague.task.id);
  });

  it('keeps unapproved results out of chat and sends an approved confirmation entry without scores', async () => {
    const data = await fixture();
    await receive(message(data.staffId, { text: { content: '我的结果' } }));
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toContain('/robot/oToMessages/batchSend');
    outbound.length = 0;
    await prisma.assessmentTask.update({ where: { id: data.task.id }, data: { status: 'approval', approvedAt: new Date() } });
    await receive(message(data.staffId, { text: { content: '我的结果' } }));
    expect(outbound[0].body).toMatchObject({ cardTemplateId: 'synthetic-result', cardData: { cardParamMap: {
      primaryText: '查看并确认结果', primaryUrl: `https://hrm.example/tasks/${data.task.id}?stage=result`,
    } } });
    expect(JSON.stringify(outbound)).not.toMatch(/calculatedScore|rawGrade|coefficient|calibratedGrade/);
    expect(provider.recognize).not.toHaveBeenCalled();
  });

  it('keeps a real employee objection visible as regrading without unmasking result fields', async () => {
    const data = await fixture();
    const approvedAt = new Date();
    await prisma.assessmentTask.update({ where: { id: data.task.id }, data: { status: 'approval', approvedAt } });
    await prisma.gradeResult.upsert({ where: { taskId: data.task.id },
      create: { taskId: data.task.id, approvedAt, calculatedScore: 93.17, rawGrade: 'A' },
      update: { approvedAt, calculatedScore: 93.17, rawGrade: 'A' } });
    await app.get(TasksService).employeeDisagree(data.task.id, '合成异议原因', data.employee as any);
    const detail = await app.get(TasksService).findOne(data.task.id, data.employee as any);
    expect(detail.totalScore).toBeNull();
    expect(detail.gradeResult).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('93.17');
    await receive(message(data.staffId, { text: { content: '我的结果' } }));
    expect(outbound[0].body).toMatchObject({ cardTemplateId: 'synthetic-result', cardData: { cardParamMap: {
      stateLabel: '结果重新评定中', primaryText: '查看重评进度',
    } } });
    expect(JSON.stringify(outbound)).not.toMatch(/93\.17|rawGrade|合成异议原因/);
  });
  it('delivers a frozen period-manager entry without granting full task visibility', async () => {
    const data = await fixture();
    await prisma.assessmentTask.update({ where: { id: data.task.id }, data: {
      managerId: other.id, deptHeadId: other.id, approverId: other.id, status: 'manager_scoring' } });
    await prisma.assessmentPeriod.update({ where: { id: data.period.id }, data: { status: 'manager_scoring', employeeSubmittedAt: new Date() } });
    const staffId = `synthetic-period-manager-${sequence}`;
    await prisma.externalIdentityBinding.create({ data: { userId: manager.id, externalUserId: staffId,
      externalUnionId: `synthetic-period-union-${sequence}` } });
    await config.setAllowlist([manager.id], administrator.id);
    await expect(app.get(TasksService).findOne(data.task.id, manager as any)).rejects.toThrow();
    const detail = await app.get(PeriodReviewsService).getReview(data.period.id, manager as any);
    expect(detail.permissions).toMatchObject({ canEditManager: true, viewerRole: 'manager' });
    await receive(message(staffId, { text: { content: '我的待办' } }));
    expect(outbound[0].body).toMatchObject({ cardTemplateId: 'synthetic-evaluation', cardData: { cardParamMap: {
      primaryText: '填写本期评价', primaryUrl: `https://hrm.example/tasks/${data.task.id}/periods/${data.period.id}`,
    } } });
  });

  it.each(['allowlist', 'wrong enterprise', 'group', 'nonparticipant', 'unapproved goal', 'inactive employment'])('rejects out-of-scope before model: %s', async reason => {
    const data = await fixture();
    if (reason === 'allowlist') await config.setAllowlist([], administrator.id);
    if (reason === 'nonparticipant') await prisma.assessmentTask.update({ where: { id: data.task.id }, data: { isExempt: true } });
    if (reason === 'unapproved goal') await prisma.assessmentTask.update({ where: { id: data.task.id }, data: { indicatorConfirmedAt: null } });
    if (reason === 'inactive employment') await prisma.employmentRecord.updateMany({ where: { userId: data.employee.id }, data: { effectiveTo: new Date('2020-01-02') } });
    await receive(message(data.staffId, reason === 'wrong enterprise' ? { senderCorpId: 'foreign' } : reason === 'group' ? { conversationType: '2' } : {}));
    expect(provider.recognize).not.toHaveBeenCalled();
    expect(outbound.filter(item => item.url.endsWith('createAndDeliver'))).toHaveLength(0);
    if (['allowlist', 'wrong enterprise', 'group', 'inactive employment'].includes(reason)) {
      expect(outbound).toEqual([]);
    }
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: data.indicator.id } })).toBe(0);
  });

  it('limits all trial messages to one allowed identity and silently rejects a revoked old card', async () => {
    const colleague = await fixture();
    const colleagueDraft = await prepare(colleague);
    const owner = await fixture(); // Replaces the allowlist with only this synthetic owner.
    expect((await config.getPublicState()).allowlist).toEqual([owner.employee.id]);
    outbound.length = 0;
    recognize.mockClear();
    stream.send.mockClear();
    const before = await assessmentEvidence(colleague.task.id);
    for (const changes of [
      {}, { msgtype: 'image' }, { text: { content: '' } }, { text: { content: '帮助' } },
      { text: { content: '我的待办' } }, { text: { content: '我的目标' } },
      { text: { content: '我的自评' } }, { text: { content: '我的结果' } },
    ]) await receive(message(colleague.staffId, changes));
    await receive(saveCard(colleagueDraft, colleague.staffId));
    await receive(saveCard(randomUUID(), colleague.staffId));
    await app.get(DingtalkCardPresenter).markSaved(colleagueDraft, { content: '不应发送' } as any);
    expect(outbound).toEqual([]);
    expect(stream.send.mock.calls.every(([, result]) => JSON.stringify(result) === '{}')).toBe(true);
    expect(provider.recognize).not.toHaveBeenCalled();
    expect(await assessmentEvidence(colleague.task.id)).toEqual(before);
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: colleague.indicator.id } })).toBe(0);
    await receive(message(owner.staffId, { text: { content: '我的目标' } }));
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body.openSpaceId).toBe(`dtv1.card//IM_ROBOT.${owner.staffId}`);
    expect(JSON.stringify(outbound)).not.toContain(colleague.staffId);
  });

  it('enforces admin-only configuration with real JWT roles, encrypted storage and audited changes', async () => {
    const before = await prisma.aiProviderCredential.findUniqueOrThrow({ where: { provider: 'kimi' } });
    const audits = await prisma.auditLog.count({ where: { entityType: 'ai_progress_config' } });
    for (const user of [other, manager, hr]) {
      await http(user).get('/ai-progress/config').expect(403);
      await http(user).put('/ai-progress/config/providers/kimi').send({ modelId: 'forbidden-model' }).expect(403);
      await http(user).post('/ai-progress/config/providers/kimi/test').expect(403);
      await http(user).post('/ai-progress/config/providers/kimi/activate').expect(403);
      await http(user).patch('/ai-progress/config/bot').send({ enabled: false }).expect(403);
      await http(user).put('/ai-progress/config/allowlist').send({ userIds: [] }).expect(403);
    }
    expect(await prisma.aiProviderCredential.findUniqueOrThrow({ where: { provider: 'kimi' } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { entityType: 'ai_progress_config' } })).toBe(audits);
    expect(provider.recognize).not.toHaveBeenCalled();
    const state = await http(administrator).get('/ai-progress/config').expect(200);
    expect(state.body.data).toMatchObject({ activeProvider: 'kimi', botEnabled: true });
    expect(JSON.stringify(state.body)).not.toMatch(/synthetic-provider-key|encryptedKey|apiKey/);
    expect(before.encryptedKey.includes(Buffer.from('synthetic-provider-key'))).toBe(false);
    await http(administrator).put('/ai-progress/config/providers/kimi').send({ modelId: 'synthetic-model-2' }).expect(200);
    const changed = await prisma.aiProviderCredential.findUniqueOrThrow({ where: { provider: 'kimi' } });
    expect(changed.configVersion).toBe(before.configVersion + 1);
    expect(changed.encryptedKey).toEqual(before.encryptedKey);
    expect(changed.testedVersion).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: administrator.id, action: 'ai_provider_saved' }, orderBy: { createdAt: 'desc' } });
    expect(audit.newValue).toMatchObject({ provider: 'kimi', configVersion: changed.configVersion, credentialReplaced: false });
    expect(JSON.stringify(audit)).not.toMatch(/synthetic-provider-key|encryptedKey|apiKey/);
    expect(await config.getPublicState()).toMatchObject({ botEnabled: false, activeProvider: null });
    await http(administrator).post('/ai-progress/config/providers/kimi/activate').expect(400);
    await http(administrator).post('/ai-progress/config/providers/kimi/test').expect(201);
    await http(administrator).post('/ai-progress/config/providers/kimi/activate').expect(201);
    await http(administrator).patch('/ai-progress/config/bot').send({ enabled: true }).expect(200);
  });

  it('saves confirmed quantitative progress once', async () => {
    const data = await fixture();
    const before = await assessmentEvidence(data.task.id);
    const event = message(data.staffId);
    await receive(event);
    await receive(event);
    const cards = outbound.filter(item => item.url.endsWith('createAndDeliver'));
    expect(cards).toHaveLength(1);
    const draftId = cards[0].body.outTrackId;
    expect(cards[0].body).toMatchObject({ openSpaceId: `dtv1.card//IM_ROBOT.${data.staffId}`,
      imRobotOpenSpaceModel: { supportForward: false }, cardData: { cardParamMap: { completion: '120%（超额完成）', canSave: 'true' } } });
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    expect(providerInputs).toEqual([{ message: '已拜访12家', goals: [{ id: data.indicator.id, title: 'Synthetic client visits',
      targetValue: '10', unit: '家', periodId: data.period.id, periodKey }] }]);
    expect(await prisma.indicatorProgressUpdate.count({ where: { indicatorInstanceId: data.indicator.id } })).toBe(0);
    expect(await redis.ttl(`ai-progress:draft:${draftId}`)).toBeGreaterThan(86380);
    expect(await redis.ttl(`ai-progress:draft:${draftId}`)).toBeLessThanOrEqual(86400);
    await receive(saveCard(draftId, data.staffId));
    const cardRows = await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId } });
    expect(cardRows).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(1);
    await receive(saveCard(draftId, data.staffId));
    expect(await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId }, select: { id: true } }))
      .toEqual([{ id: cardRows[0].id }]);
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(1);
    const repeated = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    const rows = await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(cardRows[0].id);
    expect(repeated.body.data).toMatchObject({ id: cardRows[0].id, progress: 100, actualValue: 12,
      targetValueSnapshot: 10, completionPercent: 120, unitSnapshot: '家', content: '已拜访12家', source: 'active_progress' });
    expect(rows[0]).toMatchObject({ aiAssisted: true, createdBy: data.employee.id, periodId: data.period.id, periodReviewRevisionId: null });
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(1);
    expect(await assessmentEvidence(data.task.id)).toEqual(before);
    expect(provider.recognize).toHaveBeenCalledTimes(1);
    const saved = await http(data.employee).get(`/ai-progress/drafts/${draftId}`).expect(200);
    expect(saved.body.data).toMatchObject({ state: 'saved', canSave: false, saved: { id: rows[0].id } });
    for (const user of [data.employee, manager]) {
      const review = await http(user).get(`/assessment-periods/${data.period.id}/review`).expect(200);
      expect(review.body.data.indicators[0].progressReferences[0]).toMatchObject({ progress: 100,
        actualValue: 12, targetValueSnapshot: 10, unitSnapshot: '家', completionPercent: 120 });
      expect(review.body.data.indicators[0]).toMatchObject({ selfScore: null, managerScore: null });
    }
  });

  it('keeps qualitative completion empty', async () => {
    const data = await fixture(false);
    const draftId = await prepare(data);
    expect(outbound[0].body.cardData.cardParamMap.completion).toBe('');
    const saved = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    const detail = saved.body.data;
    expect(detail.progress).toBeNull();
    expect(detail).toMatchObject({ actualValue: null, completionPercent: null, targetValueSnapshot: null, healthStatus: 'completed' });
    const tracking = await http(data.employee).get(`/objectives/tracking/indicators/${data.indicator.id}`).expect(200);
    expect(tracking.body.data.progressUpdates[0]).toMatchObject({ id: detail.id, progress: null, completionPercent: null });
    for (const user of [data.employee, manager]) {
      const review = await http(user).get(`/assessment-periods/${data.period.id}/review`).expect(200);
      expect(review.body.data.indicators[0].progressReferences[0]).toMatchObject({ progress: null,
        actualValue: null, targetValueSnapshot: null, unitSnapshot: null, completionPercent: null });
    }
  });

  it('refreshes an old card from the saved page correction and never creates a second record', async () => {
    const data = await fixture();
    const draftId = await prepare(data);
    expect(outbound[0].body.cardData.cardParamMap).toMatchObject({ actualValue: '12', completion: '120%（超额完成）' });
    await http(data.employee).patch(`/ai-progress/drafts/${draftId}`).send({ content: '核对后实际9家', actualValue: '9', healthStatus: 'at_risk' }).expect(200);
    const saved = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    const expected = { state: '已保存', content: '核对后实际9家', actualValue: '9', targetValue: '10', unit: '家',
      healthStatus: '有风险', completion: '90%', canSave: 'false', editLabel: '查看进展' };
    expect(outbound.filter(item => item.url.endsWith('/card/instances')).at(-1)?.body.cardData.cardParamMap).toMatchObject(expected);
    const click = saveCard(draftId, data.staffId);
    await receive(click);
    expect(stream.send).toHaveBeenLastCalledWith(click.headers.messageId, expect.objectContaining({
      cardData: { cardParamMap: expect.objectContaining(expected) },
    }));
    expect(outbound.filter(item => item.url.endsWith('/card/instances')).at(-1)?.body.cardData.cardParamMap).toMatchObject(expected);
    expect(await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId }, select: { id: true } })).toEqual([{ id: saved.body.data.id }]);
  });

  it('keeps an HTTP save committed when the card update fails', async () => {
    const data = await fixture();
    const draftId = await prepare(data);
    fetchMock.mockRejectedValueOnce(new Error('synthetic transport unavailable'));
    const saved = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    expect(await prisma.indicatorProgressUpdate.count({ where: { aiDraftId: draftId } })).toBe(1);
    const retried = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    expect(retried.body.data.id).toBe(saved.body.data.id);
  });

  it('releases the real Redis draft lock when owner-detail lookup stalls and permits a safe retry', async () => {
    const data = await fixture();
    const draftId = await prepare(data);
    await prisma.externalIdentityBinding.updateMany({ where: { userId: data.employee.id }, data: { externalUserId: null } });
    dingtalk.fetchUserDetail.mockImplementationOnce(() => new Promise(() => undefined));
    const failed = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(403);
    expect(JSON.stringify(failed.body)).toContain('稍后重试');
    expect(await redis.get(`ai-progress:lock:${draftId}`)).toBeNull();
    expect(await prisma.indicatorProgressUpdate.count({ where: { aiDraftId: draftId } })).toBe(0);
    await prisma.externalIdentityBinding.updateMany({ where: { userId: data.employee.id }, data: { externalUserId: data.staffId } });
    await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    expect(await prisma.indicatorProgressUpdate.count({ where: { aiDraftId: draftId } })).toBe(1);
  });

  it('restricts drafts to their owner while the frozen manager can read saved monthly references', async () => {
    const data = await fixture();
    const draftId = await prepare(data);
    await request(app.getHttpServer()).get(`/api/v1/ai-progress/drafts/${draftId}`).expect(401);
    for (const denied of [manager, other, administrator]) {
      await http(denied).get(`/ai-progress/drafts/${draftId}`).expect(403);
      await http(denied).patch(`/ai-progress/drafts/${draftId}`).send({ content: 'forbidden' }).expect(403);
      await http(denied).post(`/ai-progress/drafts/${draftId}/save`).expect(403);
    }
    await receive(saveCard(draftId, 'synthetic-foreign-clicker'));
    expect(await prisma.indicatorProgressUpdate.count({ where: { aiDraftId: draftId } })).toBe(0);
    await http(data.employee).patch(`/ai-progress/drafts/${draftId}`).send({ content: '员工核对后修正', actualValue: '9', healthStatus: 'at_risk' }).expect(200);
    const saved = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    expect(saved.body.data).toMatchObject({ progress: 90, actualValue: 9, completionPercent: 90 });
    await prisma.employmentRecord.updateMany({ where: { userId: data.employee.id }, data: { directManagerId: other.id } });
    for (const user of [data.employee, manager]) {
      const review = await http(user).get(`/assessment-periods/${data.period.id}/review`).expect(200);
      expect(review.body.data.indicators[0].progressReferences).toEqual([expect.objectContaining({ id: saved.body.data.id,
        content: '员工核对后修正', progress: 90 })]);
      expect(review.body.data.indicators[0].selfScore).toBeNull();
    }
    await http(other).get(`/assessment-periods/${data.period.id}/review`).expect(403);
    await http(manager).patch(`/objectives/tracking/indicators/${data.indicator.id}/progress`)
      .send({ content: 'forbidden', progress: 20, healthStatus: 'on_track' }).expect(403);
    expect(provider.recognize).toHaveBeenCalledTimes(1);
  });

  async function assessmentEvidence(taskId: string) {
    return {
      task: await prisma.assessmentTask.findUnique({ where: { id: taskId } }),
      periods: await prisma.assessmentPeriod.findMany({ where: { taskId } }),
      reviews: await prisma.assessmentPeriodIndicatorReview.findMany({ where: { period: { taskId } } }),
      grades: await prisma.gradeResult.findMany({ where: { taskId } }),
      flow: await prisma.flowRecord.findMany({ where: { taskId } }),
    };
  }

  async function expectBlockedBy(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${pid}::int = ANY(pg_blocking_pids(pid))
      `;
      if (Number(rows[0].count) > 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected a real PostgreSQL wait on the suite-owned period row');
  }

  it.each([
    { periodType: 'month', submit: false, label: 'month lock' },
    { periodType: 'month', submit: true, label: 'month submission' },
    { periodType: 'cycle', submit: true, label: 'cycle submission' },
  ] as const)('rejects a confirmed save after waiting for concurrent $label', async ({ periodType, submit }) => {
    const data = await fixture();
    await prisma.assessmentPeriod.update({ where: { id: data.period.id }, data: { periodType } });
    const draftId = await prepare(data);
    const locked = signal();
    const release = signal();
    let pid = 0;
    const locking = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM assessment_periods WHERE id = ${data.period.id}::uuid FOR UPDATE`;
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      locked.resolve();
      await release.promise;
      await tx.assessmentPeriod.update({ where: { id: data.period.id }, data: submit
        ? { employeeSubmittedAt: new Date(), status: 'manager_scoring' }
        : { lockedAt: new Date() } });
    }, { timeout: 10000 });
    const lockOutcome = locking.catch(error => { locked.resolve(); throw error; });
    let save: Promise<request.Response> | undefined;
    try {
      await locked.promise;
      expect(pid).toBeGreaterThan(0);
      save = http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).then(response => response);
      await expectBlockedBy(pid);
    } finally {
      release.resolve();
      await lockOutcome;
    }
    expect((await save!).status).toBe(409);
    expect(await prisma.indicatorProgressUpdate.count({ where: { aiDraftId: draftId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(0);
  });

  it('serializes simultaneous card and HTTP confirmation and returns the committed row on retry', async () => {
    const data = await fixture();
    const draftId = await prepare(data);
    const locked = signal();
    const release = signal();
    let pid = 0;
    const blocking = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM assessment_periods WHERE id = ${data.period.id}::uuid FOR UPDATE`;
      pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      locked.resolve();
      await release.promise;
    }, { timeout: 10000 });
    const blockingOutcome = blocking.catch(error => { locked.resolve(); throw error; });
    let card: Promise<void> | undefined;
    try {
      await locked.promise;
      card = receive(saveCard(draftId, data.staffId));
      await expectBlockedBy(pid);
      await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(409);
    } finally {
      release.resolve();
      await blockingOutcome;
      await card;
    }
    const cardRows = await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId } });
    expect(cardRows).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(1);
    const retry = await http(data.employee).post(`/ai-progress/drafts/${draftId}/save`).expect(201);
    const rows = await prisma.indicatorProgressUpdate.findMany({ where: { aiDraftId: draftId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(cardRows[0].id);
    expect(retry.body.data.id).toBe(cardRows[0].id);
    expect(await prisma.auditLog.count({ where: { entityId: data.indicator.id, action: 'progress_update' } })).toBe(1);
  });
});
