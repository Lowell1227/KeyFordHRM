import { generateRealisticDemoDataset } from "./generate";
import { inspectOwnedRows } from "./ownership";
import type { DemoManifest } from "./types";

function cloneManifest(): DemoManifest {
  const manifest = generateRealisticDemoDataset().manifest;
  return {
    ...manifest,
    asOf: new Date(manifest.asOf),
    ownedIds: Object.fromEntries(
      Object.entries(manifest.ownedIds).map(([kind, ids]) => [kind, [...ids]]),
    ) as DemoManifest["ownedIds"],
    acceptanceEmployeeNos: { ...manifest.acceptanceEmployeeNos },
    storyUserIds: { ...manifest.storyUserIds },
    expectedCounts: { ...manifest.expectedCounts },
  };
}

function noDatabaseClient() {
  let queries = 0;
  const prisma = new Proxy(
    {},
    {
      get() {
        queries += 1;
        throw new Error("database must not be queried");
      },
    },
  );
  return { prisma, queries: () => queries };
}

describe("realistic demo manifest ownership boundary", () => {
  it.each([
    [
      "acceptanceEmployeeNos role swap",
      (manifest: DemoManifest) => {
        const admin = manifest.acceptanceEmployeeNos.admin;
        manifest.acceptanceEmployeeNos.admin =
          manifest.acceptanceEmployeeNos.hr;
        manifest.acceptanceEmployeeNos.hr = admin;
      },
      /acceptanceEmployeeNos/,
    ],
    [
      "acceptanceEmployeeNos value replacement",
      (manifest: DemoManifest) => {
        manifest.acceptanceEmployeeNos.employee = "FD399999";
      },
      /acceptanceEmployeeNos\.employee/,
    ],
    [
      "storyUserIds drift",
      (manifest: DemoManifest) => {
        manifest.storyUserIds.lateEntryExempt =
          manifest.storyUserIds.appealModified;
      },
      /storyUserIds\.lateEntryExempt/,
    ],
    [
      "expectedCounts drift",
      (manifest: DemoManifest) => {
        manifest.expectedCounts.tasks += 1;
      },
      /expectedCounts\.tasks/,
    ],
  ])("rejects %s before any database query", async (_, mutate, error) => {
    const manifest = cloneManifest();
    mutate(manifest);
    const db = noDatabaseClient();

    await expect(
      inspectOwnedRows(db.prisma as never, manifest),
    ).rejects.toThrow(error);
    expect(db.queries()).toBe(0);
  });

  it("does not treat object key insertion order as manifest drift", async () => {
    const manifest = cloneManifest();
    manifest.acceptanceEmployeeNos = Object.fromEntries(
      Object.entries(manifest.acceptanceEmployeeNos).reverse(),
    );
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = new Proxy({}, { get: () => ({ findMany }) });

    await expect(inspectOwnedRows(prisma as never, manifest)).resolves.toEqual(
      expect.objectContaining({ total: 0 }),
    );
    expect(findMany).toHaveBeenCalled();
  });
});
