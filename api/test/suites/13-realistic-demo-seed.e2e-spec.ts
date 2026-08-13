import * as bcrypt from "bcrypt";
import { generateRealisticDemoDataset } from "../../prisma/realistic-demo/generate";
import {
  cleanRealisticDemoData,
  persistRealisticDemoDataset,
  verifyRealisticDemoData,
} from "../../prisma/realistic-demo/persist";
import { buildTestApp, closeTestApp, TestApp } from "../test-app";
import { runSeedRealisticDemo } from "../../prisma/seed-realistic-demo";
import { runVerifyRealisticDemo } from "../../prisma/verify-realistic-demo";
import { runCleanRealisticDemo } from "../../prisma/clean-realistic-demo";

describe("realistic demo transactional persistence", () => {
  let app: TestApp;
  const dataset = generateRealisticDemoDataset();
  const integrationHashPromise = bcrypt.hash("integration-only-password", 4);

  beforeAll(async () => {
    app = await buildTestApp();
    const [{ database }] = await app.prisma.$queryRaw<
      Array<{ database: string }>
    >`SELECT current_database() AS database`;
    expect(database).toBe("hrm_e2e");
  });

  afterAll(async () => {
    if (app) {
      await cleanRealisticDemoData(app.prisma, dataset.manifest, {
        execute: true,
      });
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await cleanRealisticDemoData(app.prisma, dataset.manifest, {
      execute: true,
    });
    await app.prisma.user.deleteMany({
      where: { employeeNo: { startsWith: "SEED-CONTROL" } },
    });
  });

  it("is idempotent and preserves a non-owned control row", async () => {
    const control = await app.prisma.user.create({
      data: {
        employeeNo: "SEED-CONTROL-IDEMPOTENCY",
        name: "Non-owned control row",
      },
    });
    const passwordHash = await integrationHashPromise;

    await persistRealisticDemoDataset(app.prisma, dataset, passwordHash);
    const first = await verifyRealisticDemoData(app.prisma, dataset.manifest);
    await persistRealisticDemoDataset(app.prisma, dataset, passwordHash);
    const second = await verifyRealisticDemoData(app.prisma, dataset.manifest);

    expect(second.counts).toEqual(first.counts);
    expect(
      await app.prisma.user.findUnique({ where: { id: control.id } }),
    ).not.toBeNull();

    const acceptanceUsers = await app.prisma.user.findMany({
      where: {
        employeeNo: {
          in: Object.values(dataset.manifest.acceptanceEmployeeNos),
        },
      },
      select: { passwordHash: true },
    });
    expect(acceptanceUsers).toHaveLength(8);
    expect(
      acceptanceUsers.every(
        ({ passwordHash: storedHash }) =>
          storedHash === passwordHash &&
          storedHash !== "__ACCEPTANCE_PASSWORD_HASH__",
      ),
    ).toBe(true);
  });

  it("rejects foreign evidence at a deterministic ID before deleting owned rows", async () => {
    const passwordHash = await integrationHashPromise;
    const before = await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      passwordHash,
    );
    const collisionId = dataset.manifest.ownedIds.user[0];
    await app.prisma.user.update({
      where: { id: collisionId },
      data: {
        employeeNo: "SEED-CONTROL-COLLISION",
        email: "foreign@example.com",
      },
    });

    try {
      await expect(
        persistRealisticDemoDataset(app.prisma, dataset, passwordHash),
      ).rejects.toThrow(/collision/i);

      expect(
        await app.prisma.assessmentTask.count({
          where: { id: { in: dataset.manifest.ownedIds.task } },
        }),
      ).toBe(before.counts.task);
      expect(
        await app.prisma.user.findUnique({ where: { id: collisionId } }),
      ).toMatchObject({ employeeNo: "SEED-CONTROL-COLLISION" });
    } finally {
      const original = dataset.rows.users.find(({ id }) => id === collisionId)!;
      await app.prisma.user.update({
        where: { id: collisionId },
        data: { employeeNo: original.employeeNo, email: original.email },
      });
    }
  });

  it("rejects swapped deterministic evidence before deleting any owned row", async () => {
    const passwordHash = await integrationHashPromise;
    const before = await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      passwordHash,
    );
    const [firstExpected, secondExpected] = dataset.rows.users.slice(0, 2);
    const [firstCycle, secondCycle] = dataset.rows.cycles.slice(0, 2);

    await app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: firstExpected.id },
        data: {
          employeeNo: "SEED-CONTROL-SWAP",
          email: "seed-control-swap@example.invalid",
        },
      });
      await tx.user.update({
        where: { id: secondExpected.id },
        data: {
          employeeNo: firstExpected.employeeNo,
          email: firstExpected.email,
        },
      });
      await tx.user.update({
        where: { id: firstExpected.id },
        data: {
          employeeNo: secondExpected.employeeNo,
          email: secondExpected.email,
        },
      });
      await tx.assessmentCycle.update({
        where: { id: firstCycle.id },
        data: { name: secondCycle.name },
      });
    });

    try {
      await expect(
        persistRealisticDemoDataset(app.prisma, dataset, passwordHash),
      ).rejects.toThrow(/collision/i);
      expect(
        await app.prisma.assessmentTask.count({
          where: { id: { in: dataset.manifest.ownedIds.task } },
        }),
      ).toBe(before.counts.task);
    } finally {
      await app.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: firstExpected.id },
          data: {
            employeeNo: "SEED-CONTROL-SWAP",
            email: "seed-control-swap@example.invalid",
          },
        });
        await tx.user.update({
          where: { id: secondExpected.id },
          data: {
            employeeNo: secondExpected.employeeNo,
            email: secondExpected.email,
          },
        });
        await tx.user.update({
          where: { id: firstExpected.id },
          data: {
            employeeNo: firstExpected.employeeNo,
            email: firstExpected.email,
          },
        });
        await tx.assessmentCycle.update({
          where: { id: firstCycle.id },
          data: { name: firstCycle.name },
        });
      });
    }
  });

  it("rejects exact cycle and objective evidence bound to the wrong deterministic ID", async () => {
    const passwordHash = await integrationHashPromise;
    const before = await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      passwordHash,
    );
    const [firstCycle, secondCycle] = dataset.rows.cycles.slice(0, 2);
    const [firstObjective, secondObjective] = dataset.rows.objectives.slice(
      0,
      2,
    );

    await app.prisma.assessmentCycle.update({
      where: { id: firstCycle.id },
      data: { name: secondCycle.name },
    });
    await expect(
      persistRealisticDemoDataset(app.prisma, dataset, passwordHash),
    ).rejects.toThrow(/collision.*cycle/i);
    expect(
      await app.prisma.assessmentTask.count({
        where: { id: { in: dataset.manifest.ownedIds.task } },
      }),
    ).toBe(before.counts.task);
    await app.prisma.assessmentCycle.update({
      where: { id: firstCycle.id },
      data: { name: firstCycle.name },
    });

    await app.prisma.objective.update({
      where: { id: firstObjective.id },
      data: { title: secondObjective.title },
    });
    try {
      await expect(
        persistRealisticDemoDataset(app.prisma, dataset, passwordHash),
      ).rejects.toThrow(/collision.*objective/i);
      expect(
        await app.prisma.assessmentTask.count({
          where: { id: { in: dataset.manifest.ownedIds.task } },
        }),
      ).toBe(before.counts.task);
    } finally {
      await app.prisma.objective.update({
        where: { id: firstObjective.id },
        data: { title: firstObjective.title },
      });
    }
  });

  it("rolls back every deletion when an insert fails inside the transaction", async () => {
    const passwordHash = await integrationHashPromise;
    const before = await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      passwordHash,
    );

    await expect(
      persistRealisticDemoDataset(app.prisma, dataset, "x".repeat(101)),
    ).rejects.toThrow();

    const after = await verifyRealisticDemoData(app.prisma, dataset.manifest);
    expect(after.counts).toEqual(before.counts);
    expect(
      await app.prisma.user.count({
        where: { passwordHash },
      }),
    ).toBe(8);
  });

  it("previews exact owned counts and deletes only after execute is explicit", async () => {
    const control = await app.prisma.user.create({
      data: {
        employeeNo: "SEED-CONTROL-CLEAN",
        name: "Non-owned clean control",
      },
    });
    await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      await integrationHashPromise,
    );

    const preview = await cleanRealisticDemoData(app.prisma, dataset.manifest, {
      execute: false,
    });
    expect(preview.executed).toBe(false);
    expect(preview.counts.task).toBe(dataset.manifest.ownedIds.task.length);
    expect(
      await app.prisma.assessmentTask.count({
        where: { id: { in: dataset.manifest.ownedIds.task } },
      }),
    ).toBe(dataset.manifest.ownedIds.task.length);

    const cleaned = await cleanRealisticDemoData(app.prisma, dataset.manifest, {
      execute: true,
    });
    expect(cleaned.executed).toBe(true);
    expect(cleaned.counts).toEqual(preview.counts);
    expect(
      await app.prisma.user.findUnique({ where: { id: control.id } }),
    ).not.toBeNull();
  });

  it("verify rejects owned-to-owned rewiring and leadership swaps without writing", async () => {
    await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      await integrationHashPromise,
    );
    const selfEvaluation = dataset.rows.selfEvaluations[0];
    const taskWithoutSelfEvaluation = dataset.rows.tasks.find(
      ({ id }) =>
        !dataset.rows.selfEvaluations.some(({ taskId }) => taskId === id),
    )!;
    const [firstLeadership, secondLeadership] =
      dataset.departmentLeadership.slice(0, 2);

    await app.prisma.selfEvalSummary.update({
      where: { id: selfEvaluation.id },
      data: { taskId: taskWithoutSelfEvaluation.id },
    });
    await app.prisma.department.update({
      where: { id: firstLeadership.id },
      data: {
        leaderId: secondLeadership.leaderId,
        approverId: secondLeadership.approverId,
      },
    });

    try {
      await expect(
        verifyRealisticDemoData(app.prisma, dataset.manifest),
      ).rejects.toThrow(/mismatch|collision/i);
      expect(
        await app.prisma.selfEvalSummary.findUnique({
          where: { id: selfEvaluation.id },
        }),
      ).toMatchObject({ taskId: taskWithoutSelfEvaluation.id });
    } finally {
      await app.prisma.selfEvalSummary.update({
        where: { id: selfEvaluation.id },
        data: { taskId: selfEvaluation.taskId },
      });
      await app.prisma.department.update({
        where: { id: firstLeadership.id },
        data: {
          leaderId: firstLeadership.leaderId,
          approverId: firstLeadership.approverId,
        },
      });
    }
    await expect(
      verifyRealisticDemoData(app.prisma, dataset.manifest),
    ).resolves.toMatchObject({ total: 7513 });
  });

  it("verify independently rejects an owned self-evaluation rewired to another owned task", async () => {
    await persistRealisticDemoDataset(
      app.prisma,
      dataset,
      await integrationHashPromise,
    );
    const selfEvaluation = dataset.rows.selfEvaluations[0];
    const taskWithoutSelfEvaluation = dataset.rows.tasks.find(
      ({ id }) =>
        !dataset.rows.selfEvaluations.some(({ taskId }) => taskId === id),
    )!;
    await app.prisma.selfEvalSummary.update({
      where: { id: selfEvaluation.id },
      data: { taskId: taskWithoutSelfEvaluation.id },
    });
    try {
      await expect(
        verifyRealisticDemoData(app.prisma, dataset.manifest),
      ).rejects.toThrow(/mismatch.*self-eval/i);
      expect(
        await app.prisma.selfEvalSummary.findUnique({
          where: { id: selfEvaluation.id },
        }),
      ).toMatchObject({ taskId: taskWithoutSelfEvaluation.id });
    } finally {
      await app.prisma.selfEvalSummary.update({
        where: { id: selfEvaluation.id },
        data: { taskId: selfEvaluation.taskId },
      });
    }
  });

  it("keeps dry-run read-only and exercises gated CLI write, verify, and cleanup", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const forbiddenHash = jest.fn(async () => {
      throw new Error("dry-run must not hash a password");
    });
    try {
      await runSeedRealisticDemo(["--dry-run"], {}, forbiddenHash);
      expect(forbiddenHash).not.toHaveBeenCalled();
      expect(
        await app.prisma.user.count({
          where: { id: { in: dataset.manifest.ownedIds.user } },
        }),
      ).toBe(0);

      await runSeedRealisticDemo([], {
        ENABLE_REALISTIC_DEMO_SEED: "true",
        REALISTIC_DEMO_ACCOUNT_PASSWORD: "cli-only-secret",
      });
      const account = await app.prisma.user.findFirstOrThrow({
        where: {
          employeeNo: dataset.manifest.acceptanceEmployeeNos.employee,
        },
        select: { passwordHash: true },
      });
      expect(bcrypt.getRounds(account.passwordHash!)).toBe(10);
      expect(log.mock.calls.flat().join(" ")).not.toContain("cli-only-secret");

      await runVerifyRealisticDemo();
      await runCleanRealisticDemo({});
      expect(
        await app.prisma.assessmentTask.count({
          where: { id: { in: dataset.manifest.ownedIds.task } },
        }),
      ).toBe(dataset.manifest.ownedIds.task.length);

      await runCleanRealisticDemo({ ENABLE_REALISTIC_DEMO_CLEAN: "true" });
      expect(
        await app.prisma.assessmentTask.count({
          where: { id: { in: dataset.manifest.ownedIds.task } },
        }),
      ).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
