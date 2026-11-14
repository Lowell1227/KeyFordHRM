// Run only inside the existing, refreshed preview API container after explicit approval:
// node prisma/personnel-reference-preview-check.cjs --run
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { assertPreviewEnvironment } = require('./preview-guard.cjs');

const fixtureMarker = 'local_preview_fixture_v1';
const ownerKey = 'personnel_reference_preview_check_v1';
const fixtureSource = 'personnel_ref_preview_check';
const report = { status: 'failed', stage: 'guard', checks: {}, cleanup: { status: 'not_needed', deleted: 0 } };
const delegate = (model) => model[0].toLowerCase() + model.slice(1);
const idsOf = (rows) => rows.map((row) => row.id);

async function main() {
  let prisma;
  let initialized = false;
  let cleanup;
  try {
    assert.deepEqual(process.argv.slice(2), ['--run']);
    assertPreviewEnvironment(process.env);
    const { Prisma, PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ log: [] });
    const [database] = await prisma.$queryRaw`SELECT current_database() AS name, current_user AS role`;
    assert.equal(database.name, 'hrm_preview');
    assert.equal(database.role, 'hrm_preview');
    const marker = await prisma.systemConfig.findUnique({ where: { key: fixtureMarker } });
    assert.equal(marker?.value?.fictional, true);
    const kinds = await prisma.$queryRaw`SELECT e.enumlabel AS kind FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'personnel_reference_data_kind'`;
    assert.ok(['job_grade', 'education', 'marital_status', 'political_status', 'household_type',
      'contact_relation', 'bank_name', 'contract_name'].every((kind) => kinds.some((item) => item.kind === kind)));
    // A leftover ownership record requires inspection, never automatic takeover or broad cleanup.
    assert.equal(await prisma.systemConfig.count({ where: { key: ownerKey } }), 0);
    report.checks.isolated_preview = 'passed';

    report.stage = 'load_service';
    require('reflect-metadata');
    require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
    require('tsconfig-paths').register({ baseUrl: path.join(__dirname, '..'), paths: { '@/*': ['src/*'] } });
    const { EmployeeRosterImportService } = require('../src/employee-archives/employee-roster-import.service.ts');
    const { shanghaiBusinessDate } = require('../src/employee-archives/employment-timeline.ts');
    const { ConfigService } = require('@nestjs/config');
    const { ERROR_CODE } = require('../src/common/constants/error-codes.ts');
    const { EmployeeRosterImportClosedGuard } = require('../src/employee-archives/employee-roster-import-closed.guard.ts');
    assert.throws(() => new EmployeeRosterImportClosedGuard().canActivate(), (error) => error.getStatus?.() === 403);
    report.checks.http_import_still_closed = 'passed';
    const service = new EmployeeRosterImportService(prisma, new ConfigService());
    const runId = randomUUID();
    const suffix = runId.replaceAll('-', '').slice(0, 16);
    const today = shanghaiBusinessDate();
    const department = { id: randomUUID(), name: `PRC Department ${suffix}` };
    const operator = { id: randomUUID(), name: `PRC Operator ${suffix}`, sysRole: 'hr',
      deptId: department.id, isAssessorOnly: false, canViewAll: false };
    const employees = ['A', 'B'].map((letter) => ({ id: randomUUID(), profileId: randomUUID(),
      employmentId: randomUUID(), employeeNo: `PRC${suffix}${letter}`, name: `PRC Employee ${suffix}${letter}` }));
    const option = { id: randomUUID(), kind: 'education', name: `PRC Education ${suffix}` };
    const oldEducation = `PRC Legacy ${suffix}`;
    const oldGrade = `PRC-G-${suffix}`;
    const position = `PRC Position ${suffix}`;
    const companyText = '\u5b5a\u5fb7';
    const manifest = { fictional: true, script: ownerKey, runId, department, operator, employees, option };
    const cases = [];
    const formalSnapshot = () => prisma.user.findMany({
      where: { id: { in: idsOf(employees) } }, orderBy: { id: 'asc' },
      select: { id: true, name: true, employeeNo: true, phone: true, deptId: true, position: true,
        directManagerId: true, status: true, entryDate: true, employmentType: true, updatedAt: true,
        employeeProfile: true, employmentHistory: { orderBy: { id: 'asc' } }, employeeContracts: true },
    });
    const row = (employee, rowNumber, education, nextPosition = position) => ({
      rowNumber,
      employee: { name: employee.name, employeeNo: employee.employeeNo, companyText,
        departmentPath: [department.name], position: nextPosition, jobGrade: oldGrade,
        jobFamily: null, managerName: null, entryDate: today, workLocation: null,
        employmentTypeText: '\u5168\u804c', employeeStatusText: '\u6b63\u5f0f', probationMonths: null,
        plannedRegularDate: null, actualRegularDate: null },
      profile: { education, phone: null, gender: null, birthDate: null, ethnicity: null,
        professionalTitle: null, school: null, graduationDate: null, major: null, maritalStatus: null,
        childrenStatus: null, childrenCount: null, politicalStatus: null, nativePlace: null,
        householdType: null, idAddress: null, idNumber: null, currentAddress: null,
        emergencyContactName: null, emergencyContactRelation: null, emergencyContactPhone: null,
        socialSecurityStatus: null, socialSecurityStartDate: null, housingFundStatus: null,
        housingFundStartDate: null, bankName: null, bankBranch: null, bankAccount: null },
      contracts: [],
    });
    const preview = async (label, rows) => {
      assert.equal(shanghaiBusinessDate().getTime(), today.getTime());
      const source = { mode: 'incremental', fileName: `${ownerKey}-${runId}-${label}.xlsx`,
        fileHash: createHash('sha256').update(JSON.stringify({ runId, label, rows })).digest('hex') };
      // Record provenance before calling the service, including a preview that fails after batch creation.
      const testCase = { source, rows };
      cases.push(testCase);
      testCase.result = await service.createPreviewFromRows(rows, source, operator);
      return testCase;
    };
    const confirm = (testCase) => {
      assert.equal(shanghaiBusinessDate().getTime(), today.getTime());
      return service.confirmFromRows(testCase.result.batchId, testCase.rows, testCase.source.fileHash, operator);
    };

    cleanup = async () => prisma.$transaction(async (tx) => {
      const owner = await tx.systemConfig.findUnique({ where: { key: ownerKey } });
      assert.deepEqual(owner?.value, manifest);
      const owned = new Map();
      const track = (model, ids, where) => owned.set(model, { ids, where });
      track('Department', [department.id], { name: department.name, fullPath: department.name });
      track('User', [operator.id, ...idsOf(employees)], { OR: [
        { id: operator.id, name: operator.name, accountType: 'service', deptId: department.id },
        ...employees.map((employee) => ({ id: employee.id, employeeNo: employee.employeeNo,
          name: employee.name, accountType: 'employee', deptId: department.id })),
      ] });
      track('EmployeeProfile', employees.map((employee) => employee.profileId), { userId: { in: idsOf(employees) } });
      track('EmploymentRecord', employees.map((employee) => employee.employmentId), {
        userId: { in: idsOf(employees) }, createdById: operator.id, sourceType: fixtureSource,
      });
      const storedOption = await tx.personnelReferenceData.findUnique({ where: { id: option.id } });
      track('PersonnelReferenceData', storedOption ? [option.id] : [], { kind: option.kind, name: option.name });
      const batchIds = [];
      const rowIds = [];
      const requestIds = [];
      for (const testCase of cases) {
        const batches = await tx.employeeImportBatch.findMany({ where: { operatorId: operator.id,
          mode: 'incremental', originalFileName: testCase.source.fileName, fileHash: testCase.source.fileHash } });
        assert.ok(batches.length <= 1);
        if (testCase.result) assert.deepEqual(idsOf(batches), [testCase.result.batchId]);
        for (const batch of batches) {
          assert.ok(batch.confirmedById === null || batch.confirmedById === operator.id);
          batchIds.push(batch.id);
          for (const item of await tx.employeeImportRow.findMany({ where: { batchId: batch.id } })) {
            const raw = testCase.rows.find((entry) => entry.rowNumber === item.rowNumber);
            const employee = employees.find((entry) => entry.employeeNo === raw?.employee.employeeNo);
            assert.ok(employee && item.matchedUserId === employee.id);
            rowIds.push(item.id);
          }
          for (const request of await tx.employeeDataChangeRequest.findMany({ where: { sourceBatchId: batch.id } })) {
            const raw = testCase.rows.find((entry) => entry.rowNumber === request.sourceRowNumber);
            const employee = employees.find((entry) => entry.employeeNo === raw?.employee.employeeNo);
            assert.ok(employee && request.userId === employee.id && request.employeeNo === employee.employeeNo);
            assert.equal(request.createdById, operator.id);
            assert.equal(request.sourceType, 'employee_roster_import');
            assert.equal(request.profileReviewStatus, 'pending');
            assert.equal(request.appliedAt, null);
            requestIds.push(request.id);
          }
        }
      }
      track('EmployeeImportBatch', batchIds, { operatorId: operator.id, mode: 'incremental' });
      track('EmployeeImportRow', rowIds, { batchId: { in: batchIds }, matchedUserId: { in: idsOf(employees) } });
      track('EmployeeDataChangeRequest', requestIds, { sourceBatchId: { in: batchIds }, createdById: operator.id });
      const audits = await tx.auditLog.findMany({ where: { userId: operator.id,
        entityType: 'employee_import_batch', entityId: { in: batchIds }, action: 'submit_employee_roster_review' },
        select: { id: true } });
      track('AuditLog', idsOf(audits), { userId: operator.id, entityId: { in: batchIds },
        entityType: 'employee_import_batch', action: 'submit_employee_roster_review' });

      // Lock exact owned parents before inspecting inbound FKs, preventing cascading into new foreign work.
      for (const [model, entry] of owned) {
        if (!entry.ids.length) continue;
        const metadata = Prisma.dmmf.datamodel.models.find((item) => item.name === model);
        assert.match(metadata.dbName, /^[a-z_][a-z0-9_]*$/);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${metadata.dbName}"`)}
          WHERE id IN (${Prisma.join(entry.ids.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`);
        assert.equal(await tx[delegate(model)].count({ where: { id: { in: entry.ids }, ...entry.where } }), entry.ids.length);
      }
      // Reject any inbound relationship whose row is not in this run's exact ownership set.
      for (const model of Prisma.dmmf.datamodel.models) {
        const references = model.fields.filter((field) => field.kind === 'object'
          && field.relationFromFields?.length && owned.get(field.type)?.ids.length);
        if (!references.length) continue;
        const predicates = references.map((field) => {
          assert.equal(field.relationFromFields.length, 1);
          assert.deepEqual(field.relationToFields, ['id']);
          return { [field.relationFromFields[0]]: { in: owned.get(field.type).ids } };
        });
        const permitted = owned.get(model.name)?.ids ?? [];
        assert.equal(await tx[delegate(model.name)].count({ where: { OR: predicates,
          ...(permitted.length ? { id: { notIn: permitted } } : {}) } }), 0);
      }
      let deleted = 0;
      for (const model of ['AuditLog', 'EmployeeImportRow', 'EmploymentRecord', 'EmployeeDataChangeRequest',
        'EmployeeImportBatch', 'EmployeeProfile', 'User', 'Department', 'PersonnelReferenceData']) {
        const entry = owned.get(model);
        const result = await tx[delegate(model)].deleteMany({ where: { id: { in: entry.ids }, ...entry.where } });
        assert.equal(result.count, entry.ids.length);
        deleted += result.count;
      }
      assert.deepEqual((await tx.systemConfig.findUnique({ where: { key: ownerKey } }))?.value, manifest);
      await tx.systemConfig.delete({ where: { key: ownerKey } });
      for (const [model, entry] of owned) {
        assert.equal(await tx[delegate(model)].count({ where: { id: { in: entry.ids } } }), 0);
      }
      assert.equal((await tx.systemConfig.findUnique({ where: { key: fixtureMarker } }))?.value?.fictional, true);
      return { status: 'passed', deleted: deleted + 1, remaining: 0 };
    }, { timeout: 60_000 });

    report.stage = 'fixtures';
    await prisma.$transaction(async (tx) => {
      await tx.systemConfig.create({ data: { key: ownerKey, value: manifest } });
      await tx.department.create({ data: { ...department, fullPath: department.name, company: 'fuede' } });
      await tx.user.create({ data: { id: operator.id, name: operator.name, sysRole: 'hr',
        accountType: 'service', deptId: department.id } });
      for (const employee of employees) {
        await tx.user.create({ data: { id: employee.id, name: employee.name, employeeNo: employee.employeeNo,
          deptId: department.id, position, entryDate: today, directManagerId: operator.id,
          employeeProfile: { create: { id: employee.profileId, education: oldEducation } },
          employmentHistory: { create: { id: employee.employmentId, effectiveFrom: today, effectiveTo: today,
            company: 'fuede', companyText, deptId: department.id, position, entryDate: today,
            employeeNo: employee.employeeNo, jobGrade: oldGrade, directManagerId: operator.id,
            changeType: 'preview_fixture', sourceType: fixtureSource, createdById: operator.id } } } });
      }
    });
    initialized = true;
    const baseline = await formalSnapshot();
    const [businessDate] = await prisma.$queryRaw`
      SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date)::text AS day`;
    assert.equal(today.toISOString().slice(0, 10), businessDate.day);
    const todayEmployment = await prisma.$queryRaw(Prisma.sql`
      SELECT id FROM employment_records WHERE id IN (${Prisma.join(employees.map((employee) => Prisma.sql`${employee.employmentId}::uuid`))})
      AND source_request_id IS NULL
      AND effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
      AND effective_to = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date`);
    assert.equal(todayEmployment.length, 2);
    report.checks.shanghai_end_today_db = 'passed';

    report.stage = 'unknown_education';
    const unknown = await preview('unknown', [row(employees[1], 2, option.name)]);
    assert.equal(unknown.result.canConfirm, false);
    assert.equal(unknown.result.summary.blockingErrorCount, 1);
    const blockedRows = await prisma.employeeImportRow.findMany({ where: { batchId: unknown.result.batchId } });
    assert.equal(blockedRows.length, 1);
    assert.equal(blockedRows[0].action, 'blocked');
    assert.equal(blockedRows[0].errors.length, 1);
    assert.ok(blockedRows[0].errors[0].startsWith('\u5b66\u5386'));
    report.checks.unknown_education_blocked = 'passed';

    report.stage = 'enabled_preview';
    await prisma.personnelReferenceData.create({ data: { ...option, isActive: true } });
    const valid = await preview('enabled', [row(employees[0], 2, oldEducation, `${position}-changed`),
      row(employees[1], 3, option.name)]);
    assert.equal(valid.result.canConfirm, true);
    assert.equal(valid.result.summary.blockingErrorCount, 0);
    assert.equal(valid.result.summary.updateCount, 2);
    report.checks.enabled_education_preview = 'passed';

    report.stage = 'disabled_confirmation_rollback';
    const beforeBatch = await service.findBatch(valid.result.batchId);
    assert.equal(beforeBatch.status, 'ready_to_confirm');
    await prisma.personnelReferenceData.update({ where: { id: option.id }, data: { isActive: false } });
    await assert.rejects(() => confirm(valid), (error) => {
      const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
      return error.getStatus?.() === 400 && response?.code === ERROR_CODE.PARAM_INVALID
        && Object.keys(response?.data?.fieldErrors ?? {}).join(',') === 'profile.education';
    });
    assert.deepEqual(await service.findBatch(valid.result.batchId), beforeBatch);
    assert.deepEqual(await formalSnapshot(), baseline);
    assert.equal(await prisma.employeeDataChangeRequest.count({ where: { sourceBatchId: valid.result.batchId } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { userId: operator.id, entityId: valid.result.batchId } }), 0);
    report.checks.confirm_revalidated_and_rolled_back = 'passed';

    report.stage = 'pending_only_confirmation';
    await prisma.personnelReferenceData.update({ where: { id: option.id }, data: { isActive: true } });
    const submitted = await confirm(valid);
    assert.equal(submitted.status, 'pending_review');
    assert.equal(submitted.submitted, 2);
    const requests = await prisma.employeeDataChangeRequest.findMany({ where: { sourceBatchId: valid.result.batchId } });
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.profileReviewStatus === 'pending' && request.appliedAt === null));
    const changedRequest = requests.find((request) => request.userId === employees[1].id);
    assert.equal(changedRequest?.proposedValue.profile.education, option.name);
    assert.deepEqual(await formalSnapshot(), baseline);
    report.checks.confirmation_pending_not_formal = 'passed';

    report.stage = 'legacy_unchanged';
    await prisma.personnelReferenceData.update({ where: { id: option.id }, data: { isActive: false } });
    assert.equal(await prisma.personnelReferenceData.count({ where: { OR: [
      { kind: 'education', name: oldEducation }, { kind: 'job_grade', name: oldGrade },
    ] } }), 0);
    const legacy = await preview('legacy', [row(employees[1], 2, oldEducation, `${position}-legacy`)]);
    assert.equal(legacy.result.canConfirm, true);
    assert.equal(legacy.result.summary.blockingErrorCount, 0);
    assert.equal((await confirm(legacy)).submitted, 1);
    const historical = await prisma.employeeDataChangeRequest.findFirst({ where: { sourceBatchId: legacy.result.batchId } });
    assert.equal(historical?.profileReviewStatus, 'pending');
    assert.equal(historical.proposedValue.profile.education, oldEducation);
    assert.equal(historical.proposedValue.employee.jobGrade, oldGrade);
    assert.deepEqual(await formalSnapshot(), baseline);
    // Disabling a directory item does not mutate an already submitted proposal.
    assert.deepEqual(await prisma.employeeDataChangeRequest.findUnique({ where: { id: changedRequest.id } }), changedRequest);
    report.checks.legacy_and_end_today_preserved = 'passed';
    report.counts = { previews: cases.length, pending_requests: requests.length + 1, employees_unchanged: baseline.length };
    report.status = 'passed';
    report.stage = 'complete';
  } catch {
    // Prisma/Nest errors can contain configuration or row data; report only our fixed stage labels.
    report.status = 'failed';
  } finally {
    if (initialized) {
      try {
        report.cleanup = await cleanup();
      } catch {
        report.status = 'failed';
        report.cleanup = { status: 'refused_or_failed', deleted: 0 };
      }
    }
    if (prisma) {
      try { await prisma.$disconnect(); } catch { report.status = 'failed'; }
    }
    console.log(JSON.stringify(report));
    if (report.status !== 'passed') process.exitCode = 1;
  }
}

if (require.main === module) void main();
