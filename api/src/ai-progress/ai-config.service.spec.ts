import { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';
import { ProviderClient } from './provider-client';

const operator = '00000000-0000-4000-8000-000000000001';
const member = '00000000-0000-4000-8000-000000000002';
const key = 'synthetic-provider-key';

// Persistence and HTTP are external; exercise the real service, crypto and provider adapter.
function database() {
  const credentials = new Map<string, any>();
  const settings = new Map<string, any>();
  const audits: any[] = [];
  const db: any = {
    aiProviderCredential: {
      findUnique: async ({ where }: any) => credentials.get(where.provider) ?? null,
      findMany: async () => [...credentials.values()],
      upsert: async ({ where, create, update }: any) => {
        const old = credentials.get(where.provider);
        const next = old
          ? { ...old, ...update, configVersion: old.configVersion + 1 }
          : { ...create };
        credentials.set(where.provider, next);
        return next;
      },
      updateMany: async ({ where, data }: any) => {
        const old = credentials.get(where.provider);
        if (!old || old.configVersion !== where.configVersion) return { count: 0 };
        credentials.set(where.provider, { ...old, ...data });
        return { count: 1 };
      },
    },
    systemConfig: {
      findUnique: async ({ where }: any) => settings.get(where.key) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const next = settings.has(where.key) ? { ...settings.get(where.key), ...update } : create;
        settings.set(where.key, next);
        return next;
      },
    },
    user: {
      count: async ({ where }: any) => where.id.in.filter((id: string) => id === member).length,
    },
    auditLog: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: any) => fn(db),
  };
  return { db, credentials, settings, audits };
}

