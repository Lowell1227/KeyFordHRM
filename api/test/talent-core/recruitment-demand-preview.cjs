'use strict';

const fixtureNamespace = 'recruitment_demand_sidecar_v1:';
const httpFixtureNamespace = 'recruitment_demand_http_sidecar_v1:';
const prefixPattern = /^(?:RDL_[dm]|ROP_[dm]|RDI)_[a-f0-9]{8}$/;
const scope = Object.freeze({ organizationKey: 'fictional-recruitment-demands', processCode: 'fictional-recruitment-demand-form' });
const sourceKeys = ['organizationKey', 'processCode', 'instanceId', 'status', 'rawDepartment', 'rawPosition',
  'rawHeadcount', 'approvedAt', 'sourceCreatedAt', 'sourceUpdatedAt', 'sourceLink', 'mainInstanceId',
  'bizAction', 'supersedesInstanceId'];

function fixtureRange({ from, to }) {
  const edge = (value, end) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`) : Date.parse(value);
  const start = edge(from, false), end = edge(to, true);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Invalid fictional source range');
  return { start, end };
}

async function assertFictionalDatabase(db) {
  require('../../prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
  if (identity.db !== 'hrm_preview' || identity.role !== 'hrm_preview'
    || (await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional !== true) {
    throw new Error('Recruitment sidecar requires fictional preview PostgreSQL');
  }
}

function fixtureGateway(db, onlyPrefix) {
  if (onlyPrefix !== undefined && !prefixPattern.test(onlyPrefix)) throw new Error('Invalid fixture owner');
  async function configurations() {
    await assertFictionalDatabase(db);
    const namespace = onlyPrefix ? httpFixtureNamespace : fixtureNamespace;
    const rows = await db.systemConfig.findMany({ where: { key: onlyPrefix ? namespace + onlyPrefix : { startsWith: namespace } }, select: { key: true, value: true } });
    for (const { key, value } of rows) {
      if (value?.fictional !== true || !prefixPattern.test(value.prefix)
        || key !== namespace + value.prefix || !Array.isArray(value.sources)) throw new Error('Invalid sidecar fixture namespace');
    }
    return rows;
  }
  function sources(configurations) {
    return configurations.flatMap(({ value }) => {
      return value.sources.map(source => {
        if (source.organizationKey !== scope.organizationKey
          || source.processCode !== scope.processCode
          || typeof source.instanceId !== 'string' || !source.instanceId.startsWith(value.prefix + '_')
          || !['pending', 'approved', 'rejected', 'withdrawn', 'unknown'].includes(source.status)
          || (source.supersedesInstanceId && !source.supersedesInstanceId.startsWith(value.prefix + '_'))
          || (source.mainInstanceId && !source.mainInstanceId.startsWith(value.prefix + '_'))
          || (source.sourceLink && new URL(source.sourceLink).hostname !== 'example.invalid')) {
          throw new Error('Unowned upstream recruitment fixture refused');
        }
        return Object.fromEntries(sourceKeys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
      });
    });
  }
  const records = async () => sources(await configurations());
  return {
    status: () => ({ configured: true, missing: [], readOnly: true, scope }),
    async listIds({ from, to }) {
      const { start, end } = fixtureRange({ from, to });
      return { complete: true, instanceIds: (await records()).filter(source => {
        const created = Date.parse(source.sourceCreatedAt);
        return Number.isFinite(created) && created >= start && created <= end;
      }).map(source => source.instanceId) };
    },
    async readInstance(instanceId) {
      const matches = (await records()).filter(source => source.instanceId === instanceId);
      if (matches.length !== 1) throw new Error('Unknown or duplicate fictional upstream instance');
      return matches[0];
    },
    async verifyForSubmission(instanceId) {
      const configurationsForProof = await configurations(), known = sources(configurationsForProof);
      const matches = known.filter(source => source.instanceId === instanceId);
      if (matches.length !== 1) throw new Error('Unknown or duplicate fictional verification instance');
      const owner = configurationsForProof.find(row => row.value.sources.some(source => source.instanceId === instanceId));
      const behavior = owner.value.verification || {};
      if (behavior.failure === 'permission' || behavior.failure === 'timeout') {
        const error = new Error(behavior.failure === 'permission' ? 'Fictional upstream permission denied' : 'Fictional upstream verification timeout');
        error.name = behavior.failure === 'permission' ? 'ForbiddenError' : 'TimeoutError'; throw error;
      }
      const replacementCoverage = behavior.replacementCoverage || 'complete';
      if (!['complete', 'unproven'].includes(replacementCoverage)) throw new Error('Invalid fictional replacement coverage');
      const lineage = new Set([instanceId]), relatedSources = [];
      let expanded;
      do {
        expanded = false;
        for (const source of known) if (source.status === 'approved' && source.supersedesInstanceId
          && lineage.has(source.supersedesInstanceId) && !lineage.has(source.instanceId)) {
          lineage.add(source.instanceId); relatedSources.push(source); expanded = true;
        }
      } while (expanded);
      return { source: matches[0], relatedSources, replacementCoverage, checkedAt: new Date().toISOString() };
    },
  };
}

async function ensureDefaultFixture(db) {
  await assertFictionalDatabase(db);
  const prefix = 'RDI_5173dede', key = fixtureNamespace + prefix;
  if (await db.systemConfig.findUnique({ where: { key } })) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const createdAt = new Date(`${today.slice(0, 7)}-01T00:00:00+08:00`).toISOString();
  await db.$transaction(async tx => {
    const departmentName = `虚构需求演练部门_${prefix}`, positionName = `虚构需求演练岗位_${prefix}`;
    if (!await tx.department.findFirst({ where: { name: departmentName } })) await tx.department.create({ data: { name: departmentName } });
    await tx.position.upsert({ where: { code: prefix }, create: { code: prefix, name: positionName }, update: {} });
    await tx.systemConfig.create({ data: { key, value: { fictional: true, prefix, sources: [{
      ...scope, instanceId: `${prefix}_approved`,
      status: 'approved', rawDepartment: departmentName, rawPosition: positionName, rawHeadcount: '2人', approvedAt: new Date().toISOString(),
      sourceCreatedAt: createdAt, sourceUpdatedAt: new Date().toISOString(), sourceLink: `https://example.invalid/${prefix}_approved`,
      mainInstanceId: null, bizAction: null,
    }] } } });
  });
}

