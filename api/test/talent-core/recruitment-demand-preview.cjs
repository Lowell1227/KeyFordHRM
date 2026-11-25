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

async function payrollPreviewFingerprint(db) {
  await assertFictionalDatabase(db);
  const rows = await db.payrollBatch.findMany({ where: { month: '2037-01' }, orderBy: { id: 'asc' },
    select: { id: true, subjectId: true, month: true, payMonth: true, purpose: true, status: true, version: true, updatedAt: true } });
  return { month: '2037-01', count: rows.length,
    sha256: require('node:crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

async function ensureDefaultReviewer(db) {
  await assertFictionalDatabase(db);
  return db.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { employeeNo: 'HR001' } });
    if (!reviewer || !reviewer.name.startsWith('测试·') || reviewer.sysRole !== 'hr'
      || reviewer.accountType !== 'employee' || reviewer.status !== 'active' || reviewer.archivedAt || reviewer.deletedAt
      || reviewer.dingtalkId || reviewer.dingtalkUnionId || !reviewer.passwordHash
      || !await tx.employmentRecord.findFirst({ where: { userId: reviewer.id, sourceType: 'preview_fixture' } })) {
      throw new Error('Default reviewer must be the existing fictional preview identity');
    }
    await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', reviewer.id);
    const current = await tx.user.findUniqueOrThrow({ where: { id: reviewer.id }, select: { hrCapabilities: true } });
    if (current.hrCapabilities.includes('recruitment_demand_review')) return { changed: false };
    await tx.user.update({ where: { id: reviewer.id }, data: { hrCapabilities: { push: 'recruitment_demand_review' } } });
    await tx.systemConfig.upsert({ where: { key: 'recruitment_local_preview_reviewer_v1' },
      create: { key: 'recruitment_local_preview_reviewer_v1', value: { fictional: true, userId: reviewer.id,
        capability: 'recruitment_demand_review', preparedAt: new Date().toISOString() } }, update: {} });
    return { changed: true };
  });
}

