import { requireCleanGate, requireSeedWriteGate } from "./guards";
import {
  EXTERNAL_E2E_DISPOSABLE_MARKER,
  prepareExternalE2EDatabase,
} from "../../test/database-safety";

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

  it("rejects an external E2E database before migration or seed without a disposable marker", () => {
    const migrateAndSeed = jest.fn();

    expect(() =>
      prepareExternalE2EDatabase(
        "postgresql://postgres:postgres@localhost:5432/hrm_e2e",
        {},
        migrateAndSeed,
      ),
    ).toThrow(/E2E_EXTERNAL_DATABASE_DISPOSABLE/);
    expect(migrateAndSeed).not.toHaveBeenCalled();

    prepareExternalE2EDatabase(
      "postgresql://postgres:postgres@localhost:5432/hrm_e2e",
      { E2E_EXTERNAL_DATABASE_DISPOSABLE: EXTERNAL_E2E_DISPOSABLE_MARKER },
      migrateAndSeed,
    );
    expect(migrateAndSeed).toHaveBeenCalledTimes(1);
  });
});