async function bootstrap() {
  require('../../prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('reflect-metadata');
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const { PrismaClient } = require('@prisma/client');
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../../dist/src/app.module');
  const { DingtalkRecruitmentService } = require('../../dist/src/dingtalk/dingtalk-recruitment.service');
  const { ResponseInterceptor } = require('../../dist/src/common/interceptors/response.interceptor');
  const { HttpExceptionFilter } = require('../../dist/src/common/filters/http-exception.filter');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  await assertFictionalDatabase(db);
  await ensureDefaultFixture(db);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DingtalkRecruitmentService).useValue(fixtureGateway(db)).compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'] });
  app.setGlobalPrefix((process.env.API_PREFIX || '/api/v1').replace(/^\//, ''));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: true, credentials: true });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close(); await db.$disconnect();
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop().then(() => process.exit(0)));
  await app.listen(3000, '0.0.0.0');
  process.stdout.write('Fictional recruitment source ready; full HRM API, notifications/calendar disabled.\n');
}

module.exports = { assertFictionalDatabase, fixtureGateway, fixtureNamespace, httpFixtureNamespace, prefixPattern, scope, fixtureRange, ensureDefaultFixture };
if (require.main === module) bootstrap().catch(() => {
  process.stderr.write('Guarded recruitment preview bootstrap failed; details suppressed.\n');
  process.exit(1);
});
