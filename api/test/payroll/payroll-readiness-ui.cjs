const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash, randomUUID, randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');

const container = 'hrm-payroll-verify-payrollverifyapi-1';
const script = 'test/payroll/payroll-readiness-ui.cjs';
const root = path.resolve(__dirname, '../../..');
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const json = value => JSON.parse(JSON.stringify(value));
const line = value => process.stdout.write(JSON.stringify(value) + '\n');

async function forward() {
  let input = '';
  for await (const part of process.stdin) input += part;
  const request = JSON.parse(input);
  assert.ok(request.path.startsWith('/api/v1/'));
  assert.ok(['GET', 'POST'].includes(request.method));
  await new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port: 3001, path: request.path, method: request.method, headers: request.headers }, response => {
      const chunks = [];
      response.on('data', part => chunks.push(part));
      response.on('end', () => { line({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('base64') }); resolve(); });
    });
    call.on('error', reject); call.setTimeout(30000, () => call.destroy(new Error('Forward timeout')));
    call.end(Buffer.from(request.body, 'base64'));
  });
}

async function serve() {
  assert.equal(process.cwd(), '/app');
  require('/app/prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  assert.notEqual(process.env.PAYROLL_FORMAL_ENABLED, 'true');
  const commands = createInterface({ input: process.stdin });
  const iterator = commands[Symbol.asyncIterator]();
  const initial = JSON.parse((await iterator.next()).value);
  const setupOnly = initial.setupOnly === true;
  const sourceHashes = initial.sourceHashes;
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(hash(fs.readFileSync(file)), expected, `Source/dependency drift: ${file}`);
  for (const name of ['@nestjs/testing', '@nestjs/config', '@nestjs/jwt', '@prisma/client', 'bcrypt', 'typescript', 'ts-node']) {
    const lock = JSON.parse(fs.readFileSync('package-lock.json'));
    assert.equal(require(`${name}/package.json`).version, lock.packages[`node_modules/${name}`].version, `Dependency drift: ${name}`);
  }
  require('reflect-metadata');
  require('ts-node').register({ project: '/app/tsconfig.json', transpileOnly: true });
  require('tsconfig-paths').register({ baseUrl: '/app', paths: { '@/*': ['src/*'] } });
  const { Test } = require('@nestjs/testing');
  const { ConfigService } = require('@nestjs/config');
  const { VALIDATED_ENV_PROPNAME } = require('@nestjs/config/dist/config.constants');
  const { JwtService } = require('@nestjs/jwt');
  const { APP_GUARD } = require('@nestjs/core');
  const { Logger, ValidationPipe } = require('@nestjs/common');
  Logger.overrideLogger(false);
  const load = (file, name) => require(`/app/src/${file}`)[name];
  const PrismaService = load('prisma/prisma.service', 'PrismaService');
  const AuthService = load('auth/auth.service', 'AuthService');
  const AuthController = load('auth/auth.controller', 'AuthController');
  const BusinessCapabilitiesService = load('auth/business-capabilities.service', 'BusinessCapabilitiesService');
  const EmployeeEffectiveDateService = load('employee-archives/employee-effective-date.service', 'EmployeeEffectiveDateService');
  const DingtalkService = load('dingtalk/dingtalk.service', 'DingtalkService');
  const JwtAuthGuard = load('common/guards/jwt-auth.guard', 'JwtAuthGuard');
  const PayrollController = load('payroll/payroll.controller', 'PayrollController');
  const PayrollReadinessController = load('payroll/payroll-readiness.controller', 'PayrollReadinessController');
  const PayrollAccessService = load('payroll/payroll-access.service', 'PayrollAccessService');
  const PayrollDataService = load('payroll/payroll-data.service', 'PayrollDataService');
  const PayrollGrantsService = load('payroll/payroll-grants.service', 'PayrollGrantsService');
  const PayrollParameterReleasesService = load('payroll/payroll-parameter-releases.service', 'PayrollParameterReleasesService');
  const PayrollSourcesService = load('payroll/payroll-sources.service', 'PayrollSourcesService');
  const PayrollBatchesService = load('payroll/payroll-batches.service', 'PayrollBatchesService');
  const PayrollReadinessService = load('payroll/payroll-readiness.service', 'PayrollReadinessService');
  const PayrollExportService = load('payroll/payroll-export.service', 'PayrollExportService');
  const RosterSensitiveExportService = load('users/roster-sensitive-export.service', 'RosterSensitiveExportService');
  const ResponseInterceptor = load('common/interceptors/response.interceptor', 'ResponseInterceptor');
  const HttpExceptionFilter = load('common/filters/http-exception.filter', 'HttpExceptionFilter');
  const { payrollDays } = require('/app/src/payroll/payroll-data.service');
  const { fictionalDeductionsInput } = require('/app/src/payroll/payroll-deductions-preview.fixture');
  const values = { PAYROLL_ENABLED: 'true', PAYROLL_FORMAL_ENABLED: 'true', HRM_PREVIEW: 'false', ENABLE_TEST_QUICK_LOGIN: 'false', JWT_EXPIRES_IN: '1h' };
  const config = new ConfigService({ ...values, [VALIDATED_ENV_PROPNAME]: { ...values } });
  const db = new PrismaService({ log: [], errorFormat: 'minimal' });
  let gatewayCalls = 0;
  const setupControllers = [], setupProviders = [];
  if (setupOnly) {
    const SyncController = load('payroll/payroll-attendance-sync.controller', 'PayrollAttendanceSyncController');
    const SyncService = load('payroll/payroll-attendance-sync.service', 'PayrollAttendanceSyncService');
    const Gateway = load('dingtalk/dingtalk-attendance.service', 'DingtalkAttendanceService');
    const syncValues = { ...values, DINGTALK_ATTENDANCE_SYNC_ENABLED: 'true' };
    const syncConfig = new ConfigService({ ...syncValues, [VALIDATED_ENV_PROPNAME]: syncValues });
    const gateway = new Proxy(new Gateway(Object.freeze({}), config), { get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' && key !== 'constructor' ? () => { gatewayCalls++; throw new Error('External gateway is prohibited in setup UI acceptance'); } : value;
    } });
    setupControllers.push(SyncController);
    setupProviders.push({ provide: SyncService, useFactory: (client, access, data) => new SyncService(client, access, data, gateway, Object.freeze({}), syncConfig),
      inject: [PrismaService, PayrollAccessService, PayrollDataService] });
  }
  const module = await Test.createTestingModule({
    controllers: [AuthController, PayrollController, PayrollReadinessController, ...setupControllers],
    providers: [{ provide: PrismaService, useValue: db }, { provide: ConfigService, useValue: config },
      { provide: JwtService, useValue: new JwtService({ secret: randomBytes(32).toString('hex'), signOptions: { expiresIn: '1h' } }) },
      { provide: DingtalkService, useValue: Object.freeze({}) },
      AuthService, BusinessCapabilitiesService, EmployeeEffectiveDateService, PayrollAccessService, PayrollDataService, PayrollGrantsService,
      PayrollParameterReleasesService, PayrollBatchesService, PayrollReadinessService, PayrollExportService, RosterSensitiveExportService,
      { provide: 'PAYROLL_SOURCE_READER', useClass: PayrollSourcesService }, { provide: APP_GUARD, useClass: JwtAuthGuard }, ...setupProviders],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  if (setupOnly) app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) && request.path !== '/api/v1/auth/login') {
      response.status(403).json({ code: 4030, message: 'Setup UI acceptance prohibits business writes' }); return;
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalInterceptors(new ResponseInterceptor()); app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
  assert.deepEqual(identity, { db: 'hrm_preview', role: 'hrm_preview' });
  const marker = await db.systemConfig.findUniqueOrThrow({ where: { key: 'local_preview_fixture_v1' } });
  assert.equal(marker.value.fictional, true);
  const originalDemo = await db.systemConfig.findUniqueOrThrow({ where: { key: 'payroll_preview_fixture_v1' } });
  assert.equal(originalDemo.value.fictional, true);
  const demoSubjectIds = originalDemo.value.subjectIds;
  assert.ok(Array.isArray(demoSubjectIds) && demoSubjectIds.length);
  const demoUserIds = Array.from(new Set([...(originalDemo.value.employeeIds ?? []), ...Object.values(originalDemo.value.actors ?? {})]));
  async function demoDigest() {
    return db.$transaction(async tx => {
      const records = { marker: await tx.systemConfig.findUnique({ where: { key: originalDemo.key } }),
        users: await tx.user.findMany({ where: { id: { in: demoUserIds } }, orderBy: { id: 'asc' } }),
        employments: await tx.employmentRecord.findMany({ where: { userId: { in: demoUserIds } }, orderBy: { id: 'asc' } }),
        subjects: await tx.contractSubject.findMany({ where: { id: { in: demoSubjectIds } }, orderBy: { id: 'asc' } }) };
      for (const model of ['payrollGrant', 'payrollPolicy', 'payrollStandard', 'payrollDeductionProfile', 'payrollParameterRelease', 'payrollAttendanceSnapshot',
        'payrollAttendanceSyncJob', 'payrollOpeningBalance', 'payrollAdjustment', 'payrollBatch', 'payrollEvent', 'payrollNetPayment', 'payrollNetReservation']) {
        records[model] = await tx[model].findMany({ where: { subjectId: { in: demoSubjectIds } },
          orderBy: model === 'payrollNetReservation' ? [{ subjectId: 'asc' }, { employeeId: 'asc' }, { domain: 'asc' }, { taxYear: 'asc' }] : { id: 'asc' } });
      }
      return hash(json(records));
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
  }
  const demoBaseline = await demoDigest();
  const checks = await db.$queryRawUnsafe("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'payroll_batches'::regclass AND contype = 'c'");
  assert.ok(checks.some(row => row.definition.includes('reconciliation')));
  const environment = hash(process.env);
  const loaded = Object.values(require.cache).map(entry => entry.filename).filter(file => file.startsWith('/app/src/') && file.endsWith('.ts'));
  const guard = () => {
    require('/app/prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
    assert.equal(hash(process.env), environment, 'Container environment mutated');
    for (const file of loaded) assert.equal(hash(fs.readFileSync(file)), sourceHashes[file.slice('/app/'.length)], `Loaded source drift: ${file}`);
  };
  const services = { access: module.get(PayrollAccessService), grants: module.get(PayrollGrantsService), data: module.get(PayrollDataService),
    releases: module.get(PayrollParameterReleasesService), batches: module.get(PayrollBatchesService) };
  const fixtures = [];
  async function emptySetupState(subjectId) {
    const state = {};
    for (const [label, model] of Object.entries({ rules: 'payrollPolicy', standards: 'payrollStandard', deductions: 'payrollDeductionProfile',
      parameterReleases: 'payrollParameterRelease', attendance: 'payrollAttendanceSnapshot', syncJobs: 'payrollAttendanceSyncJob', batches: 'payrollBatch',
      openings: 'payrollOpeningBalance', adjustments: 'payrollAdjustment', payments: 'payrollNetPayment', reservations: 'payrollNetReservation' })) {
      state[label] = await db[model].count({ where: { subjectId } });
    }
    return state;
  }
  async function createSetupFixture() {
    guard();
    const runId = randomUUID(), prefix = `PRUI_${runId.slice(0, 8)}`, subjectId = randomUUID(), departmentId = randomUUID();
    const users = Object.fromEntries(['admin', 'hr', 'manager', 'reviewer', 'approver', 'employee', 'conflict'].map(role => [role, randomUUID()]));
    const fixture = { runId, prefix, subjectId, departmentId, users, key: `payroll_readiness_ui_run:${runId}`,
      employmentIds: [randomUUID(), randomUUID(), randomUUID()], month: '2026-10', setupOnly: true };
    fixtures.push(fixture);
    const password = randomBytes(24).toString('base64url'), passwordHash = await require('bcrypt').hash(password, 4);
    const actor = role => ({ id: users[role], sysRole: role === 'admin' ? 'system_admin' : role === 'hr' ? 'hr' : 'employee', deptId: departmentId, isAssessorOnly: false });
    await db.$transaction(async tx => {
      await tx.systemConfig.create({ data: { key: fixture.key, value: { fictional: true, manifest: fixture } } });
      await tx.contractSubject.create({ data: { id: subjectId, name: `${prefix}_subject_fictional` } });
      await tx.department.create({ data: { id: departmentId, name: `${prefix}_department_fictional` } });
      for (const [role, id] of Object.entries(users)) await tx.user.create({ data: { id, name: `${prefix}_${role}_fictional`, employeeNo: `${prefix}_${role}`,
        deptId: departmentId, status: 'active', accountType: ['employee', 'conflict'].includes(role) ? 'employee' : 'service', sysRole: actor(role).sysRole,
        hrCapabilities: role === 'hr' ? ['employee_archive_edit'] : [], passwordHash, mustChangePassword: false } });
      await tx.user.update({ where: { id: users.hr }, data: { directManagerId: users.manager } });
      for (const [index, id] of fixture.employmentIds.entries()) {
        const role = index === 0 ? 'employee' : 'conflict';
        await tx.employmentRecord.create({ data: { id, userId: users[role], employeeNo: `${prefix}_${role}`, deptId: departmentId, contractSubjectId: subjectId,
          effectiveFrom: new Date(index === 2 ? '2026-10-16' : '2026-10-01'), effectiveTo: new Date('2026-10-31'), entryDate: new Date('2026-10-01'), employeeStatus: 'active',
          changeType: 'initial', sourceType: 'payroll_readiness_ui_fictional', sourceRequestId: null, createdById: users.hr } });
      }
    });
    for (const [role, capabilities] of [['hr', ['attendance_edit', 'attendance_seal', 'payroll_edit', 'payroll_export', 'payroll_settle']],
      ['reviewer', ['payroll_review']], ['approver', ['payroll_approve']]]) {
      await services.grants.save({ subjectId, userId: users[role], capabilities, expectedUpdatedAt: null, reason: `${prefix}:fictional-setup` }, actor('admin'));
    }
    assert.ok(Object.values(await emptySetupState(subjectId)).every(count => count === 0));
    return { subjectId, prefix, month: fixture.month, employeeId: users.employee, employeeName: `${prefix}_employee_fictional`, conflictId: users.conflict,
      conflictName: `${prefix}_conflict_fictional`, credentials: Object.fromEntries(['hr', 'reviewer', 'approver'].map(role => [role, { employeeNo: `${prefix}_${role}`, password }])) };
  }
  async function createFixture() {
    guard();
    const runId = randomUUID(), prefix = `PRUI_${runId.slice(0, 8)}`, subjectId = randomUUID(), departmentId = randomUUID();
    const users = Object.fromEntries(['admin', 'hr', 'manager', 'reviewer', 'approver', 'employee'].map(role => [role, randomUUID()]));
    const key = `payroll_readiness_ui_run:${runId}`, password = randomBytes(24).toString('base64url');
    const fixture = { runId, prefix, subjectId, departmentId, users, key, employmentId: randomUUID(), month: '2025-10', payDate: '2025-11-10' };
    fixtures.push(fixture);
    const actor = role => ({ id: users[role], sysRole: role === 'admin' ? 'system_admin' : role === 'hr' ? 'hr' : 'employee', deptId: departmentId, isAssessorOnly: false });
    const passwordHash = await require('bcrypt').hash(password, 4);
    await db.$transaction(async tx => {
      await tx.systemConfig.create({ data: { key, value: { fictional: true, manifest: fixture } } });
      await tx.contractSubject.create({ data: { id: subjectId, name: `${prefix}_subject_fictional` } });
      await tx.department.create({ data: { id: departmentId, name: `${prefix}_department_fictional` } });
      for (const [role, id] of Object.entries(users)) await tx.user.create({ data: { id, name: `${prefix}_${role}_fictional`, employeeNo: `${prefix}_${role}`,
        deptId: departmentId, status: 'active', accountType: role === 'employee' ? 'employee' : 'service', sysRole: actor(role).sysRole, passwordHash, mustChangePassword: false } });
      await tx.user.update({ where: { id: users.hr }, data: { directManagerId: users.manager } });
      await tx.employmentRecord.create({ data: { id: fixture.employmentId, userId: users.employee, employeeNo: `${prefix}_employee`, deptId: departmentId,
        contractSubjectId: subjectId, effectiveFrom: new Date('2025-10-01'), effectiveTo: new Date('2025-10-31'), entryDate: new Date('2025-10-01'),
        employeeStatus: 'active', changeType: 'initial', sourceType: 'payroll_readiness_ui_fictional', createdById: users.hr } });
    });
    for (const [role, capabilities] of [['hr', ['attendance_edit', 'attendance_seal', 'payroll_view', 'payroll_edit']], ['reviewer', ['payroll_review']], ['approver', ['payroll_approve', 'payroll_settle']]]) {
      await services.grants.save({ subjectId, userId: users[role], capabilities, expectedUpdatedAt: null, reason: `${prefix}:fictional` }, actor('admin'));
    }
    const publish = async (kind, parameter) => {
      const release = await services.releases.submit(kind, parameter.id, parameter.version, actor('hr'));
      assert.equal(release.reviewerId, users.manager);
      await services.releases.decide(release.id, { expectedVersion: release.attempt, decision: 'approve', note: `${prefix}:fictional-reviewed` }, actor('manager'));
    };
    const days = payrollDays(fixture.month);
    await publish('rule', await services.data.saveRule({ subjectId, effectiveFrom: days[0], effectiveTo: days.at(-1), config: {
      employeeScope: { employeeIds: [users.employee], evidenceRef: `${prefix}:explicit-fictional-payer` }, fixedSalaryBasis: 'monthly_workdays',
      workCalendars: { [fixture.month]: { sourceVersion: `${prefix}:calendar`, evidenceRef: 'Fictional calendar', days: days.map((workDate, index) => ({ workDate, units: index < 20 ? '1' : '0' })) } },
      monthlyUnits: {}, rounding: 'item_half_up', normalHourly: null, paidHourly: {}, overtime: {}, reviewers: [users.reviewer], approvers: [users.approver], cutoverMonth: fixture.month,
      performance: { [fixture.month]: { sourceKind: 'manual', cycleIds: [], coefficients: {}, manualAmounts: { [users.employee]: '1234.56' }, evidenceRef: `${prefix}:fictional-performance` } },
    } }, actor('hr')));
    await publish('standard', await services.data.saveStandard({ subjectId, employeeId: users.employee, effectiveFrom: days[0], effectiveTo: days.at(-1),
      fixedMonthly: '10000', performanceBase: null, performanceMode: 'additional', evidence: `${prefix}:fictional-standard` }, actor('hr')));
    const { subjectId: _s, employeeId: _e, payDate: _p, gross: _g, ...settings } = fictionalDeductionsInput({ subjectId, employeeId: users.employee, month: fixture.month, payDate: fixture.payDate, gross: '0' });
    const { subjectId: _os, employeeId: _oe, year: _y, ...opening } = settings.tax.opening;
    settings.tax.opening = opening; settings.ledger = { startDate: '2025-01-01', priorInPayMonth: Object.fromEntries(Object.keys(settings.tax.current).map(field => [field, '0'])), priorSocialInsurance: '0', priorHousingFund: '0' };
    await publish('deduction', await services.data.saveDeductions({ subjectId, employeeId: users.employee, payDate: fixture.payDate, settings }, actor('hr')));
    for (const itemCode of ['fixed', 'absence', 'overtime', 'performance', 'adjustment']) await services.data.confirmOpening({ subjectId, employeeId: users.employee,
      month: fixture.month, itemCode, amount: '0', reference: `${prefix}:fictional-opening` }, actor('approver'));
    const attendance = await services.data.syncVerified({ subjectId, month: fixture.month, sourceKey: `${prefix}:attendance`, complete: true, input: {
      month: fixture.month, expected: days.map((workDate, index) => ({ employeeId: users.employee, workDate, required: index < 20, units: index < 20 ? '1' : '0' })),
      records: days.slice(0, 20).map(workDate => ({ sourceId: `${prefix}:${workDate}`, sourceVersion: 1, employeeId: users.employee, workDate,
        startsAt: `${workDate}T08:00:00+08:00`, endsAt: `${workDate}T16:00:00+08:00`, type: 'normal', state: 'effective', hours: '8', unit: 'hour' })),
    } }, actor('hr'), async () => ({ fictional: true, runId, complete: true, source: 'readiness-ui-owned-fixture' }));
    await services.data.review(attendance.id, { note: `${prefix}:fictional-checked` }, actor('hr'));
    await services.data.seal(attendance.id, attendance.version, actor('hr'));
    const batch = await services.batches.create({ subjectId, month: fixture.month, payMonth: '2025-11', purpose: 'reconciliation' }, actor('hr'));
    const calculated = await services.batches.calculate(batch.id, { expectedVersion: batch.version, payDate: fixture.payDate }, actor('hr'));
    const detail = await services.batches.detail(batch.id, actor('hr'));
    assert.deepEqual(detail.versions[0].issues, []); assert.ok(detail.versions[0].netSnapshot.totals);
    assert.equal(await db.systemConfig.count({ where: { key: `payroll_formal_readiness:${subjectId}` } }), 0);
    fixture.batchId = batch.id;
    return { subjectId, batchId: batch.id, month: fixture.month, firstMonth: fixture.month, net: detail.versions[0].netSnapshot.totals.net,
      credentials: Object.fromEntries(['hr', 'reviewer', 'approver'].map(role => [role, { employeeNo: `${prefix}_${role}`, password }])), batchVersion: calculated.version };
  }
  async function inspect(subjectId) {
    assert.ok(fixtures.some(fixture => fixture.subjectId === subjectId));
    const requests = await db.systemConfig.findMany({ where: { key: { startsWith: 'payroll_readiness_request:' }, value: { path: ['subjectId'], equals: subjectId } } });
    const receipt = await db.systemConfig.findUnique({ where: { key: `payroll_formal_readiness:${subjectId}` } });
    const request = requests.at(-1)?.value;
    const finances = { payments: await db.payrollNetPayment.count({ where: { subjectId } }), reservations: await db.payrollNetReservation.count({ where: { subjectId } }),
      settlements: await db.payrollSettlement.count({ where: { line: { version: { batch: { subjectId } } } } }), exports: await db.payrollExportRecord.count({ where: { version: { batch: { subjectId } } } }) };
    return { requestCount: requests.length, state: request?.status ?? null, step: request?.approvalStep ?? null, decisions: request?.decisions.length ?? 0,
      receipt: receipt?.value?.state ?? null, finalSignerMatches: !!receipt && receipt.value.approvedById === fixtures.find(fixture => fixture.subjectId === subjectId).users.approver,
      finances, environmentUnchanged: hash(process.env) === environment };
  }
  async function cleanup() {
    for (const fixture of fixtures) await db.$transaction(async tx => {
      const marker = await tx.systemConfig.findUnique({ where: { key: fixture.key } });
      if (!marker) {
        assert.equal(await tx.user.count({ where: { id: { in: Object.values(fixture.users) } } }), 0);
        assert.equal(await tx.contractSubject.count({ where: { id: fixture.subjectId } }), 0);
        return;
      }
      assert.equal(marker.value.fictional, true); assert.equal(marker.value.manifest.subjectId, fixture.subjectId);
      assert.deepEqual(marker.value.manifest.users, fixture.users);
      const ids = Object.values(fixture.users), subjectScope = { subjectId: fixture.subjectId }, versionScope = { version: { batch: subjectScope } };
      const people = await tx.user.findMany({ where: { id: { in: ids } } });
      assert.equal(people.length, ids.length); assert.ok(people.every(person => person.employeeNo.startsWith(fixture.prefix) && !person.dingtalkId && !person.dingtalkUnionId));
      const requests = await tx.systemConfig.findMany({ where: { key: { startsWith: 'payroll_readiness_request:' }, value: { path: ['subjectId'], equals: fixture.subjectId } } });
      await tx.systemConfig.deleteMany({ where: { key: { in: [fixture.key, `payroll_formal_readiness:${fixture.subjectId}`, ...requests.map(row => row.key)] } } });
      await tx.payrollNetReservation.deleteMany({ where: subjectScope }); await tx.payrollNetPayment.deleteMany({ where: subjectScope });
      await tx.payrollSettlement.deleteMany({ where: { line: versionScope } }); await tx.payrollReservation.deleteMany({ where: subjectScope });
      await tx.payrollDecision.deleteMany({ where: versionScope }); await tx.payrollExportRecord.deleteMany({ where: versionScope });
      await tx.payrollLine.deleteMany({ where: versionScope }); await tx.payrollVersion.deleteMany({ where: { batch: subjectScope } });
      for (const model of ['payrollBatch', 'payrollEvent', 'payrollParameterRelease', 'payrollAdjustment', 'payrollOpeningBalance', 'payrollStandard', 'payrollDeductionProfile', 'payrollPolicy', 'payrollAttendanceSnapshot', 'payrollGrant']) await tx[model].deleteMany({ where: subjectScope });
      await tx.employmentRecord.deleteMany({ where: { id: { in: fixture.employmentIds ?? [fixture.employmentId] }, userId: { in: ids } } });
      await tx.user.updateMany({ where: { id: { in: ids } }, data: { directManagerId: null } });
      await tx.user.deleteMany({ where: { id: { in: ids }, employeeNo: { startsWith: fixture.prefix } } });
      await tx.department.delete({ where: { id: fixture.departmentId } }); await tx.contractSubject.delete({ where: { id: fixture.subjectId } });
      assert.equal(await tx.user.count({ where: { id: { in: ids } } }), 0);
      assert.equal(await tx.payrollBatch.count({ where: subjectScope }), 0);
    }, { timeout: 60000 });
    assert.equal(await demoDigest(), demoBaseline, 'Original payroll demo changed');
    assert.equal(gatewayCalls, 0);
    fixtures.length = 0;
  }
  try {
    guard(); await app.listen(3001, '127.0.0.1'); line({ ready: true, sourceCount: loaded.length });
    for await (const raw of { [Symbol.asyncIterator]: () => iterator }) {
      const command = JSON.parse(raw);
      try {
        if (command.op !== 'stop') guard();
        const data = command.op === 'create' ? await (setupOnly ? createSetupFixture() : createFixture())
          : command.op === 'inspect' && setupOnly ? (assert.ok(fixtures.some(fixture => fixture.subjectId === command.subjectId)),
            { emptyState: await emptySetupState(command.subjectId), gatewayCalls, environmentUnchanged: hash(process.env) === environment })
          : command.op === 'inspect' ? await inspect(command.subjectId)
          : command.op === 'stop' ? (await cleanup(), { cleaned: true, demoUnchanged: true, gatewayCalls, environmentUnchanged: hash(process.env) === environment }) : assert.fail('Unsupported control command');
        line({ id: command.id, data }); if (command.op === 'stop') break;
      } catch (error) { line({ id: command.id, error: `${error.name}:${error.message}` }); }
    }
  } finally { if (fixtures.length) await cleanup(); await app.close(); }
}

async function run() {
  const apiRoot = path.join(root, 'api'), webRoot = path.join(root, 'web');
  const inspect = JSON.parse(spawnSync('docker', ['inspect', container], { encoding: 'utf8' }).stdout)[0];
  const mount = inspect.Mounts.find(row => row.Destination === '/app');
  const normalizeMount = value => value.replaceAll('\\', '/').toLowerCase();
  const dockerDesktopMount = `/run/desktop/mnt/host/${apiRoot[0]}${apiRoot.slice(2)}`;
  assert.ok([apiRoot, dockerDesktopMount].map(normalizeMount).includes(normalizeMount(mount.Source)), 'Verification mount must be this exact checkout');
  assert.ok(!Object.values(inspect.NetworkSettings.Ports ?? {}).some(value => value?.length), 'Verification container must remain unpublished');
  const sourceHashes = Object.fromEntries([...files(path.join(apiRoot, 'src')).filter(file => file.endsWith('.ts')), path.join(apiRoot, 'package.json'), path.join(apiRoot, 'package-lock.json'), path.join(apiRoot, 'prisma/schema.prisma'), path.join(apiRoot, script)].map(file => [path.relative(apiRoot, file).replaceAll('\\', '/'), hash(fs.readFileSync(file))]));
  const webSources = Object.fromEntries(files(path.join(webRoot, 'src')).filter(file => /\.(ts|vue|css)$/.test(file)).map(file => [file, hash(fs.readFileSync(file))]));
  const processApi = spawn('docker', ['exec', '-i', container, 'node', script, '--api'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, readyResolve, readyReject;
  const pending = new Map(), controlToken = randomBytes(32).toString('hex');
  const started = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const lines = createInterface({ input: processApi.stdout });
  lines.on('line', raw => {
    try { const value = JSON.parse(raw); if (value.ready) readyResolve(value);
      else { const request = pending.get(value.id); if (request) { pending.delete(value.id); value.error ? request.reject(new Error(value.error)) : request.resolve(value.data); } }
    } catch { readyReject(new Error('Non-protocol output from isolated API')); }
  });
  let apiError = '';
  processApi.stderr.on('data', part => { apiError += part; });
  processApi.on('exit', code => { readyReject(new Error(`Isolated API exited ${code}: ${apiError.slice(0, 300)}`)); for (const request of pending.values()) request.reject(new Error('Isolated API exited')); });
  const call = (op, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Isolated control timeout: ${op}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    processApi.stdin.write(JSON.stringify({ id, op, ...extra }) + '\n');
  });
  const setupOnly = process.argv.includes('--setup-only');
  processApi.stdin.write(JSON.stringify({ sourceHashes, setupOnly }) + '\n');
  let proxy, vite, test, cleanupEvidence;
  try {
    const ready = await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Isolated API startup timeout')), 90000).unref())]);
    proxy = http.createServer(async (request, response) => {
      try {
        let body = ''; for await (const part of request) { body += part; assert.ok(body.length < 1000000); }
        if (request.url.startsWith('/__readiness-ui/')) {
          assert.equal(request.headers['x-readiness-ui-run'], controlToken);
          const data = await call(request.url.endsWith('/create') ? 'create' : 'inspect', body ? JSON.parse(body) : {});
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); return;
        }
        assert.ok(request.url.startsWith('/api/v1/'));
        const forwarding = spawn('docker', ['exec', '-i', container, 'node', script, '--forward'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        forwarding.stdout.on('data', part => { output += part; });
        forwarding.stderr.resume();
        forwarding.on('exit', code => {
          if (code !== 0) { response.writeHead(502); response.end('Isolated API forward failed'); return; }
          try { const value = JSON.parse(output); response.writeHead(value.status, value.headers); response.end(Buffer.from(value.body, 'base64')); }
          catch { response.writeHead(502); response.end('Invalid isolated API response'); }
        });
        const headers = { ...request.headers, host: '127.0.0.1:3001', connection: 'close' }; delete headers['transfer-encoding'];
        forwarding.stdin.end(JSON.stringify({ path: request.url, method: request.method, headers, body: Buffer.from(body).toString('base64') }));
      } catch { response.writeHead(500); response.end('Isolated verification refused request'); }
    });
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(3011, '127.0.0.1', resolve); });
    const { pathToFileURL } = require('node:url');
    const fromWeb = name => pathToFileURL(require.resolve(name, { paths: [webRoot] })).href;
    const viteModule = await import(fromWeb('vite'));
    const createServer = viteModule.createServer ?? viteModule.default.createServer;
    const vue = (await import(fromWeb('@vitejs/plugin-vue'))).default;
    const autoModule = await import(fromWeb('unplugin-auto-import/vite'));
    const componentsModule = await import(fromWeb('unplugin-vue-components/vite'));
    const auto = autoModule.default.default ?? autoModule.default;
    const components = componentsModule.default.default ?? componentsModule.default;
    const { ElementPlusResolver } = await import(fromWeb('unplugin-vue-components/resolvers'));
    vite = await createServer({ configFile: false, envFile: false, root: webRoot, cacheDir: path.join(root, 'test-results/payroll-readiness-ui/vite-cache'),
      plugins: [vue(), auto({ dts: false, resolvers: [ElementPlusResolver()] }), components({ dts: false, resolvers: [ElementPlusResolver()] })],
      optimizeDeps: { force: process.argv.includes('--cold'), include: ['vue', 'vue-router', 'element-plus', '@element-plus/icons-vue', 'pinia', 'axios', 'dayjs', 'echarts'] },
      resolve: { alias: { '@': path.join(webRoot, 'src') } }, define: { 'import.meta.env.VITE_PREVIEW_MODE': JSON.stringify('false'), 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
      server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3011', changeOrigin: true } } }, logLevel: 'error' });
    await vite.listen();
    if (!process.argv.includes('--no-warmup')) {
      const { chromium } = require(require.resolve('playwright', { paths: [webRoot] }));
      const browser = await chromium.launch({ headless: true });
      let fullReloads = 0, writes = 0, settled = false, attempts = 0;
      try {
        const page = await browser.newPage();
        await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5175' ? route.continue() : route.abort());
        page.on('request', request => { if (request.method() === 'POST') writes++; });
        page.on('websocket', socket => socket.on('framereceived', event => {
          try { if (JSON.parse(String(event.payload)).type === 'full-reload') fullReloads++; } catch { /* Not a Vite JSON frame. */ }
        }));
        for (; attempts < 3 && !settled; attempts++) {
          await page.goto('http://127.0.0.1:5175/login');
          await page.waitForLoadState('networkidle');
          try {
            await page.evaluate(async setup => {
              for (const source of ['/src/views/auth/LoginView.vue', '/src/views/compensation/payroll/PayrollBatchesView.vue',
                ...(setup ? ['/src/views/compensation/payroll/PayrollAttendanceView.vue', '/src/views/compensation/payroll/PayrollStandardsView.vue'] : [])]) await import(source);
            }, setupOnly);
            await page.waitForLoadState('networkidle');
            assert.equal(await page.evaluate(() => !!localStorage.getItem('token')), false);
            settled = true;
          } catch (error) {
            if (!/context was destroyed|Failed to fetch dynamically imported module|Importing a module/.test(error.message)) throw error;
          }
        }
        assert.ok(settled, 'Anonymous dependency warmup did not settle within three attempts');
        assert.equal(writes, 0, 'Warmup must not log in or write data');
        line({ warmup: { anonymous: true, attempts, fullReloads, writes } });
      } finally { await browser.close(); }
    }
    line({ started: true, frontend: 'http://127.0.0.1:5175', sourceCount: ready.sourceCount, realControllers: true });
    const playwright = path.join(webRoot, 'node_modules/@playwright/test/cli.js');
    const args = [playwright, 'test', '--config', 'playwright.readiness-ui.config.ts'];
    if (process.argv.includes('--desktop-only')) args.push('--project=desktop');
    if (process.argv.includes('--mobile-only')) args.push('--project=mobile');
    if (process.argv.includes('--candidates-only')) args.push('--grep', 'candidate dates isolate conflicts');
    test = spawn(process.execPath, args, { cwd: webRoot,
      env: { ...process.env, HRM_READINESS_UI_RUN: controlToken, HRM_READINESS_UI_COLD: process.argv.includes('--cold') ? '1' : '0', HRM_PAYROLL_SETUP_UI: setupOnly ? '1' : '0' }, stdio: 'inherit' });
    const code = await new Promise(resolve => test.once('exit', resolve));
    for (const [file, expected] of Object.entries(webSources)) assert.equal(hash(fs.readFileSync(file)), expected, `Frontend source drift: ${path.relative(webRoot, file)}`);
    process.exitCode = code || 0;
  } finally {
    if (processApi.exitCode === null && processApi.stdin.writable) {
      try { cleanupEvidence = await call('stop'); line({ cleanup: cleanupEvidence }); } catch { process.exitCode = 1; }
      processApi.stdin.end();
    }
    await vite?.close(); await new Promise(resolve => proxy ? proxy.close(resolve) : resolve());
    if (processApi.exitCode === null) await new Promise(resolve => processApi.once('exit', resolve));
    lines.close();
  }
}

if (require.main === module) {
  const work = process.argv.includes('--api') ? serve : process.argv.includes('--forward') ? forward : process.argv.includes('--run') ? run : null;
  if (!work) throw new Error('Use --run for the owned, temporary real-API/UI acceptance');
  work().catch(error => {
    console.error(`${error.name}: ${error.message}`); process.exitCode = 1;
    if (process.argv.includes('--api')) process.exit(1);
  });
}
