export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as any).__E2E_PG_CONTAINER__;
  if (container) {
    console.log('▶ 停止 E2E PostgreSQL 容器...');
    await container.stop();
    console.log('✓ E2E 全局 teardown 完成');
  } else {
    console.log('▶ 使用外部数据库，无需停止容器');
  }
}
