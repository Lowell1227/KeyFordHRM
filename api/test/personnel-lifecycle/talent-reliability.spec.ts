import { execFileSync } from 'node:child_process';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { TalentsService } = require('./dist/src/talent-pool/talents.service');
  const { TalentFilesService } = require('./dist/src/talent-pool/talent-files.service');
  const { TalentQueryDto } = require('./dist/src/talent-pool/dto/talent-query.dto');
  const { shanghaiBusinessDate } = require('./dist/src/employee-archives/employment-timeline');
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const other = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const prefix = `TRPG_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const actorId = randomUUID(), ids = [randomUUID(), randomUUID()];
  let initialized = false;
  const results: string[] = [];
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.ok(await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }));
    await db.$transaction(async tx => {
      await tx.user.create({ data: { id: actorId, employeeNo: prefix, name: prefix, sysRole: 'hr', accountType: 'service', status: 'active' } });
      for (const id of ids) await tx.talentCandidate.create({ data: { id, name: prefix, phone: '100' + String(parseInt(id.slice(0, 6), 16)).padStart(8, '0'),
        sourceChannel: 'other', createdById: actorId } });
    });
    initialized = true;
    const talents = new TalentsService(db), otherTalents = new TalentsService(other);
    const day = shanghaiBusinessDate(), past = new Date(day.getTime() - 86400000), future = new Date(day.getTime() + 86400000);
    const tied = [randomUUID(), randomUUID()].sort();
    await db.talentFollowUp.createMany({ data: [
      { id: randomUUID(), candidateId: ids[0], occurredAt: day, nextFollowUpAt: past, planStatus: 'superseded', createdAt: new Date('2020-01-01'), channel: 'other', summary: prefix, createdById: actorId },
      { id: tied[0], candidateId: ids[0], occurredAt: day, nextFollowUpAt: past, planStatus: 'superseded', createdAt: new Date('2020-01-02'), channel: 'other', summary: prefix, createdById: actorId },
      { id: tied[1], candidateId: ids[0], occurredAt: day, nextFollowUpAt: future, planStatus: 'pending', createdAt: new Date('2020-01-02'), channel: 'other', summary: prefix, createdById: actorId },
      { id: randomUUID(), candidateId: ids[0], occurredAt: day, nextFollowUpAt: null, createdAt: new Date('2020-01-03'), channel: 'other', summary: prefix, createdById: actorId },
    ] });
    // A single connection makes this session-zone check apply to the actual raw SQL.
    await db.$executeRawUnsafe("SET TIME ZONE 'America/Los_Angeles'");
    const query = Object.assign(new TalentQueryDto(), { keyword: prefix });
    const list = await talents.list(query);
    assert.equal(list.items.find(t => t.id === ids[0]).nextFollowUpAt.toISOString(), future.toISOString());
    const due = await talents.list(Object.assign(new TalentQueryDto(), { keyword: prefix, dueOnly: true }));
    assert.equal(due.items.some(t => t.id === ids[0]), true);
    const detail = await talents.detail(ids[0]);
    assert.equal(detail.followUps[0].nextFollowUpAt, null);
    assert.equal(detail.followUps[1].id, tied[1]);
    results.push('same-day-created-and-id-ties', 'nonempty-next-date', 'database-timezone-independent-due');

    await db.talentResumeFile.createMany({ data: [0, 1].map(i => ({ candidateId: ids[1],
      objectKey: `talent-resume/${prefix}/original-${i}.pdf`, fileName: 'fictional.pdf', mimeType: 'application/pdf', fileSize: 1, uploadedById: actorId })) });
    const storage = { statObject: async () => ({ size: 1, metaData: { 'content-type': 'application/pdf' } }) };
    const files = new TalentFilesService(talents, storage, db), otherFiles = new TalentFilesService(otherTalents, storage, other);
    const body = key => ({ objectKey: `talent-resume/${prefix}/${key}.pdf`, fileName: 'fictional.pdf', mimeType: 'application/pdf', fileSize: 1 });
    const operator = { id: actorId, name: prefix, sysRole: 'hr' };
    const raced = await Promise.allSettled([files.bind(ids[1], body('A'), operator), otherFiles.bind(ids[1], body('B'), operator)]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
    const failure: any = raced.find(r => r.status === 'rejected');
    assert.equal(failure.reason.getStatus(), 409);
    assert.equal(await db.talentResumeFile.count({ where: { candidateId: ids[1] } }), 3);
    const winner: any = raced.find(r => r.status === 'fulfilled');
    const repeated = await otherFiles.bind(ids[1], { ...body('A'), objectKey: winner.value.objectKey }, operator);
    assert.equal(repeated.id, winner.value.id);
    assert.equal(await db.talentResumeFile.count({ where: { candidateId: ids[1] } }), 3);
    await db.talentCandidate.update({ where: { id: ids[1] }, data: { deletedAt: new Date() } });
    await assert.rejects(() => files.bind(ids[1], body('C'), operator), e => e.getStatus() === 404);
    results.push('real-pg-resume-limit', 'idempotent-binding', 'deleted-candidate-rejected');
  } finally {
    try {
      if (initialized) await db.$transaction(async tx => {
        assert.equal(await tx.talentCandidate.count({ where: { id: { in: ids }, createdById: actorId, name: prefix } }), 2);
        await tx.talentResumeFile.deleteMany({ where: { candidateId: { in: ids } } });
        await tx.talentFollowUp.deleteMany({ where: { candidateId: { in: ids } } });
        await tx.talentCandidate.deleteMany({ where: { id: { in: ids }, createdById: actorId } });
        await tx.user.deleteMany({ where: { id: actorId, employeeNo: prefix } });
        assert.equal(await tx.talentCandidate.count({ where: { id: { in: ids } } }), 0);
      });
    } finally { await Promise.all([db.$disconnect(), other.$disconnect()]); }
  }
  return { ok: true, database: 'hrm_preview', scenarios: results, cleanup: 0, storage: 'stub-stat-no-objects' };
}

it('runs real isolated PostgreSQL ordering and resume concurrency without external storage writes', () => {
  expect(process.env.HRM_TALENT_RELIABILITY_INTEGRATION).toBe('1');
  let output: string;
  try { output = execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
    input: `(${inPreview.toString()})().then(r => console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({ok:false,error:e.name,code:e.code}));process.exitCode=1;});` });
  } catch (error) {
    let code = 'subprocess';
    try { const data = JSON.parse(error.stdout); code = `${data.error}:${data.code ?? ''}`; } catch { /* Suppress raw subprocess output. */ }
    throw new Error(`Isolated talent integration failed: ${code}`);
  }
  const result = JSON.parse(output);
  expect(result).toMatchObject({ ok: true, database: 'hrm_preview', cleanup: 0, storage: 'stub-stat-no-objects' });
  expect(result.scenarios).toHaveLength(6);
  console.info('Talent reliability PostgreSQL evidence:', JSON.stringify(result));
});
