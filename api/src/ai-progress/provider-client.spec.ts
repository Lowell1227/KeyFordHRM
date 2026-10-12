import { Logger } from '@nestjs/common';
import { ProviderClient } from './provider-client';

const input = {
  message: '样例目标已完成12件',
  goals: [
    {
      id: 'sample-goal',
      title: '样例目标',
      targetValue: '10',
      unit: '件',
      periodId: 'sample-month',
      periodKey: '2026-10',
    },
  ],
};
const config = {
  provider: 'kimi' as const,
  apiKey: 'synthetic-test-key',
  modelId: 'kimi-k2.6',
};
const candidate = {
  indicatorId: 'sample-goal',
  content: '样例目标已完成12件',
  actualValue: '12',
  healthStatus: 'on_track',
  uncertain: false,
};
function response(value: unknown = candidate, finishReason = 'stop') {
  return new Response(
    JSON.stringify({
      id: 'sample-completion',
      object: 'chat.completion',
      created: 1,
      model: 'sample-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(value) },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

describe('ProviderClient', () => {
  let client: ProviderClient;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    client = new ProviderClient();
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response());
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    ['kimi', 'kimi-k2.6', 'https://api.moonshot.cn/v1/chat/completions'],
    ['deepseek', 'deepseek-flash', 'https://api.deepseek.com/chat/completions'],
    ['qwen', 'qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ] as const)('recognizes through the fixed %s text endpoint', async (provider, modelId, url) => {
    expect(await client.recognize(input, { ...config, provider, modelId })).toEqual(candidate);
    const [target, options] = fetchMock.mock.calls[0];
    expect(target).toBe(url);
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer synthetic-test-key' },
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: modelId,
      stream: false,
      response_format: { type: 'json_object' },
    });
  });

  it('sends only current text and projected own-goal fields', async () => {
    await client.recognize(
      {
        ...input,
        history: ['excluded'],
        goals: [{ ...input.goals[0], salary: 'excluded', owner: 'excluded' }],
      } as any,
      config,
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(body).not.toHaveProperty('tools');
    expect(body).toMatchObject({
      max_tokens: 2048,
      thinking: { type: 'disabled' },
    });
  });

  it('uses the documented K3 token parameter without an unsupported thinking switch', async () => {
    await client.recognize(input, { ...config, modelId: 'kimi-k3' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      max_completion_tokens: 2048,
      reasoning_effort: 'low',
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('disables DeepSeek default thinking for a bounded text extraction request', async () => {
    await client.recognize(input, {
      ...config,
      provider: 'deepseek',
      modelId: 'deepseek-flash',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      thinking: { type: 'disabled' },
      max_tokens: 2048,
    });
  });

  it.each([
    'cn-beijing',
    'ap-southeast-1',
    'us-east-1',
    'eu-central-1',
    'ap-northeast-1',
    'cn-hongkong',
  ])('uses the controlled Qwen %s workspace host', async (region) => {
    await client.recognize(input, {
      ...config,
      provider: 'qwen',
      modelId: 'qwen-plus',
      region,
      workspaceId: 'sample123',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://sample123.${region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      enable_thinking: false,
    });
  });

  it.each([
    { region: 'https://foreign.invalid' },
    { region: '__proto__' },
    { workspaceId: 'space.foreign.invalid' },
    { workspaceId: 'space/path' },
    { workspaceId: '-bad' },
    { region: 'eu-central-1' },
  ])('rejects untrusted or incomplete region/workspace config %j before sending', async (extra) => {
    await expect(
      client.recognize(input, { ...config, provider: 'qwen', ...extra }),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept foreign indicator or fail over on provider error', async () => {
    const otherProviderFetch = jest.fn();
    fetchMock.mockImplementation(async (url) => {
      if (url !== 'https://api.moonshot.cn/v1/chat/completions') return otherProviderFetch(url);
      return response({ ...candidate, indicatorId: 'foreign-goal' });
    });
    const result = await client.recognize(input, config);
    expect(result.indicatorId).toBeNull();
    expect(result.uncertain).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response('sensitive-provider-body', { status: 429 }));
    await expect(client.recognize(input, config)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(otherProviderFetch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears ambiguous goal selection and keeps missing qualitative fields nullable', async () => {
    fetchMock.mockResolvedValue(
      response({
        ...candidate,
        uncertain: true,
        actualValue: null,
        healthStatus: null,
      }),
    );
    expect(await client.recognize(input, config)).toEqual({
      ...candidate,
      indicatorId: null,
      uncertain: true,
      actualValue: null,
      healthStatus: null,
    });
  });

  it('marks an unmatched goal uncertain even if the model claims certainty', async () => {
    fetchMock.mockResolvedValue(response({ ...candidate, indicatorId: null }));
    expect(await client.recognize(input, config)).toMatchObject({
      indicatorId: null,
      uncertain: true,
    });
  });

  it.each(['-1', '1e2', 'NaN', 'Infinity', '1.234', '100000000', ' 12', 12, ''])(
    'rejects invalid decimal %j',
    async (actualValue) => {
      fetchMock.mockResolvedValue(response({ ...candidate, actualValue }));
      await expect(client.recognize(input, config)).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );

  it.each(['0', '99999999.99', '12.50'])(
    'preserves valid decimal strings %s',
    async (actualValue) => {
      fetchMock.mockResolvedValue(response({ ...candidate, actualValue }));
      expect(await client.recognize(input, config)).toMatchObject({
        actualValue,
      });
    },
  );

  it.each([
    { healthStatus: 'unknown' },
    { uncertain: 'false' },
    { content: '' },
    { content: 'x'.repeat(10001) },
    { content: null },
    { indicatorId: ['sample-goal'] },
    { actualValue: undefined },
    { extra: 'unexpected' },
  ])('rejects malformed candidate fields (case %#)', async (changes) => {
    fetchMock.mockResolvedValue(response({ ...candidate, ...changes }));
    await expect(client.recognize(input, config)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it.each(['at_risk', 'blocked', 'completed', null])(
    'accepts documented status %s',
    async (healthStatus) => {
      fetchMock.mockResolvedValue(response({ ...candidate, healthStatus }));
      expect(await client.recognize(input, config)).toMatchObject({
        healthStatus,
      });
    },
  );

  it.each(['length', 'tool_calls', 'content_filter'])(
    'rejects incomplete or non-text finish %s',
    async (reason) => {
      fetchMock.mockResolvedValue(response(candidate, reason));
      await expect(client.recognize(input, config)).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );

  it.each([
    'not-json',
    JSON.stringify({ choices: [] }),
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: '```json\n{}\n```' },
        },
      ],
    }),
  ])('rejects malformed envelope or candidate JSON', async (text) => {
    fetchMock.mockResolvedValue(new Response(text));
    await expect(client.recognize(input, config)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects an oversized response without trusting Content-Length', async () => {
    fetchMock.mockResolvedValue(
      new Response('x'.repeat(65537), { headers: { 'Content-Length': '1' } }),
    );
    await expect(client.recognize(input, config)).rejects.toMatchObject({
      code: 'response_too_large',
    });
  });

  it('rejects malformed UTF-8 as an invalid model response', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe])));
    await expect(client.recognize(input, config)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it.each([
    { ...input, message: 'x'.repeat(10001) },
    { ...input, message: ' ' },
    { ...input, goals: [] },
  ])('rejects invalid input before an external call', async (badInput) => {
    await expect(client.recognize(badInput, config)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...config, provider: 'unknown' },
    { ...config, apiKey: '' },
    { ...config, modelId: 'https://foreign.invalid' },
    { ...config, region: 'cn-beijing' },
  ])('rejects invalid provider config before an external call', async (badConfig) => {
    await expect(client.recognize(input, badConfig as any)).rejects.toMatchObject({
      code: 'invalid_config',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentication_failed'],
    [403, 'authentication_failed'],
    [429, 'rate_limited'],
    [500, 'provider_failed'],
    [302, 'provider_failed'],
  ] as const)('sanitizes HTTP %s without retry, fallback or logging', async (status, code) => {
    const spies = [
      jest.spyOn(console, 'log'),
      jest.spyOn(console, 'error'),
      jest.spyOn(console, 'warn'),
      jest.spyOn(Logger.prototype, 'error'),
      jest.spyOn(Logger.prototype, 'warn'),
      jest.spyOn(Logger.prototype, 'log'),
    ].map((spy) => spy.mockImplementation(() => undefined));
    fetchMock.mockResolvedValue(
      new Response('synthetic-test-key sensitive-provider-body', { status }),
    );
    const error = await client.recognize(input, config).catch((error) => error);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toMatch(/synthetic-test-key|sensitive-provider-body|样例目标/);
    expect(error).not.toHaveProperty('cause');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('sanitizes network errors with no raw cause', async () => {
    fetchMock.mockRejectedValue(new Error('synthetic-test-key sensitive-provider-body'));
    const error = await client.recognize(input, config).catch((error) => error);
    expect(error).toMatchObject({ code: 'provider_failed' });
    expect(String(error)).not.toContain('synthetic-test-key');
    expect(error).not.toHaveProperty('cause');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['headers', 'body'])(
    'times out while waiting for %s and aborts the selected call',
    async (stage) => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(() =>
        stage === 'headers'
          ? new Promise(() => {})
          : Promise.resolve(
              new Response(new ReadableStream({ pull: () => new Promise(() => {}) })),
            ),
      );
      const pending = client.recognize(input, config);
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'timeout',
      });
      await jest.advanceTimersByTimeAsync(20000);
      await assertion;
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
