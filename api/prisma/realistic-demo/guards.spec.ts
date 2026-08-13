import { requireCleanGate, requireSeedWriteGate } from "./guards";

describe("realistic demo CLI guards", () => {
  it("rejects writes unless the seed gate is exactly true", () => {
    expect(() =>
      requireSeedWriteGate({ ENABLE_REALISTIC_DEMO_SEED: "false" }),
    ).toThrow(/ENABLE_REALISTIC_DEMO_SEED=true/);
  });

  it("requires a non-empty account password after the seed gate opens", () => {
    expect(() =>
      requireSeedWriteGate({ ENABLE_REALISTIC_DEMO_SEED: "true" }),
    ).toThrow(/REALISTIC_DEMO_ACCOUNT_PASSWORD/);

    expect(() =>
      requireSeedWriteGate({
        ENABLE_REALISTIC_DEMO_SEED: "true",
        REALISTIC_DEMO_ACCOUNT_PASSWORD: "   ",
      }),
    ).toThrow(/REALISTIC_DEMO_ACCOUNT_PASSWORD/);
  });

  it("returns the password without logging or transforming it", () => {
    expect(
      requireSeedWriteGate({
        ENABLE_REALISTIC_DEMO_SEED: "true",
        REALISTIC_DEMO_ACCOUNT_PASSWORD: "not-logged-by-test",
      }),
    ).toEqual({ password: "not-logged-by-test" });
  });

  it("rejects cleanup unless the clean gate is exactly true", () => {
    expect(() =>
      requireCleanGate({ ENABLE_REALISTIC_DEMO_CLEAN: "false" }),
    ).toThrow(/ENABLE_REALISTIC_DEMO_CLEAN=true/);
  });
});
