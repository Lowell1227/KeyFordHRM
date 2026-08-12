import { createDemoContext } from "./context";
import type { Prisma } from "@prisma/client";

// Kept as a dynamic import for the first red run: the feature module does not exist yet.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generatePeople } = require("./people") as {
  generatePeople?: (context: ReturnType<typeof createDemoContext>) => {
    users: Prisma.UserCreateManyInput[];
    managerIds: string[];
  };
};

function countBy<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = String(row[key]);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function assertAcyclicManagerGraph(users: Prisma.UserCreateManyInput[]): void {
  const managerByUserId = new Map(
    users.map((user) => [user.id, user.directManagerId]),
  );
  for (const user of users) {
    const visited = new Set<string>();
    let currentId = user.id!;
    while (managerByUserId.get(currentId)) {
      if (visited.has(currentId))
        throw new Error(`manager cycle at ${currentId}`);
      visited.add(currentId);
      currentId = managerByUserId.get(currentId)!;
    }
  }
}

function managerTeamSizes(users: Prisma.UserCreateManyInput[]): number[] {
  const counts = new Map<string, number>();
  for (const user of users) {
    if (user.directManagerId)
      counts.set(
        user.directManagerId,
        (counts.get(user.directManagerId) ?? 0) + 1,
      );
  }
  return [...counts.values()];
}

describe("generatePeople", () => {
  it("creates the approved current, historical, and acceptance-account distribution", () => {
    const people = generatePeople!(createDemoContext());
    const current = people.users.filter(
      (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
    );

    expect(current).toHaveLength(128);
    expect(
      people.users.filter((user) => user.status === "resigned"),
    ).toHaveLength(4);
    expect(
      people.users.filter((user) => user.sysRole === "system_admin"),
    ).toHaveLength(1);
    expect(countBy(current, "employmentType")).toEqual({
      full_time: 115,
      rehire: 9,
      external: 3,
      part_time: 1,
    });
    expect(current.filter((user) => user.status === "probation")).toHaveLength(
      7,
    );
    expect(current.filter((user) => user.passwordHash !== null)).toHaveLength(
      7,
    );
    expect(
      people.users.filter((user) => user.passwordHash !== null),
    ).toHaveLength(8);
  });

  it("creates the approved acyclic reporting hierarchy without real contact data", () => {
    const people = generatePeople!(createDemoContext());
    const teamSizes = managerTeamSizes(people.users).sort((a, b) => a - b);

    expect(people.managerIds).toHaveLength(18);
    expect(assertAcyclicManagerGraph(people.users)).toBeUndefined();
    expect(teamSizes).toEqual([
      1, 2, 3, 4, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 8, 9, 13, 24,
    ]);
    expect(teamSizes.at(-1)).toBeLessThanOrEqual(24);
    expect(teamSizes[Math.floor(teamSizes.length / 2)]).toBe(6);
    for (const user of people.users) {
      expect(user.phone).toBeNull();
      if (user.email) expect(user.email).toMatch(/@example\.invalid$/);
    }
  });

  it("uses the required deterministic entry-date cohorts", () => {
    const people = generatePeople!(createDemoContext());
    const current = people.users.filter(
      (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
    );
    const cohorts = current.reduce<Record<string, number>>((counts, user) => {
      const date = new Date(user.entryDate!);
      const year = date.getUTCFullYear();
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
      const key = year < 2026 ? "pre2026" : `2026Q${quarter}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});

    expect(cohorts).toEqual({
      pre2026: 116,
      "2026Q1": 4,
      "2026Q2": 4,
      "2026Q3": 4,
    });
  });
});
