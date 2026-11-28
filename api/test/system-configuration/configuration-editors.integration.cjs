'use strict';

// Run against the existing guarded, fictional local preview only. Never accepts an external URL.
async function verifyConfigurationEditors() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  const assert = require('node:assert/strict');
  const { randomUUID, randomBytes, createHash } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { JwtService } = require('@nestjs/jwt');
  const db = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const prefix = 'CFG_' + randomUUID().slice(0, 8);
  const actors = {}, owned = new Set(), ownedStateIds = new Set(), checks = [];
  let requests = 0;
  let verified = false;
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const token = user => new JwtService().sign({ sub: user.id, employeeNo: user.employeeNo,
    name: user.name, sysRole: user.sysRole, deptId: null, hrCapabilities: [], isAssessorOnly: false,
    canViewAll: false }, { secret: process.env.JWT_SECRET, expiresIn: '10m' });
  async function request(actor, method, path, body, allowed = [200]) {
    requests++;
    const response = await fetch('http://127.0.0.1:3000/api/v1' + path, {
      method, headers: { 'content-type': 'application/json', ...(actor ? { authorization: 'Bearer ' + actors[actor].token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    assert.ok(allowed.includes(response.status), `${method} ${path}: status ${response.status}`);
    const payload = await response.json();
    return { status: response.status, data: payload.data, text: JSON.stringify(payload) };
  }
  const path = id => '/system/configurations/' + encodeURIComponent(id);
  const values = (name, password) => ({ RECRUITMENT_MAIL_NAME: prefix + name,
    RECRUITMENT_MAIL_PROVIDER: name === 'One' ? 'qq' : 'netease163',
    RECRUITMENT_MAIL_ENABLED: false, RECRUITMENT_MAIL_ACCOUNT: name.toLowerCase() + '@example.invalid',
    RECRUITMENT_MAIL_PASSWORD: password, RECRUITMENT_MAIL_FOLDER: '招聘简历',
    RECRUITMENT_MAIL_AUTHORIZED_FROM: '2037-01-01T00:00:00.000Z' });
  try {
    check('fictional preview marker', (await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional === true);
    const protectedKeys = ['ai_progress_active_provider', 'ai_progress_bot_enabled'];
    const protectedBefore = digest(await db.systemConfig.findMany({ where: { key: { in: protectedKeys } }, orderBy: { key: 'asc' } }));
    const intakeBefore = await db.recruitmentIntake.count();
    for (const [name, role] of [['admin', 'system_admin'], ['hr', 'hr']]) {
      const user = await db.user.create({ data: { name: '测试·' + prefix + name, employeeNo: prefix + '_' + name,
        sysRole: role, status: 'active', hrCapabilities: [] } });
      await db.employmentRecord.create({ data: { userId: user.id, employeeNo: user.employeeNo,
        company: 'fuede', effectiveFrom: new Date('2026-01-01'), entryDate: new Date('2026-01-01'),
        employeeStatus: 'active', changeType: 'onboarding', sourceType: 'preview_fixture' } });
      actors[name] = { id: user.id, token: token(user) };
    }
    await request(null, 'GET', '/system/configuration-mailboxes', undefined, [401]);
    await request('hr', 'GET', '/system/configuration-mailboxes', undefined, [403]);
    for (const id of ['dingtalk-login', 'dingtalk-notifications', 'dingtalk-calendar', 'recruitment-demand', 'recruitment-mail', 'payroll-attendance', 'payroll-access', 'ai-resume']) {
      const view = (await request('admin', 'GET', path(id))).data;
      check('editable definition: ' + id, Array.isArray(view.fields) && view.fields.length > 0);
      check('no secret values: ' + id, view.fields.filter(field => field.type === 'secret').every(field => !Object.hasOwn(field, 'value')));
      await request('hr', 'PUT', path(id), { expectedRevision: 0, values: {} }, [403]);
    }
    const publicView = (await request(null, 'GET', '/auth/dingtalk/config')).data;
    check('public login response contains only public parameters', Object.keys(publicView).sort().join(',') === ['enabled', 'corpId', 'appKey', 'agentId', 'redirectUri'].sort().join(','));
    const secret = randomBytes(24).toString('base64url');
    const boxes = [];
    for (const name of ['One', 'Two']) {
      let view = (await request('admin', 'POST', '/system/configuration-mailboxes', {}, [200, 201])).data;
      check('new mailbox has stable independent id', /^recruitment-mail:[0-9a-f-]{36}$/i.test(view.id));
      owned.add(view.id);
      view = (await request('admin', 'PUT', path(view.id), { expectedRevision: view.revision, values: values(name, secret) })).data;
      check('secret not returned after save: ' + name, !JSON.stringify(view).includes(secret));
      check('save stays draft: ' + name, view.appliedRevision === 0);
      const stored = await db.systemConfig.findUniqueOrThrow({ where: { key: 'integration_configuration:' + view.id } });
      check('secret encrypted in database: ' + name, !JSON.stringify(stored.value).includes(secret));
      view = (await request('admin', 'POST', path(view.id) + '/test', { expectedRevision: view.revision }, [200, 201])).data;
      check('disabled mailbox validates without remote connection: ' + name, view.verification === 'passed' && view.testKind === 'configuration');
      view = (await request('admin', 'POST', path(view.id) + '/apply', { expectedRevision: view.revision }, [200, 201])).data;
      check('apply records current revision: ' + name, view.appliedRevision === view.revision);
      boxes.push(view);
    }
    const listed = (await request('admin', 'GET', '/system/configuration-mailboxes')).data;
    check('two mailbox configurations coexist', boxes.every(box => listed.some(item => item.id === box.id)) && boxes[0].id !== boxes[1].id);
    const first = boxes[0];
    const results = await Promise.all([
      request('admin', 'PUT', path(first.id), { expectedRevision: first.revision, values: { RECRUITMENT_MAIL_NAME: prefix + '_A' } }, [200, 409]),
      request('admin', 'PUT', path(first.id), { expectedRevision: first.revision, values: { RECRUITMENT_MAIL_NAME: prefix + '_B' } }, [200, 409]),
    ]);
    check('concurrent saves reject stale revision', results.filter(item => item.status === 200).length === 1 && results.filter(item => item.status === 409).length === 1);
    const changed = (await request('admin', 'GET', path(first.id))).data;
    check('new draft invalidates test but keeps applied revision', changed.verification === 'untested' && changed.appliedRevision === first.appliedRevision && changed.revision > first.revision);
    await request('admin', 'POST', path(first.id) + '/apply', { expectedRevision: changed.revision }, [400]);
    await request('admin', 'PUT', path(first.id), { expectedRevision: changed.revision, values: { DATABASE_URL: 'forbidden' } }, [400]);
    const unchanged = (await request('admin', 'GET', path(boxes[1].id))).data;
    check('second mailbox unaffected by first mailbox changes', unchanged.revision === boxes[1].revision && unchanged.appliedRevision === boxes[1].appliedRevision);
    const retained = await db.systemConfig.findUniqueOrThrow({ where: { key: 'integration_configuration:' + first.id } });
    check('omitting password does not persist plaintext', !JSON.stringify(retained.value).includes(secret));
    const { ConfigService } = require('@nestjs/config');
    require('tsconfig-paths').register({ baseUrl: './dist/src', paths: { '@/*': ['*'] } });
    const { RuntimeSettingsService } = require('./dist/src/system-configuration/runtime-settings.service');
    const restarted = new RuntimeSettingsService(db, new ConfigService());
    await restarted.reloadApplied();
    check('applied mailboxes survive runtime reload', boxes.every(box => restarted.mailboxConfigurations().some(item => item.id === box.id)));
    // Mock only the external mail source; exercise real importer/Prisma/PG transactions and per-account leases.
    const { RecruitmentIntakesService } = require('./dist/src/talent-pool/recruitment-intakes.service');
    const stateIds = boxes.map(() => 'cfg' + randomUUID().replaceAll('-', '').slice(0, 17));
    check('fixture state ids do not touch existing progress', await db.recruitmentMailboxState.count({ where: { id: { in: stateIds } } }) === 0);
    stateIds.forEach(id => ownedStateIds.add(id));
    let bFailed = false;
    const received = [];
    const gateway = {
      status: () => ({ configured: true }),
      select: mailboxId => {
        const index = boxes.findIndex(box => box.id === mailboxId);
        assert.ok(index >= 0, 'explicit known mailbox selection');
        return { id: mailboxId, name: prefix + index, stateId: stateIds[index], readPage: async input => {
          received.push({ index, cursor: input.cursor });
          if (index === 1 && !bFailed) { bFailed = true; throw new Error('Controlled fictional mailbox failure'); }
          return { mailboxKey: mailboxId + '|fixture:' + prefix, authorizedFrom: '2037-01-01T00:00:00.000Z',
            messages: [{ id: prefix + '_mail_' + index, receivedAt: '2037-01-02T00:00:00.000Z',
              subject: prefix + '虚构简历' + index, bodyText: '姓名：虚构简历_' + prefix + index + '\n学历：本科',
              sourceChannel: 'other', attachments: [] }],
            nextCursor: index === 0 && !input.cursor ? prefix + '_a_next' : null,
            ...(index === 1 || input.cursor ? { checkpointCursor: prefix + '_end_' + index } : {}),
          };
        } };
      },
    };
    const importer = new RecruitmentIntakesService(db, null, null, {}, null, gateway);
    const actor = { id: actors.admin.id };
    const a = await importer.syncMailbox({ mailboxId: boxes[0].id, limit: 5 }, actor);
    check('first account imports its fictional resume with real PG', a.synced === 1 && a.failed === 0);
    await assert.rejects(() => importer.syncMailbox({ mailboxId: boxes[1].id, limit: 5 }, actor));
    const aState = await db.recruitmentMailboxState.findUniqueOrThrow({ where: { id: stateIds[0] } });
    const bState = await db.recruitmentMailboxState.findUniqueOrThrow({ where: { id: stateIds[1] } });
    check('failed second account does not alter first progress', aState.cursor === prefix + '_a_next' && aState.leaseToken === null && bState.cursor === null && bState.leaseToken === null);
    const b = await importer.syncMailbox({ mailboxId: boxes[1].id, limit: 5 }, actor);
    check('second account retries independently', b.synced === 1 && b.failed === 0);
    const repeatA = await importer.syncMailbox({ mailboxId: boxes[0].id, limit: 5 }, actor);
    check('first account resumes its own cursor and deduplicates', repeatA.synced === 0 && repeatA.skipped === 1 && received.at(-1).cursor === prefix + '_a_next');
    const ownIntakes = await db.recruitmentIntake.findMany({ where: { createdById: actors.admin.id, subject: { startsWith: prefix } }, include: { events: true } });
    check('each imported resume keeps its mailbox source', ownIntakes.length === 2 && ownIntakes.every(row => row.events.some(event => event.metadata?.mailbox?.id === row.mailboxKey.split('|')[0])));
    const noSecrets = await db.auditLog.findMany({ where: { userId: actors.admin.id }, select: { newValue: true, oldValue: true } });
    check('audits do not contain passwords', !JSON.stringify(noSecrets).includes(secret));
    await db.user.update({ where: { id: actors.admin.id }, data: { sysRole: 'employee' } });
    await request('admin', 'GET', path(first.id), undefined, [403]);
    await request('admin', 'PUT', path(first.id), { expectedRevision: changed.revision, values: {} }, [403]);
    check('revoked admin token cannot read or save', true);
    check('only the two owned fictional resumes were imported', await db.recruitmentIntake.count() === intakeBefore + 2);
    check('existing AI settings preserved', protectedBefore === digest(await db.systemConfig.findMany({ where: { key: { in: protectedKeys } }, orderBy: { key: 'asc' } })));
    verified = true;
  } finally {
    // Source history is immutable. Close owned fictional receipts through the real API; retain their events.
    if (actors.admin) {
      const intakes = await db.recruitmentIntake.findMany({ where: { createdById: actors.admin.id, subject: { startsWith: prefix } }, select: { id: true, revision: true, state: true } });
      if (intakes.some(row => !['closed', 'completed'].includes(row.state))) {
        await db.user.update({ where: { id: actors.admin.id }, data: { sysRole: 'system_admin' } });
        for (const receipt of intakes.filter(row => !['closed', 'completed'].includes(row.state))) {
          await request('admin', 'POST', `/recruitment-intakes/${receipt.id}/close`, { expectedRevision: receipt.revision, reason: '虚构配置验收结束，保留收件历史。' }, [200, 201]);
        }
      }
    }
    if (ownedStateIds.size) await db.recruitmentMailboxState.deleteMany({ where: { id: { in: [...ownedStateIds] } } });
    if (actors.admin) for (const id of owned) await db.systemConfig.deleteMany({ where: { key: 'integration_configuration:' + id, updatedBy: actors.admin.id } });
    const actorIds = Object.values(actors).map(actor => actor.id);
    if (actorIds.length) await db.user.updateMany({ where: { id: { in: actorIds }, employeeNo: { startsWith: prefix + '_' } }, data: { archivedAt: new Date() } });
    await db.$disconnect();
  }
  if (verified) process.stdout.write(JSON.stringify({ passed: true, prefix, checks, requests, mailboxCount: owned.size, cleanup: 'owned receipts closed; immutable history retained' }) + '\n');
}

if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 180000,
    input: `(${verifyConfigurationEditors.toString()})().catch(error=>{process.stdout.write(JSON.stringify({passed:false,name:error.name,message:error.message})+'\\n');process.exitCode=1;});`,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error || result.signal || result.status !== 0) { process.stderr.write('Guarded configuration integration verification failed.\n'); process.exitCode = 1; }
}