describe('AiConfigService', () => {
  let storage: ReturnType<typeof database>;
  let master: string | undefined;
  let service: AiConfigService;
  let fetchSpy: jest.SpyInstance;
  const response = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                indicatorId: 'synthetic-goal',
                content: '样例进展',
                actualValue: '2',
                healthStatus: null,
                uncertain: false,
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );

  beforeEach(() => {
    storage = database();
    master = Buffer.alloc(32, 7).toString('base64');
    service = new AiConfigService(
      storage.db,
      {
        get: (name: string) => (name === 'AI_PROVIDER_ENCRYPTION_KEY' ? master : undefined),
      } as ConfigService,
      new ProviderClient(),
    );
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => response());
  });
  afterEach(() => jest.restoreAllMocks());

  async function ready(provider: 'kimi' | 'deepseek' | 'qwen' = 'kimi') {
    await service.saveProvider(provider, { apiKey: key, modelId: 'sample-model' }, operator);
    await service.testProvider(provider, operator);
    await service.activate(provider, operator);
  }

  it('does not activate stale or untested provider', async () => {
    await service.saveProvider('kimi', { apiKey: key, modelId: 'sample-model' }, operator);
    await expect(service.activate('kimi', operator)).rejects.toThrow();
    const state = await service.getPublicState();
    expect(state.activeProvider).toBeNull();
    expect(JSON.stringify(state)).not.toContain('apiKey');
    await ready();
    await service.saveProvider('kimi', { modelId: 'changed-model' }, operator);
    await expect(service.activate('kimi', operator)).rejects.toThrow();
    expect((await service.getPublicState()).activeProvider).toBeNull();
  });

  it('defaults OFF and returns decrypted credentials only to the enabled runtime', async () => {
    expect((await service.getPublicState()).botEnabled).toBe(false);
    await ready();
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    await service.setBotEnabled(true, operator);
    expect(await service.getActiveRuntimeConfig()).toMatchObject({
      provider: 'kimi',
      apiKey: key,
      modelId: 'sample-model',
      configVersion: 1,
    });
    await service.setBotEnabled(false, operator);
    expect(await service.getActiveRuntimeConfig()).toBeNull();
  });

  it('encrypts with authenticated randomized encryption and never serializes keys or ciphertext', async () => {
    await ready();
    const first = Buffer.from(storage.credentials.get('kimi').encryptedKey);
    expect(first.includes(Buffer.from(key))).toBe(false);
    await service.saveProvider('kimi', { apiKey: key, modelId: 'sample-model' }, operator);
    expect(Buffer.from(storage.credentials.get('kimi').encryptedKey).equals(first)).toBe(false);
    const json = JSON.stringify(await service.getPublicState());
    expect(json).not.toContain(key);
    expect(json).not.toContain('encryptedKey');
    expect(json).not.toContain('apiKey');
    expect(JSON.stringify(storage.audits)).not.toContain(key);
    expect(JSON.stringify(storage.audits)).not.toContain('encryptedKey');
    expect(storage.audits.map((a) => a.userId)).toEqual(expect.arrayContaining([operator]));
  });

  it.each([
    undefined,
    '',
    'not-base64',
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
  ])('fails closed for invalid master key %s', async (value) => {
    await ready();
    await service.setBotEnabled(true, operator);
    master = value;
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    expect((await service.getPublicState()).botEnabled).toBe(false);
    await expect(service.setBotEnabled(true, operator)).rejects.toThrow();
    await expect(
      service.saveProvider('kimi', { apiKey: key, modelId: 'sample-model' }, operator),
    ).rejects.toThrow();
  });

  it('rejects a wrong master key or tampered ciphertext without leaking crypto details', async () => {
    await ready();
    await service.setBotEnabled(true, operator);
    master = Buffer.alloc(32, 8).toString('base64');
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    expect((await service.getPublicState()).botEnabled).toBe(false);
    await expect(service.activate('kimi', operator)).rejects.toThrow('凭据不可用');
    master = Buffer.alloc(32, 7).toString('base64');
    storage.credentials.get('kimi').encryptedKey[15] ^= 1;
    expect(await service.getActiveRuntimeConfig()).toBeNull();
  });

  it.each([
    { apiKey: 'replacement-synthetic-key', modelId: 'sample-model' },
    { modelId: 'different-model' },
    { modelId: 'sample-model', region: 'ap-southeast-1' },
    { modelId: 'sample-model', workspaceId: 'sample-workspace' },
  ])('invalidates testing after each credential/config edit: %j', async (dto) => {
    await ready('qwen');
    await service.setBotEnabled(true, operator);
    await service.saveProvider('qwen', dto, operator);
    expect(
      (await service.getPublicState()).providers.find((p) => p.provider === 'qwen'),
    ).toMatchObject({ configVersion: 2, tested: false });
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    await expect(service.activate('qwen', operator)).rejects.toThrow();
  });

  it('tests only synthetic content and binds success to the captured version', async () => {
    await service.saveProvider('kimi', { apiKey: key, modelId: 'sample-model' }, operator);
    let finish!: (value: Response) => void;
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const testing = service.testProvider('kimi', operator);
    while (!finish) await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      message: '连接测试：样例目标已完成2项。',
      goals: [
        {
          id: 'synthetic-goal',
          title: '样例目标',
          targetValue: '10',
          unit: '项',
          periodId: null,
          periodKey: null,
        },
      ],
    });
    await service.saveProvider('kimi', { modelId: 'changed-model' }, operator);
    finish(response());
    expect(await testing).toMatchObject({
      success: false,
      errorCode: 'config_changed',
    });
    await expect(service.activate('kimi', operator)).rejects.toThrow();
  });

  it('returns only safe provider errors and revokes a previously successful test on failure', async () => {
    await ready();
    await service.setBotEnabled(true, operator);
    fetchSpy.mockRejectedValue(new Error('unsafe-provider-detail ' + key));
    expect(await service.testProvider('kimi', operator)).toMatchObject({
      success: false,
      errorCode: 'provider_failed',
    });
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    expect(JSON.stringify(storage.audits)).not.toContain('unsafe-provider-detail');
    expect(JSON.stringify(storage.audits)).not.toContain(key);
    await expect(service.activate('kimi', operator)).rejects.toThrow();
  });

  it('accepts only existing HRM user UUIDs, and audits the count without the list', async () => {
    await service.setAllowlist([member], operator);
    expect((await service.getPublicState()).allowlist).toEqual([member]);
    expect(JSON.stringify(storage.audits)).not.toContain(member);
    await expect(service.setAllowlist(['dingtalk-staff-id'], operator)).rejects.toThrow();
    await expect(service.setAllowlist([operator], operator)).rejects.toThrow();
    await service.setAllowlist([], operator);
    expect((await service.getPublicState()).allowlist).toEqual([]);
  });

  it('does not enable without a tested active provider or accept arbitrary provider/region', async () => {
    await expect(service.setBotEnabled(true, operator)).rejects.toThrow();
    await expect(
      service.saveProvider('other' as any, { apiKey: key, modelId: 'sample-model' }, operator),
    ).rejects.toThrow();
    await expect(
      service.saveProvider(
        'qwen',
        {
          apiKey: key,
          modelId: 'sample-model',
          region: 'https://example.invalid',
        },
        operator,
      ),
    ).rejects.toThrow();
    await expect(
      service.saveProvider(
        'kimi',
        { apiKey: key, modelId: 'sample-model', region: 'cn-beijing' },
        operator,
      ),
    ).rejects.toThrow();
  });

  it('switches subsequent runtime reads to the selected provider without enabling a stopped bot', async () => {
    await ready();
    await ready('deepseek');
    expect(await service.getActiveRuntimeConfig()).toBeNull();
    await service.setBotEnabled(true, operator);
    expect(await service.getActiveRuntimeConfig()).toMatchObject({
      provider: 'deepseek',
    });
    await service.activate('kimi', operator);
    expect(await service.getActiveRuntimeConfig()).toMatchObject({
      provider: 'kimi',
    });
    expect(
      (await service.getPublicState()).providers
        .filter((row) => row.active)
        .map((row) => row.provider),
    ).toEqual(['kimi']);
  });

  it('masks persistence failures so API exceptions cannot expose stored credentials', async () => {
    storage.db.aiProviderCredential.upsert = async () => {
      throw new Error('database debug encryptedKey ' + key);
    };
    await expect(
      service.saveProvider('kimi', { apiKey: key, modelId: 'sample-model' }, operator),
    ).rejects.toThrow('AI 配置暂时不可用');
    storage.db.aiProviderCredential.findMany = async () => {
      throw new Error('database debug encryptedKey ' + key);
    };
    await expect(service.getPublicState()).rejects.toThrow('AI 配置暂时不可用');
  });
});
