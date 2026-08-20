export type DemoHistoryEnvironment = Record<string, string | undefined>;

export function requireDemoHistorySeed(env: DemoHistoryEnvironment): { password: string } {
  if (env.ENABLE_DEMO_HISTORY_SEED !== 'true') {
    throw new Error('demo history write disabled; set ENABLE_DEMO_HISTORY_SEED=true');
  }
  const password = env.DEMO_HISTORY_ACCOUNT_PASSWORD;
  if (!password?.trim()) {
    throw new Error('DEMO_HISTORY_ACCOUNT_PASSWORD is required');
  }
  return { password };
}
