export type Environment = Record<string, string | undefined>;

export function requireSeedWriteGate(env: Environment): { password: string } {
  if (env.ENABLE_REALISTIC_DEMO_SEED !== "true") {
    throw new Error(
      "realistic demo write disabled; set ENABLE_REALISTIC_DEMO_SEED=true",
    );
  }
  const password = env.REALISTIC_DEMO_ACCOUNT_PASSWORD;
  if (!password?.trim()) {
    throw new Error("REALISTIC_DEMO_ACCOUNT_PASSWORD is required");
  }
  return { password };
}

export function requireCleanGate(env: Environment): void {
  if (env.ENABLE_REALISTIC_DEMO_CLEAN !== "true") {
    throw new Error(
      "realistic demo cleanup disabled; set ENABLE_REALISTIC_DEMO_CLEAN=true",
    );
  }
}
