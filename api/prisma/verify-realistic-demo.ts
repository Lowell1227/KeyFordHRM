import { PrismaClient } from "@prisma/client";
import { generateRealisticDemoDataset } from "./realistic-demo/generate";
import { verifyRealisticDemoData } from "./realistic-demo/persist";

export async function runVerifyRealisticDemo(): Promise<void> {
  const dataset = generateRealisticDemoDataset();
  const prisma = new PrismaClient();
  try {
    const verified = await verifyRealisticDemoData(prisma, dataset.manifest);
    console.log(JSON.stringify({ mode: "verify", verified }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runVerifyRealisticDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
