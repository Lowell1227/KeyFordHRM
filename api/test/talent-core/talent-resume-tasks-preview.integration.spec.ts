import { execFileSync } from 'node:child_process';

async function inPreview() {
  require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
  require('tsconfig-paths').register({ baseUrl: process.cwd(), paths: { '@/*': ['dist/src/*'] } });
  const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { ConfigService } = require('@nestjs/config');
  const { Test } = require('@nestjs/testing');
  const { Reflector } = require('@nestjs/core');
  const request = require('supertest');
  const { RolesGuard } = require('./dist/src/common/guards/roles.guard');
  const { TalentResumeTasksService } = require('./dist/src/talent-pool/talent-resume-tasks.service');
  const { TalentResumeTasksController } = require('./dist/src/talent-pool/talent-resume-tasks.controller');
  const { TalentResumeService } = require('./dist/src/talent-pool/talent-resume.service');
  const db = new PrismaClient(), config = new ConfigService({ ...process.env, AI_RESUME_PARSING_ENABLED: 'true' });
  const ids = [randomUUID(), randomUUID(), randomUUID()], prefix = `RSM_${randomUUID().slice(0, 8)}`;
  const actors = ids.map((id: string, index: number) => ({ id, name: prefix, sysRole: index === 2 ? 'employee' : 'hr' }));
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex');
  const source = { buffer: png, size: png.length, originalname: 'synthetic.png', mimetype: 'image/png' };
  let calls = 0, finish: (() => void) | undefined;
  const provider = { parse: async (_doc: any, _key: any, options: any) => {
    calls++;
    await options.onStage('recognizing');
    await new Promise<void>(resolve => { finish = resolve; });
    await options.onStage('extracting');
    return { fields: { name: 'Fictional Candidate' }, reviewItems: [], pageCount: 1 };
  } };
  const parser = new TalentResumeService({ getProviderRuntimeConfig: async () => ({ apiKey: 'synthetic-key' }) }, config, provider);
  const tasks = new TalentResumeTasksService(db, config, parser), proof: string[] = [];
  let app: any;
  try {
    const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS db, current_user AS role');
    assert.equal(identity.db, 'hrm_preview'); assert.equal(identity.role, 'hrm_preview');
    assert.equal((await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } }))?.value?.fictional, true);
    for (const [index, id] of ids.entries()) await db.user.create({ data: { id, name: `${prefix}_${index}`, employeeNo: `${prefix}_${index}`,
      accountType: 'service', status: 'active', sysRole: actors[index].sysRole } });
    const module = await Test.createTestingModule({ controllers: [TalentResumeTasksController],
      providers: [{ provide: TalentResumeTasksService, useValue: tasks }] }).compile();
    app = module.createNestApplication(); app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.use((req: any, _res: any, next: any) => { req.user = actors[Number(req.headers['x-fictional-actor'] ?? 0)]; next(); });
    await app.init(); const server = app.getHttpServer();
    const upload = () => request(server).post('/talent-resume/tasks').set('X-Resume-Context', 'new').attach('file', png, 'synthetic.png');
    const duplicate = await Promise.all([upload().expect(202), upload().expect(202)]);
    assert.equal(duplicate[0].body.id, duplicate[1].body.id);
    const id = duplicate[0].body.id;
    for (let i = 0; !finish && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 1); assert.equal(typeof finish, 'function');
    proof.push('concurrent-duplicate-upload-single-provider-call');
    for (const endpoint of [`/${id}`, `/${id}/file`]) await request(server).get('/talent-resume/tasks' + endpoint).set('X-Fictional-Actor', '1').expect(404);
    await request(server).post(`/talent-resume/tasks/${id}/retry`).set('X-Fictional-Actor', '1').expect(404);
    await request(server).delete(`/talent-resume/tasks/${id}`).set('X-Fictional-Actor', '1').expect(404);
    await request(server).get(`/talent-resume/tasks/${id}`).set('X-Fictional-Actor', '2').expect(403);
    proof.push('owner-only-status-file-retry-delete-and-role-denial');
    const stored = await db.talentResumeTask.findUnique({ where: { id } });
    assert.equal(Buffer.from(stored.fileEncrypted).includes(png), false);
    assert.equal(Buffer.from(stored.metadataEncrypted).includes(Buffer.from('synthetic.png')), false);
    finish!();
    let done;
    for (let i = 0; i < 100; i++) { done = await tasks.get(id, actors[0]); if (done.status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(done.status, 'succeeded');
    const restored = new TalentResumeTasksService(db, config, parser);
    assert.equal((await restored.current('new', actors[0])).result.fields.name, 'Fictional Candidate');
    const bytes = await request(server).get(`/talent-resume/tasks/${id}/file`).expect(200);
    assert.equal(bytes.headers['cache-control'], 'no-store'); assert.deepEqual(bytes.body, png);
    proof.push('encrypted-storage-and-recovery-after-service-recreation', 'private-uncached-file-download');
    finish = undefined;
    const second = await tasks.start({ ...source, originalname: 'other.png' }, 'new', actors[0]);
    for (let i = 0; !finish && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(() => tasks.clear(id, actors[0]), (error: any) => error.getStatus() === 409);
    assert.equal((await tasks.current('new', actors[0])).id, second.id);
    assert.deepEqual((await tasks.file(second.id, actors[0])).buffer, png);
    proof.push('stale-tab-cleanup-cannot-remove-newer-active-task');
    finish!();
    for (let i = 0; i < 100; i++) { done = await tasks.get(second.id, actors[0]); if (done.status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal((await tasks.start(source, 'new', actors[0])).id, id);
    assert.equal((await tasks.current('new', actors[0])).id, id); assert.equal(calls, 2);
    await tasks.clear(id, actors[0]);
    assert.equal(await tasks.current('new', actors[0]), null);
    await assert.rejects(() => tasks.file(second.id, actors[0]), (error: any) => error.getStatus() === 404);
    proof.push('older-matching-success-reused-without-billing-and-all-context-attempts-cleared');
    let oldFinish: (() => void) | undefined;
    provider.parse = async (_doc: any, _key: any, options: any) => {
      calls++; await options.onStage('recognizing');
      await new Promise<void>(resolve => { oldFinish = resolve; });
      return { fields: { name: 'Late' }, reviewItems: [], pageCount: 1 };
    };
    const retryActor = actors[1];
    const pending = await tasks.start(source, 'new', retryActor);
    for (let i = 0; !oldFinish && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(new Date(pending.deadlineAt).getTime() - new Date(pending.createdAt).getTime(), 150000);
    await db.talentResumeTask.update({ where: { id: pending.id }, data: {
      createdAt: new Date(Date.now() - 150001), deadlineAt: new Date(Date.now() - 1),
    } });
    assert.equal((await tasks.get(pending.id, retryActor)).status, 'timed_out');
    oldFinish!();
    for (let i = 0; i < 50 && (tasks as any).active.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    provider.parse = async () => { calls++; return { fields: { name: 'Retry' }, reviewItems: [], pageCount: 1 }; };
    const retry = await tasks.retry(pending.id, retryActor);
    for (let i = 0; i < 100; i++) { done = await tasks.get(retry.id, retryActor); if (done.status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.notEqual(retry.id, pending.id); assert.equal(done.result.fields.name, 'Retry');
    assert.equal((await tasks.get(pending.id, retryActor)).status, 'timed_out');
    proof.push('150-second-deadline-explicit-file-retry-and-late-result-fence');
    await db.talentResumeTask.updateMany({ where: { ownerId: { in: ids } }, data: {
      createdAt: new Date(Date.now() - 31 * 60000), deadlineAt: new Date(Date.now() - 29 * 60000), expiresAt: new Date(Date.now() - 1),
    } });
    await assert.rejects(() => tasks.get(retry.id, retryActor), (error: any) => error.getStatus() === 404);
    await tasks.cleanup(); assert.equal(await db.talentResumeTask.count({ where: { ownerId: { in: ids } } }), 0);
    proof.push('expiry-inaccessible-and-source-result-cleanup');
    console.log(JSON.stringify({ ok: true, fictionalOnly: true, realPostgres: true, providerStub: true, externalCalls: 0, proof }));
  } finally {
    if (app) await app.close();
    await db.talentResumeTask.deleteMany({ where: { ownerId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}

describe('Resume recovery against isolated preview PostgreSQL/HTTP', () => {
  it('proves task lifecycle, encryption, duplicate requests and ownership without external calls', () => {
    const output = execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      input: `(${inPreview.toString()})().catch(error => { console.error(JSON.stringify({ ok:false, name:error.name, message:error.message })); process.exitCode=1; });`,
      encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    });
    expect(output).toContain('"ok":true');
    process.stdout.write(output);
  }, 100000);
});
