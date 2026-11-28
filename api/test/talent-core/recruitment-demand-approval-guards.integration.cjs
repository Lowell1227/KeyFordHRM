'use strict';

// Guarded structural/business trigger proof. All synthetic rows are rolled back.
async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const migration = '20261128130000_recruitment_self_approval_guards';
  const rollback = new Error('ROLLBACK_OWN_GUARD_FIXTURES');
  const cases = [];
  let currentCase = 'isolated_preview_preconditions';
  const pass = name => { cases.push(name); process.stdout.write(JSON.stringify({ case: name, passed: true }) + '\n'); };
  async function fingerprint() {
    const result = {};
    for (const table of ['users', 'departments', 'positions', 'recruitment_demands', 'recruitment_demand_events', 'talent_candidates', 'talent_applications', 'talent_follow_ups', 'payroll_batches', 'employment_records']) {
      const rows = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id::text),'')) AS hash FROM "${table}" t`);
      result[table] = rows[0];
    }
    return JSON.stringify(result);
  }
  try {
    const identity = await db.$queryRawUnsafe('SELECT current_database() AS database,current_user AS owner');
    assert.equal(identity[0].database, 'hrm_preview'); assert.equal(identity[0].owner, 'hrm_preview');
    assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' }, select: { value: true } }))?.value?.fictional, true);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', migration))[0].count, 1);
    const before = await fingerprint();
    try {
      await db.$transaction(async tx => {
        const suffix = randomUUID().slice(0, 8);
        const actor = async (name, changes = {}) => tx.user.create({ data: { name: 'Guard ' + suffix + ' ' + name, sysRole: 'employee',
          status: 'active', hrCapabilities: ['recruitment_demand_review', 'recruitment_edit'], ...changes } });
        const qualified = await actor('qualified');
        const plain = await actor('without capability', { hrCapabilities: [] });
        const resigned = await actor('resigned', { status: 'resigned' });
        const archived = await actor('archived', { archivedAt: new Date() });
        const assessor = await actor('assessor', { isAssessorOnly: true });
        const deleted = await actor('deleted', { deletedAt: new Date() });
        const narrow = await actor('review only', { hrCapabilities: ['recruitment_demand_review'] });
        const legacyEditor = await actor('archive editor', { sysRole: 'hr_user', hrCapabilities: ['recruitment_demand_review', 'employee_archive_edit'] });
        const administrator = await actor('administrator', { sysRole: 'system_admin', hrCapabilities: ['recruitment_demand_review'] });
        const hrWithoutReview = await actor('HR without explicit review', { sysRole: 'hr', hrCapabilities: [] });
        const department = await tx.department.create({ data: { name: 'Synthetic guard department ' + suffix } });
        const position = await tx.position.create({ data: { code: 'GUARD-' + suffix, name: 'Synthetic guard position ' + suffix } });
        async function draft(creator = qualified) {
          return tx.recruitmentDemand.create({ data: { sourceKind: 'local', sourceState: 'draft', localRequestId: randomUUID(),
            localCreationFingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), requestedHeadcount: 2,
            requestReason: 'Synthetic trigger proof', createdById: creator.id, deptId: department.id, positionId: position.id } });
        }
        async function pending(creator = qualified, submitter = creator) {
          const row = await draft(creator);
          await tx.$executeRawUnsafe("UPDATE recruitment_demands SET source_state='pending',submitted_by_id=$2::uuid,revision=revision+1 WHERE id=$1::uuid", row.id, submitter.id);
          return tx.recruitmentDemand.findUniqueOrThrow({ where: { id: row.id } });
        }
        async function approve(row, mode = 'self_created', submitter = qualified, reviewer = submitter) {
          await tx.$executeRawUnsafe("UPDATE recruitment_demands SET source_state='approved',submitted_by_id=$2::uuid,approved_by_id=$3::uuid,approval_mode=$4,approved_at=date_trunc('milliseconds',CURRENT_TIMESTAMP),approved_headcount=requested_headcount,mapped_fingerprint=source_fingerprint,revision=revision+1 WHERE id=$1::uuid",
            row.id, submitter.id, reviewer.id, mode);
          return tx.recruitmentDemand.findUniqueOrThrow({ where: { id: row.id } });
        }
        async function event(row, action, changes = {}) {
          const snapshot = { id: row.id, revision: row.revision, sourceKind: row.sourceKind, sourceState: row.sourceState,
            approvalMode: row.approvalMode, createdById: row.createdById, submittedById: row.submittedById, approvedById: row.approvedById,
            deptId: row.deptId, positionId: row.positionId, requestedHeadcount: row.requestedHeadcount, approvedHeadcount: row.approvedHeadcount,
            sourceFingerprint: row.sourceFingerprint, mappedFingerprint: row.mappedFingerprint, approvedAt: row.approvedAt.toISOString(),
            ...(changes.snapshot || {}) };
          return tx.recruitmentDemandEvent.create({ data: { demandId: row.id, revision: changes.revision ?? row.revision,
            actorId: changes.actorId ?? row.approvedById, action, snapshot } });
        }
        let sequence = 0;
        async function check(name, operation, rejected = false) {
          currentCase = name; const savepoint = 'guard_' + sequence++;
          await tx.$executeRawUnsafe('SAVEPOINT ' + savepoint);
          let error;
          try { await operation(); await tx.$executeRawUnsafe('SET CONSTRAINTS recruitment_demand_self_approval_evidence_guard IMMEDIATE'); }
          catch (caught) { error = caught; }
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ' + savepoint);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + savepoint);
          await tx.$executeRawUnsafe('SET CONSTRAINTS recruitment_demand_self_approval_evidence_guard DEFERRED');
          if (rejected) {
            assert.ok(error, name + ' unexpectedly accepted a forbidden write');
            assert.ok(['P0001', '23514'].includes(error.meta?.code), name + ' rejected with unexpected error ' + error.code + '/' + error.meta?.code);
          }
          else if (error) throw error;
          pass(name);
        }
        await check('draft_combined_self_created_with_matching_event', async () => { const row = await approve(await draft()); await event(row, 'local_submit_approve'); });
        await check('rejected_combined_self_created_with_matching_event', async () => {
          let row = await pending();
          await tx.$executeRawUnsafe("UPDATE recruitment_demands SET source_state='rejected',revision=revision+1 WHERE id=$1::uuid", row.id);
          row = await approve(row); await event(row, 'local_submit_approve');
        });
        await check('legacy_pending_self_created_explicit_approval', async () => { const row = await approve(await pending()); await event(row, 'local_approve'); });
        await check('review_only_can_approve_existing_self_created_pending_request', async () => {
          const row = await approve(await pending(narrow), 'self_created', narrow); await event(row, 'local_approve');
        });
        for (const [name, user] of [['legacy_archive_editor', legacyEditor], ['administrator_with_explicit_review', administrator]]) {
          await check('combined_approval_supports_' + name, async () => { const row = await approve(await draft(user), 'self_created', user); await event(row, 'local_submit_approve'); });
        }
        for (const mode of ['independent', null]) await check('independent_' + (mode || 'legacy_null') + '_remains_compatible', async () => {
          const row = await approve(await pending(plain), mode, plain, qualified); await event(row, 'local_approve');
        });
        await check('insert_cannot_forge_already_self_approved', async () => {
          await tx.$executeRawUnsafe("INSERT INTO recruitment_demands(source_kind,source_state,local_request_id,local_creation_fingerprint,source_fingerprint,requested_headcount,request_reason,created_by_id,submitted_by_id,approved_by_id,dept_id,position_id,approved_at,approved_headcount,mapped_fingerprint,approval_mode) VALUES ('local','approved',$1::uuid,$2,$3,2,'Synthetic forbidden insertion',$4::uuid,$4::uuid,$4::uuid,$5::uuid,$6::uuid,CURRENT_TIMESTAMP,2,$3,'self_created')",
            randomUUID(), 'a'.repeat(64), 'b'.repeat(64), qualified.id, department.id, position.id);
        }, true);
        for (const mode of [null, 'independent']) await check('same_actor_cannot_use_' + (mode || 'legacy_null') + '_mode', async () => { await approve(await pending(), mode); }, true);
        await check('other_creator_submitted_by_reviewer_has_no_self_exception', async () => { await approve(await pending(plain, qualified)); }, true);
        await check('draft_cannot_skip_to_independent_approval', async () => { await approve(await draft(plain), 'independent', plain, qualified); }, true);
        for (const [name, user] of [['missing_capability', plain], ['resigned', resigned], ['archived', archived], ['deleted', deleted],
          ['assessor', assessor], ['review_without_edit_for_combined', narrow], ['HR_without_explicit_review', hrWithoutReview]]) {
          await check('self_approval_rejects_' + name, async () => { await approve(await draft(user), 'self_created', user); }, true);
        }
        await check('self_approval_without_event_is_rejected_at_constraint_boundary', async () => { await approve(await draft()); }, true);
        for (const [name, change] of [
          ['wrong_actor', { actorId: plain.id }], ['wrong_event_revision', { revision: 8 }],
          ['wrong_mode_snapshot', { snapshot: { approvalMode: 'independent' } }],
          ['wrong_creator_snapshot', { snapshot: { createdById: plain.id } }],
          ['wrong_fingerprint_snapshot', { snapshot: { sourceFingerprint: 'c'.repeat(64) } }],
          ['wrong_headcount_snapshot', { snapshot: { approvedHeadcount: 99 } }],
        ]) await check('self_approval_rejects_' + name, async () => { const row = await approve(await draft()); await event(row, 'local_submit_approve', change); }, true);
        await check('combined_event_action_cannot_be_replaced_with_pending_action', async () => { const row = await approve(await draft()); await event(row, 'local_approve'); }, true);
        await check('pending_event_action_cannot_be_replaced_with_combined_action', async () => { const row = await approve(await pending()); await event(row, 'local_submit_approve'); }, true);
        await check('approved_mode_is_immutable', async () => {
          const row = await approve(await draft()); await event(row, 'local_submit_approve');
          await tx.$executeRawUnsafe('SET CONSTRAINTS recruitment_demand_self_approval_evidence_guard IMMEDIATE');
          await tx.$executeRawUnsafe("UPDATE recruitment_demands SET approval_mode='independent' WHERE id=$1::uuid", row.id);
        }, true);
        await check('creation_identity_is_immutable', async () => { const row = await draft(); await tx.$executeRawUnsafe('UPDATE recruitment_demands SET created_by_id=$2::uuid WHERE id=$1::uuid', row.id, plain.id); }, true);
        await check('submitted_business_fields_remain_immutable', async () => { const row = await pending(); await tx.$executeRawUnsafe('UPDATE recruitment_demands SET requested_headcount=3 WHERE id=$1::uuid', row.id); }, true);
        await check('submitted_author_remains_immutable', async () => { const row = await pending(); await tx.$executeRawUnsafe('UPDATE recruitment_demands SET submitted_by_id=$2::uuid WHERE id=$1::uuid', row.id, plain.id); }, true);
        await check('source_kind_remains_immutable', async () => { const row = await draft(); await tx.$executeRawUnsafe("UPDATE recruitment_demands SET source_kind='dingtalk' WHERE id=$1::uuid", row.id); }, true);
        await check('approval_event_remains_append_only', async () => {
          const row = await approve(await draft()); const evidence = await event(row, 'local_submit_approve');
          await tx.$executeRawUnsafe('UPDATE recruitment_demand_events SET revision=revision+1 WHERE id=$1::uuid', evidence.id);
        }, true);
        throw rollback;
      }, { timeout: 90000, maxWait: 10000 });
    } catch (error) { if (error !== rollback) throw error; }
    assert.equal(await fingerprint(), before);
    pass('all_owned_rows_rolled_back_existing_business_fingerprints_unchanged');
    process.stdout.write(JSON.stringify({ passed: true, fictionalOnly: true, realPostgreSQL: true, externalCalls: 0, persistedBusinessWrites: 0, cases }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ passed: false, case: currentCase, name: error.name, code: error.code ?? null,
      ...(error.name === 'AssertionError' ? { message: error.message } : {}) }) + '\n');
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', windowsHide: true,
    timeout: 180000, maxBuffer: 8 * 1024 * 1024, input: `(${inPreview.toString()})().catch(()=>process.exitCode=1);` });
  process.stdout.write(result.stdout || 'No guarded PostgreSQL proof returned.\n');
  if (result.status !== 0 || result.error || result.signal) process.exitCode = 1;
}
module.exports = { inPreview };