async function createLocalFixture(db, prefix, sign) {
  await assertFictionalDatabase(db);
  if (!prefixPattern.test(prefix)) throw new Error('Invalid local fixture owner');
  const { JwtService } = require('@nestjs/jwt');
  const mint = sign || (user => new JwtService().sign({ sub: user.id, employeeNo: user.employeeNo },
    { secret: process.env.JWT_SECRET, expiresIn: '1h' }));
  return db.$transaction(async tx => {
    if (await tx.user.count({ where: { employeeNo: { startsWith: prefix + '_' } } })) throw new Error('Fixture prefix already used');
    const department = await tx.department.create({ data: { name: `虚构本地需求部门_${prefix}` } });
    const position = await tx.position.create({ data: { code: prefix, name: `虚构本地需求岗位_${prefix}` } });
    const education = await tx.personnelReferenceData.create({ data: { kind: 'education', name: `虚构学历_${prefix}` } });
    const actors = {};
    for (const [kind, hrCapabilities] of [
      ['operator', ['recruitment_edit', 'recruitment_view']], ['reviewer', ['recruitment_demand_review']],
      ['confirmer', ['talent_hiring_confirm']], ['viewer', ['recruitment_view']], ['outsider', []],
      ['dual', ['recruitment_edit', 'recruitment_view', 'recruitment_demand_review']],
    ]) {
      const user = await tx.user.create({ data: { name: `虚构${prefix}_${kind}`, employeeNo: `${prefix}_${kind}`,
        deptId: department.id, accountType: 'employee', sysRole: 'employee', status: 'active', hrCapabilities,
        isAssessorOnly: false, mustChangePassword: false } });
      await tx.employmentRecord.create({ data: { userId: user.id, employeeNo: user.employeeNo, deptId: department.id,
        company: 'fuede', effectiveFrom: new Date('2026-01-01'), entryDate: new Date('2026-01-01'),
        employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture', reason: prefix } });
      actors[kind] = { id: user.id, name: user.name, token: mint(user) };
    }
    await tx.systemConfig.create({ data: { key: 'recruitment_local_fixture_v1:' + prefix,
      value: { fictional: true, prefix, actorIds: Object.values(actors).map(actor => actor.id),
        departmentId: department.id, positionId: position.id, educationId: education.id } } });
    return { prefix, department, position, education, actors };
  });
}

async function archiveLocalFixture(db, prefix) {
  await assertFictionalDatabase(db);
  if (!prefixPattern.test(prefix)) throw new Error('Invalid local cleanup owner');
  const key = 'recruitment_local_fixture_v1:' + prefix;
  const owner = (await db.systemConfig.findUnique({ where: { key } }))?.value;
  if (owner?.fictional !== true || owner.prefix !== prefix || !Array.isArray(owner.actorIds)) throw new Error('Missing local fixture ownership');
  const actors = await db.user.findMany({ where: { id: { in: owner.actorIds }, employeeNo: { startsWith: prefix + '_' } }, select: { id: true } });
  if (actors.length !== owner.actorIds.length) throw new Error('Local fixture ownership mismatch');
  const candidateWhere = { createdById: { in: owner.actorIds }, name: { startsWith: '虚构' + prefix } };
  // Local demand withdrawal is performed through HTTP before archiving its actors. Never erase events or accepted seats.
  const liveDemands = await db.recruitmentDemand.count({ where: { sourceKind: 'local', createdById: { in: owner.actorIds }, sourceState: { not: 'withdrawn' } } });
  if (liveDemands) throw new Error('Withdraw owned local demands through the audited action before cleanup');
  await db.$transaction(async tx => {
    const now = new Date();
    await tx.talentCandidate.updateMany({ where: candidateWhere, data: { deletedAt: now } });
    await tx.user.updateMany({ where: { id: { in: owner.actorIds }, employeeNo: { startsWith: prefix + '_' } },
      data: { archivedAt: now, deletedAt: now, status: 'resigned' } });
    await tx.department.updateMany({ where: { id: owner.departmentId, name: `虚构本地需求部门_${prefix}` }, data: { isActive: false } });
    await tx.position.updateMany({ where: { id: owner.positionId, code: prefix }, data: { isActive: false } });
    await tx.personnelReferenceData.updateMany({ where: { id: owner.educationId, name: `虚构学历_${prefix}` }, data: { isActive: false } });
    await tx.systemConfig.delete({ where: { key } });
  });
  return { activeActors: await db.user.count({ where: { id: { in: owner.actorIds }, archivedAt: null } }),
    activeCandidates: await db.talentCandidate.count({ where: { ...candidateWhere, deletedAt: null } }), activeDemands: liveDemands,
    retainedDemandEvents: await db.recruitmentDemandEvent.count({ where: { demand: { sourceKind: 'local', createdById: { in: owner.actorIds } } } }) };
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
  await ensureDefaultReviewer(db);
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
  const { RecruitmentMailboxGateway } = require('../../dist/src/talent-pool/recruitment-mail-gateway');
  const { TalentResumeService } = require('../../dist/src/talent-pool/talent-resume.service');
  const { mailboxGateway, realResumeServiceWithFixtureProvider } = require('./recruitment-intake-fixtures.cjs');
  const { ResponseInterceptor } = require('../../dist/src/common/interceptors/response.interceptor');
  const { HttpExceptionFilter } = require('../../dist/src/common/filters/http-exception.filter');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  await assertFictionalDatabase(db);
  await ensureDefaultFixture(db);
  const fictionalParser = realResumeServiceWithFixtureProvider(db);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DingtalkRecruitmentService).useValue(fixtureGateway(db))
    .overrideProvider(RecruitmentMailboxGateway).useValue(mailboxGateway(db))
    .overrideProvider(TalentResumeService).useValue(fictionalParser.service).compile();
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

module.exports = { assertFictionalDatabase, fixtureGateway, fixtureNamespace, httpFixtureNamespace, prefixPattern, scope, fixtureRange, ensureDefaultFixture,
  payrollPreviewFingerprint, ensureDefaultReviewer, createLocalFixture, archiveLocalFixture };
if (require.main === module) bootstrap().catch(() => {
  process.stderr.write('Guarded recruitment preview bootstrap failed; details suppressed.\n');
  process.exit(1);
});
