import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { generateRealisticDemoDataset } from "./realistic-demo/generate";
import { requireSeedWriteGate } from "./realistic-demo/guards";
import { assertOwnedOrAbsent } from "./realistic-demo/ownership";
import { persistRealisticDemoDataset } from "./realistic-demo/persist";
import { summarizeRealisticDemoDataset } from "./realistic-demo/report";

export async function runSeedRealisticDemo(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  hashPassword: (
    password: string,
    rounds: number,
  ) => Promise<string> = bcrypt.hash,
): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const gate = dryRun ? undefined : requireSeedWriteGate(env);
  const dataset = generateRealisticDemoDataset();
  const prisma = new PrismaClient();
  try {
    const ownership = await assertOwnedOrAbsent(prisma, dataset.manifest);
    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            summary: summarizeRealisticDemoDataset(dataset),
            existingOwnedCounts: ownership.counts,
            existingOwnedTotal: ownership.total,
          },
          null,
          2,
        ),
      );
      return;
    }

    const passwordHash = await hashPassword(gate!.password, 10);
    const persisted = await persistRealisticDemoDataset(
      prisma,
      dataset,
      passwordHash,
    );
    console.log(
      JSON.stringify(
        {
          mode: "write",
          summary: summarizeRealisticDemoDataset(dataset),
          persisted,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runSeedRealisticDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
