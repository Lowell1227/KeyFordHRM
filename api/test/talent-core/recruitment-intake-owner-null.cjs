'use strict';

async function inPreview(updateOnly = false) {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const fixtures = require('./test/talent-core/recruitment-intake-fixtures.cjs');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  let f;
  try {
    f = await fixtures.createIntakeFixture(db, 'RDI_' + randomUUID().slice(0, 8));
    async function request(method, path, data, expected) {
      const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method,
        headers: { authorization: 'Bearer ' + f.actors.operator.token, 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}`);
      const body = await response.json(); return body.data;
    }
    if (!updateOnly) {
      const defaulted = await request('POST', '/recruitment-intakes', { requestId: randomUUID(), ownerId: null }, 201);
      assert.equal(defaulted.ownerId, f.actors.operator.id);
      const beforeEmpty = await db.recruitmentIntake.count({ where: { createdById: f.actors.operator.id } });
      const beforeEvents = await db.recruitmentIntakeEvent.count({ where: { actorId: f.actors.operator.id } });
      await request('POST', '/recruitment-intakes', { requestId: randomUUID(), ownerId: '' }, 400);
      assert.equal(await db.recruitmentIntake.count({ where: { createdById: f.actors.operator.id } }), beforeEmpty);
      assert.equal(await db.recruitmentIntakeEvent.count({ where: { actorId: f.actors.operator.id } }), beforeEvents);
    }
    const row = await request('POST', '/recruitment-intakes', { requestId: randomUUID(), sourceNotes: `虚构${f.prefix}负责人空值守卫` }, 201);
    assert.equal(row.ownerId, f.actors.operator.id);
    const before = await db.recruitmentIntake.findUniqueOrThrow({ where: { id: row.id } });
    const events = await db.recruitmentIntakeEvent.count({ where: { intakeId: row.id } });
    for (const ownerId of [null, '']) await request('PATCH', '/recruitment-intakes/' + row.id, { expectedRevision: row.revision, ownerId }, 400);
    assert.deepEqual(await db.recruitmentIntake.findUniqueOrThrow({ where: { id: row.id } }), before);
    assert.equal(await db.recruitmentIntakeEvent.count({ where: { intakeId: row.id } }), events);
    process.stdout.write(JSON.stringify({ passed: true, case: updateOnly ? 'owner_null_empty_update_are_400_no_partial_writes_omitted_create_owner_defaults'
      : 'owner_null_create_defaults_empty_create_rejected_update_null_empty_rejected_no_partial_writes' }) + '\n');
  } finally {
    try { if (f) { await fixtures.archiveIntakeFixture(db, f.prefix); await fixtures.assertProtectedBaseline(db, f.baseline); } }
    finally { await db.$disconnect(); }
  }
}
if (require.main === module) {
  const updateOnly = process.argv.length === 3 && process.argv[2] === '--update-only';
  if (process.argv.length > 2 && !updateOnly) throw new Error('Supported option: --update-only');
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 60000,
    input: `(${inPreview.toString()})(${updateOnly}).catch(error=>{process.stdout.write(JSON.stringify({passed:false,name:error.name,code:error.code,message:error.message})+'\\n');process.exitCode=1;});` });
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.resolve(__dirname, '../../../test-results/recruitment-intake-http'); fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, 'owner-null-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
  fs.writeFileSync(report, result.stdout || 'No owner-null proof returned.\n'); process.stdout.write(result.stdout || 'No owner-null proof returned.\n');
  process.stdout.write(JSON.stringify({ report, exitCode: result.status }) + '\n');
  if (result.status !== 0 || result.error || result.signal) process.exitCode = 1;
}
