import { ConfigService } from "@nestjs/config";
import { SystemConfigurationsService } from "./system-configurations.service";
import { RuntimeSettingsService } from "./runtime-settings.service";

function fixture() {
  const rows = new Map<string, any>();
  const audits: any[] = [];
  const actor = {
    id: "admin",
    sysRole: "system_admin",
    status: "active",
    deletedAt: null,
    archivedAt: null,
    isAssessorOnly: false,
  };
  const prisma: any = {
    systemConfig: {
      findUnique: jest.fn(
        async ({ where }: any) => rows.get(where.key) ?? null,
      ),
      findMany: jest.fn(async () => [...rows.values()]),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const row = { ...(rows.get(where.key) ?? create), ...update };
        rows.set(where.key, row);
        return row;
      }),
    },
    user: { findFirst: jest.fn(async () => actor) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
      }),
    },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  prisma.$transaction = jest.fn(async (work: any) => work(prisma));
  const config = new ConfigService({
    AI_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    DINGTALK_APP_KEY: "deployment-app",
    DINGTALK_APP_SECRET: "deployment-secret",
  });
  const runtime = new RuntimeSettingsService(prisma, config);
  const ai: any = {
    getProviderRuntimeConfig: jest.fn(async () => ({ provider: "deepseek" })),
  };
  const service = new SystemConfigurationsService(prisma, config, runtime, ai);
  return { service, runtime, rows, audits, actor, prisma, config, ai };
}

