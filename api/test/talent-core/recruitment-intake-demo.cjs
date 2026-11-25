'use strict';

async function prepare() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict'), { randomUUID, randomInt } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const fixtures = require('./test/talent-core/recruitment-intake-fixtures.cjs');
  const { assertFictionalDatabase } = require('./test/talent-core/recruitment-demand-preview.cjs');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const key = 'recruitment_intake_persistent_demo_v1';
  try {
    await assertFictionalDatabase(db);
    const baseline = await fixtures.protectedBaseline(db);
    let marker = (await db.systemConfig.findUnique({ where: { key } }))?.value;
    if (marker) {
      assert.equal(marker.fictional, true); fixtures.assertOwner(marker.prefix);
      if (marker.phase === 'ready') {
        await db.recruitmentDemand.findUniqueOrThrow({ where: { id: marker.demandId } });
        await db.recruitmentPosting.findUniqueOrThrow({ where: { id: marker.postingId } });
        await db.recruitmentIntake.findUniqueOrThrow({ where: { id: marker.awaitingId } });
        await fixtures.assertProtectedBaseline(db, baseline);
        process.stdout.write(JSON.stringify({ ...marker, preservedExisting: true }) + '\n'); return;
      }
    }
    const identities = {};
    for (const employeeNo of ['ADMIN', 'HR001']) {
      const user = await db.user.findUniqueOrThrow({ where: { employeeNo } });
      if (!user.name.startsWith('测试·') || user.dingtalkId || user.dingtalkUnionId || user.archivedAt || user.deletedAt) throw new Error('Default demo identities must be the existing fictional preview accounts');
      identities[employeeNo] = user.id;
    }
    if (!marker) marker = await db.$transaction(async tx => {
      const prefix = 'RDI_' + randomUUID().slice(0, 8);
      const department = await tx.department.create({ data: { name: `虚构简历演练部门_${prefix}` } });
      const position = await tx.position.create({ data: { code: prefix, name: `虚构简历演练岗位_${prefix}` } });
      const education = await tx.personnelReferenceData.create({ data: { kind: 'education', name: `虚构演练学历_${prefix}` } });
      const parserPlans = ['A', 'B'].map(letter => ({ marker: `${prefix}_resume_${letter}`, mode: 'success', delayMs: 300,
        fields: { name: `虚构简历演练${letter}_${prefix}`, phone: `170${randomInt(10000000, 100000000)}`, education: education.name } }));
      const value = { fictional: true, persistent: true, prefix, phase: 'preparing', departmentId: department.id, positionId: position.id,
        demandRequestId: randomUUID(), postingRequestId: randomUUID(), waitingRequestId: randomUUID(), artifactMarker: parserPlans[0].marker,
        url: 'http://localhost:5173/recruitment/intakes' };
      await tx.systemConfig.create({ data: { key, value } });
      await tx.systemConfig.create({ data: { key: fixtures.namespace + prefix, value: { fictional: true, persistent: true, prefix,
        actorIds: [], departmentId: department.id, positionId: position.id, educationId: education.id, parserPlans,
        mailbox: { key: fixtures.mailboxKey, authorizedFrom: fixtures.authorizedFrom, failPages: [], pages: [[
          { id: prefix + '_demo_pdf', receivedAt: '2037-01-09T10:00:00+08:00', subject: '虚构演练：一份可下载的 PDF 简历', bodyText: '仅供隔离招聘演练，不发送通知。',
            sourceChannel: 'job_site', postingChannel: 'job_site', externalPostingId: prefix + '_job_A', attachments: [{ id: 'resume_a',
              fileName: parserPlans[0].marker + '.pdf', mimeType: 'application/pdf', base64: fixtures.resumePdf(parserPlans[0].marker).toString('base64') }] },
          { id: prefix + '_demo_body', receivedAt: '2037-01-09T10:05:00+08:00', subject: '虚构演练：正文简历，可关联原待收记录',
            bodyText: parserPlans[1].marker + '\nFictional applicant explicitly supplied this example for recruitment acceptance.',
            sourceChannel: 'job_site', postingChannel: 'job_site', externalPostingId: prefix + '_job_A', attachments: [] },
        ]] } } } });
      return value;
    });
    const tokens = {};
    async function request(actor, method, path, input, expected = 200) {
      const response = await fetch('http://127.0.0.1:3000/api/v1' + path, { method, headers: { 'content-type': 'application/json',
        ...(tokens[actor] ? { authorization: 'Bearer ' + tokens[actor] } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(30000) });
      if (response.status !== expected) throw new Error(`Fictional demo ${method} ${path} returned ${response.status}`);
      const body = await response.json(); assert.equal(body.code, 0); return body.data;
    }
    for (const actor of ['ADMIN', 'HR001']) tokens[actor] = (await request(actor, 'POST', '/auth/test-login', { employeeNo: actor })).token;
    let demand = await request('ADMIN', 'POST', '/recruitment-demands/local', { requestId: marker.demandRequestId,
      deptId: marker.departmentId, positionId: marker.positionId, headcount: 2, reason: `虚构${marker.prefix}简历收件演练需求，非真实招聘计划` }, 201);
    if (demand.sourceState === 'draft') demand = await request('ADMIN', 'POST', `/recruitment-demands/${demand.id}/local-actions`, { expectedRevision: demand.revision, action: 'submit' }, 201);
    if (demand.sourceState === 'pending') demand = await request('HR001', 'POST', `/recruitment-demands/${demand.id}/local-actions`, { expectedRevision: demand.revision, action: 'approve' }, 201);
    assert.equal(demand.sourceState, 'approved'); assert.equal(demand.usable, true);
    const posting = await request('ADMIN', 'POST', '/recruitment-postings', { requestId: marker.postingRequestId, demandId: demand.id,
      channel: 'job_site', name: `虚构外部职位_${marker.prefix}`, url: `https://example.invalid/${marker.prefix}/job-a`, externalId: marker.prefix + '_job_A',
      verifiedIdentity: true, evidence: '虚构平台及职位身份，仅用于隔离演练', ownerId: identities.ADMIN, active: true }, 201);
    const waiting = await request('ADMIN', 'POST', '/recruitment-intakes', { requestId: marker.waitingRequestId, state: 'awaiting_resume', ownerId: identities.ADMIN,
      sourceChannel: 'job_site', postingId: posting.id, demandId: demand.id, positionName: demand.positionName,
      sourceNotes: '虚构待收简历：可补传提供的 PDF，或关联已收到的正文邮件；无真实通知。', nextFollowUpAt: '2037-01-12T10:00:00+08:00',
      candidateDraft: { name: `虚构待收演练_${marker.prefix}`, sourceChannel: 'job_site' } }, 201);
    await fixtures.activateMailboxFixture(db, marker.prefix);
    const synced = await request('ADMIN', 'POST', '/recruitment-intakes/mailbox/sync', { limit: 20 }, 201);
    assert.equal(synced.failed, 0); assert.equal(synced.hasMore, false);
    const mail = await db.recruitmentIntake.findMany({ where: { mailboxKey: fixtures.mailboxKey, messageId: { startsWith: marker.prefix + '_demo_' } }, select: { id: true } });
    assert.equal(mail.length, 2);
    marker = { ...marker, phase: 'ready', demandId: demand.id, postingId: posting.id, awaitingId: waiting.id, mailIntakeIds: mail.map(row => row.id) };
    await db.systemConfig.update({ where: { key }, data: { value: marker } });
    await fixtures.assertProtectedBaseline(db, baseline);
    process.stdout.write(JSON.stringify({ ...marker, preservedExisting: false }) + '\n');
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 90000,
    input: `(${prepare.toString()})().catch(error=>{process.stdout.write(JSON.stringify({passed:false,name:error.name,message:error.message})+'\\n');process.exitCode=1;});` });
  if (result.status !== 0 || result.error || result.signal) { process.stdout.write(result.stdout || 'Guarded intake demo preparation failed.\n'); process.exitCode = 1; }
  else {
    const metadata = JSON.parse(result.stdout), fixtures = require('./recruitment-intake-fixtures.cjs'); fixtures.assertOwner(metadata.prefix);
    const fs = require('node:fs'), path = require('node:path');
    const directory = path.resolve(__dirname, '../../../test-results/recruitment-intake-demo'); fs.mkdirSync(directory, { recursive: true });
    const artifactPath = path.join(directory, metadata.artifactMarker + '.pdf'); fs.writeFileSync(artifactPath, fixtures.resumePdf(metadata.artifactMarker));
    const report = { ...metadata, artifactPath }; fs.writeFileSync(path.join(directory, 'demo.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\n');
  }
}
