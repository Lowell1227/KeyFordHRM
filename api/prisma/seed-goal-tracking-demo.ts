import { PrismaClient } from "@prisma/client";
import {
  inspectGoalTrackingDemoOwnership,
  loadGoalTrackingDemoPlan,
  persistGoalTrackingDemo,
  requireGoalTrackingDemoWriteGate,
  summarizeGoalTrackingDemo,
  verifyGoalTrackingDemo,
} from "./goal-tracking-demo/persist";

export async function runGoalTrackingDemoSeed(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
) {
  const dryRun = argv.includes("--dry-run");
  const verifyOnly = argv.includes("--verify");
  if (!dryRun && !verifyOnly) requireGoalTrackingDemoWriteGate(env);
  const prisma = new PrismaClient();

  try {
    const plan = await loadGoalTrackingDemoPlan(prisma);
    const existing = await inspectGoalTrackingDemoOwnership(prisma, plan);

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            summary: summarizeGoalTrackingDemo(plan),
            existing: {
              tasks: existing.tasks.length,
              indicators: existing.indicators.length,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (verifyOnly) {
      console.log(
        JSON.stringify(
          {
            mode: "verify",
            summary: await verifyGoalTrackingDemo(prisma, plan),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      JSON.stringify(
        { mode: "write", summary: await persistGoalTrackingDemo(prisma, plan) },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runGoalTrackingDemoSeed().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