describe("administrator configuration drafts and runtime", () => {
  it("encrypts saved values, omits secrets and keeps drafts out of runtime", async () => {
    const f = fixture();
    const view = await f.service.save(
      "dingtalk-app",
      {
        expectedRevision: 0,
        values: {
          DINGTALK_APP_KEY: "draft-app",
          DINGTALK_APP_SECRET: "private-secret",
        },
      },
      "admin",
    );
    expect(view.revision).toBe(1);
    expect(JSON.stringify(view)).not.toContain("private-secret");
    expect(JSON.stringify([...f.rows.values()])).not.toContain(
      "private-secret",
    );
    expect(JSON.stringify(f.audits)).not.toContain("draft-app");
    expect(f.runtime.get("DINGTALK_APP_KEY")).toBe("deployment-app");
    const updated = await f.service.save(
      "dingtalk-app",
      {
        expectedRevision: 1,
        values: { DINGTALK_AGENT_ID: "42", DINGTALK_APP_SECRET: "" },
      },
      "admin",
    );
    expect(
      updated.fields.find((field) => field.key === "DINGTALK_APP_SECRET")
        ?.configured,
    ).toBe(true);
    expect(
      updated.fields.find((field) => field.key === "DINGTALK_APP_SECRET"),
    ).not.toHaveProperty("value");
  });

  it("rejects unknown keys, unknown groups, stale revisions and revoked administrators", async () => {
    const f = fixture();
    await expect(
      f.service.save("unknown", { expectedRevision: 0, values: {} }, "admin"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.save(
        "ai-resume",
        { expectedRevision: 0, values: { JWT_SECRET: "bad" } },
        "admin",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await f.service.save(
      "ai-resume",
      { expectedRevision: 0, values: { AI_RESUME_PARSING_ENABLED: false } },
      "admin",
    );
    await expect(
      f.service.save("ai-resume", { expectedRevision: 0, values: {} }, "admin"),
    ).rejects.toMatchObject({ status: 409 });
    f.actor.sysRole = "employee";
    await expect(f.service.get("ai-resume", "admin")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      f.service.apply("ai-resume", { expectedRevision: 1 }, "admin"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires current verification, applies explicitly and restores only applied state after restart", async () => {
    const f = fixture();
    await f.service.save(
      "ai-resume",
      { expectedRevision: 0, values: { AI_RESUME_PARSING_ENABLED: true } },
      "admin",
    );
    await expect(
      f.service.apply("ai-resume", { expectedRevision: 1 }, "admin"),
    ).rejects.toMatchObject({ status: 400 });
    const tested = await f.service.test(
      "ai-resume",
      { expectedRevision: 1 },
      "admin",
    );
    expect(tested.verification).toBe("passed");
    expect(tested.testKind).toBe("configuration");
    await f.service.apply("ai-resume", { expectedRevision: 1 }, "admin");
    expect(f.runtime.get("AI_RESUME_PARSING_ENABLED")).toBe("true");
    await f.service.save(
      "ai-resume",
      { expectedRevision: 1, values: { AI_RESUME_PARSING_ENABLED: false } },
      "admin",
    );
    const restarted = new RuntimeSettingsService(f.prisma, f.config);
    await restarted.onModuleInit();
    expect(restarted.get("AI_RESUME_PARSING_ENABLED")).toBe("true");
    expect((await f.service.get("ai-resume", "admin")).verification).toBe(
      "untested",
    );
  });

  it("fails closed on unreadable applied ciphertext instead of environment fallback", async () => {
    const f = fixture();
    await f.service.save(
      "ai-resume",
      { expectedRevision: 0, values: { AI_RESUME_PARSING_ENABLED: false } },
      "admin",
    );
    await f.service.test("ai-resume", { expectedRevision: 1 }, "admin");
    await f.service.apply("ai-resume", { expectedRevision: 1 }, "admin");
    const row = [...f.rows.values()][0];
    row.value.applied = "broken";
    const restarted = new RuntimeSettingsService(f.prisma, f.config);
    await restarted.onModuleInit();
    expect(() => restarted.get("AI_RESUME_PARSING_ENABLED", "true")).toThrow(
      "配置不可读取",
    );
  });

  it("keeps other mailbox editors available when one draft is unreadable", async () => {
    const f = fixture();
    const first = await f.service.createMailbox("admin");
    const second = await f.service.createMailbox("admin");
    f.rows.get("integration_configuration:" + first.id).value.draft = "corrupt";
    const list = await f.service.mailboxes("admin");
    expect(list.find((row) => row.id === first.id)?.verification).toBe(
      "unknown",
    );
    expect(list.find((row) => row.id === second.id)?.revision).toBe(1);
  });

  it("does not advertise public DingTalk login in the isolated preview", () => {
    const f = fixture();
    const config = new ConfigService({
      HRM_PREVIEW: "true",
      DINGTALK_CORP_ID: "corp",
      DINGTALK_APP_KEY: "app",
      DINGTALK_APP_SECRET: "private",
    });
    const runtime = new RuntimeSettingsService(f.prisma, config);
    const service = new SystemConfigurationsService(
      f.prisma,
      config,
      runtime,
      f.ai,
    );
    expect(service.publicLogin().enabled).toBe(false);
  });

  it("rejects an invalid service provider and does not permit client-supplied legacy metadata", async () => {
    const f = fixture();
    const view = await f.service.createMailbox("admin");
    await expect(
      f.service.save(
        view.id,
        {
          expectedRevision: 1,
          values: { RECRUITMENT_MAIL_PROVIDER: "custom-host" },
        },
        "admin",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.save(
        view.id,
        { expectedRevision: 1, values: { __legacyMailboxScope: "forged" } },
        "admin",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("cannot attach a slow verification result to a newer draft or revoked account", async () => {
    const f = fixture();
    await f.service.save(
      "ai-resume",
      { expectedRevision: 0, values: { AI_RESUME_PARSING_ENABLED: true } },
      "admin",
    );
    f.ai.getProviderRuntimeConfig.mockImplementationOnce(async () => {
      await f.service.save(
        "ai-resume",
        { expectedRevision: 1, values: { AI_RESUME_PARSING_ENABLED: false } },
        "admin",
      );
      return { provider: "deepseek" };
    });
    await expect(
      f.service.test("ai-resume", { expectedRevision: 1 }, "admin"),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.service.get("ai-resume", "admin")).verification).toBe(
      "untested",
    );
    await f.service.save(
      "ai-resume",
      { expectedRevision: 2, values: { AI_RESUME_PARSING_ENABLED: true } },
      "admin",
    );
    f.ai.getProviderRuntimeConfig.mockImplementationOnce(async () => {
      f.actor.sysRole = "employee";
      return { provider: "deepseek" };
    });
    await expect(
      f.service.test("ai-resume", { expectedRevision: 3 }, "admin"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("checks committed shared application state even before its runtime callback installs it", async () => {
    const f = fixture();
    await f.service.save(
      "dingtalk-calendar",
      {
        expectedRevision: 0,
        values: { DINGTALK_INTERVIEW_CALENDAR_ENABLED: false },
      },
      "admin",
    );
    await f.service.test("dingtalk-calendar", { expectedRevision: 1 }, "admin");
    await f.service.save(
      "dingtalk-app",
      { expectedRevision: 0, values: { DINGTALK_APP_KEY: "replacement-app" } },
      "admin",
    );
    const row = f.rows.get("integration_configuration:dingtalk-app");
    row.value.applied = row.value.draft;
    row.value.appliedRevision = row.value.revision;
    expect(f.runtime.get("DINGTALK_APP_KEY")).toBe("deployment-app");
    await expect(
      f.service.apply("dingtalk-calendar", { expectedRevision: 1 }, "admin"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps dependent drafts and unrelated editors readable when the shared applied identity is corrupt", async () => {
    const f = fixture();
    await f.service.save(
      "dingtalk-app",
      { expectedRevision: 0, values: {} },
      "admin",
    );
    await f.service.save(
      "dingtalk-calendar",
      {
        expectedRevision: 0,
        values: { DINGTALK_INTERVIEW_CALENDAR_ENABLED: false },
      },
      "admin",
    );
    await f.service.test("dingtalk-calendar", { expectedRevision: 1 }, "admin");
    const row = f.rows.get("integration_configuration:dingtalk-app");
    row.value.appliedRevision = 1;
    row.value.applied = "corrupt";
    await f.runtime.reloadApplied();
    expect(
      (await f.service.get("dingtalk-calendar", "admin")).verification,
    ).toBe("untested");
    expect(
      (await f.service.get("dingtalk-calendar", "admin")).fields,
    ).toHaveLength(1);
    expect((await f.service.get("ai-resume", "admin")).id).toBe("ai-resume");
    expect((await f.service.mailboxes("admin")).length).toBeGreaterThan(0);
  });
});
