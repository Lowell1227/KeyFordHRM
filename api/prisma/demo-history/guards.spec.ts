import { requireDemoHistorySeed } from './guards';

describe('demo history seed guards', () => {
  it('未显式开启时拒绝写入', () => {
    expect(() => requireDemoHistorySeed({ ENABLE_DEMO_HISTORY_SEED: 'false' })).toThrow(
      /ENABLE_DEMO_HISTORY_SEED=true/,
    );
  });

  it('开启后仍要求运行时密码', () => {
    expect(() => requireDemoHistorySeed({ ENABLE_DEMO_HISTORY_SEED: 'true' })).toThrow(
      /DEMO_HISTORY_ACCOUNT_PASSWORD/,
    );
    expect(() => requireDemoHistorySeed({
      ENABLE_DEMO_HISTORY_SEED: 'true',
      DEMO_HISTORY_ACCOUNT_PASSWORD: '  ',
    })).toThrow(/DEMO_HISTORY_ACCOUNT_PASSWORD/);
  });

  it('只把密码返回给调用方且不做持久化', () => {
    expect(requireDemoHistorySeed({
      ENABLE_DEMO_HISTORY_SEED: 'true',
      DEMO_HISTORY_ACCOUNT_PASSWORD: 'runtime-only-secret',
    })).toEqual({ password: 'runtime-only-secret' });
  });
});
