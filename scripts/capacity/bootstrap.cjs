const fs = require('node:fs');
const { monitorEventLoopDelay } = require('node:perf_hooks');

async function main() {
  if (!/^CAP_[a-f0-9]{12}$/.test(process.env.CAPACITY_RUN_ID || '')
    || !process.env.DATABASE_URL?.includes('@pg:5432/hrm_capacity_')
    || fs.existsSync('/app/.env')) throw new Error('capacity-bootstrap-isolation-refused');
  require('node:child_process').execFileSync(process.execPath, ['/app/node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: '/app', stdio: 'ignore' });
  const { NestFactory } = require('/app/node_modules/@nestjs/core');
  const { ValidationPipe } = require('/app/node_modules/@nestjs/common');
  const { SchedulerRegistry } = require('/app/node_modules/@nestjs/schedule');
  const { AppModule } = require('/app/dist/src/app.module');
  const { ResponseInterceptor } = require('/app/dist/src/common/interceptors/response.interceptor');
  const { HttpExceptionFilter } = require('/app/dist/src/common/filters/http-exception.filter');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const timer = setInterval(() => {
    console.log(JSON.stringify({ kind: 'capacity-resource', rssMiB: process.memoryUsage().rss / 1024 ** 2,
      eventLoopP95Ms: loop.percentile(95) / 1e6, eventLoopP99Ms: loop.percentile(99) / 1e6 }));
    loop.reset();
  }, 15000);
  timer.unref();
  await app.listen(3000, '0.0.0.0');
  console.log('capacity-api-ready');
  process.once('SIGTERM', async () => { clearInterval(timer); loop.disable(); await app.close(); process.exit(0); });
}
main().catch(() => { console.error('capacity-api-bootstrap-failed'); process.exit(1); });
