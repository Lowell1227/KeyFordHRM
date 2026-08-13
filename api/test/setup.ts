import { execSync } from "child_process";
import path from "path";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { prepareExternalE2EDatabase } from "./database-safety";

let container: StartedPostgreSqlContainer | undefined;

function runMigrationsAndSeed(dbUrl: string): void {
  process.env.DATABASE_URL = dbUrl;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "e2e-test-secret-do-not-use-in-production";
  process.env.NODE_ENV = "test";

  console.log("▶ DATABASE_URL=", dbUrl);

  const apiRoot = path.resolve(__dirname, "..");

  console.log("▶ 运行 prisma migrate deploy...");
  execSync("npx prisma migrate deploy", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "inherit",
  });

  console.log("▶ 运行 prisma db seed...");
  execSync("npx prisma db seed", {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || "admin123",
    },
    stdio: "inherit",
  });
}

export default async function globalSetup(): Promise<void> {
  const existingDbUrl = process.env.DATABASE_URL;

  if (existingDbUrl) {
    console.log("▶ 使用外部 DATABASE_URL，跳过 testcontainers 启动");
    prepareExternalE2EDatabase(
      existingDbUrl,
      process.env,
      runMigrationsAndSeed,
    );
    (globalThis as any).__E2E_PG_CONTAINER__ = undefined;
    console.log("✓ E2E 全局 setup 完成（外部数据库）");
    return;
  }

  console.log("▶ 启动 E2E PostgreSQL 容器...");

  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withDatabase("hrm_e2e")
    .withUsername("postgres")
    .withPassword("postgres")
    .withExposedPorts(5432)
    .start();

  const dbUrl = container.getConnectionUri();
  runMigrationsAndSeed(dbUrl);

  (globalThis as any).__E2E_PG_CONTAINER__ = container;
  console.log("✓ E2E 全局 setup 完成");
}
