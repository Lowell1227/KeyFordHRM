import { PrismaClient } from "@prisma/client";
import { generateRealisticDemoDataset } from "./realistic-demo/generate";
import { requireCleanGate } from "./realistic-demo/guards";
import { cleanRealisticDemoData } from "./realistic-demo/persist";

export async function runCleanRealisticDemo(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const dataset = generateRealisticDemoDataset();
  const execute = env.ENABLE_REALISTIC_DEMO_CLEAN === "true";
  if (execute) requireCleanGate(env);

  const prisma = new PrismaClient();
  try {
    const result = await cleanRealisticDemoData(prisma, dataset.manifest, {
      execute,
    });
    console.log(
      JSON.stringify(
        {
          mode: execute ? "execute" : "preview",
          result,
          executeHint: execute
            ? undefined
            : "Set ENABLE_REALISTIC_DEMO_CLEAN=true to delete only manifest-owned rows.",
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
  runCleanRealisticDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
