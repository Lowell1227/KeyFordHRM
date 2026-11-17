import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://localhost:5173';
const cycleId = randomUUID();
const taskId = randomUUID();
const claimTaskId = randomUUID();
const managerOwnTaskId = randomUUID();
const keys: string[] = [];

function fixture(code: string) {
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], {
    encoding: 'utf8', timeout: 20_000, input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
      (async () => {
        if (!await db.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview fixture required');
        ${code}
      })().finally(() => db.$disconnect()).catch(error => { console.error(error.name, error.code ?? 'fixture-failed'); process.exitCode = 1; });
    `,
  }).trim() || 'null');
}

async function login(request: APIRequestContext, employeeNo: string) {
  const response = await request.post(`${origin}/api/v1/auth/test-login`, { data: { employeeNo } });
  expect(response.status()).toBe(200);
  const body = (await response.json()).data;
  return { authorization: `Bearer ${body.token ?? body.accessToken}` };
}

test.beforeAll(({}, info) => {
  expect(info.project.use.baseURL).toBe(origin);
  execFileSync('docker', ['exec', 'hrm-api-1', 'node', 'prisma/preview-guard.cjs'], { stdio: 'pipe', timeout: 15_000 });
  fixture(`
    const employee = await db.user.findFirstOrThrow({ where: { employeeNo: 'EMP001', deletedAt: null } });
    const other = await db.user.findFirstOrThrow({ where: { employeeNo: 'EMP002', deletedAt: null } });
    const manager = await db.user.findFirstOrThrow({ where: { employeeNo: 'MGR001', deletedAt: null } });
    await db.assessmentCycle.create({ data: { id: '${cycleId}', name: 'AUDIT attachment access',
      startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30'), status: 'self_eval', notificationMode: 'off' } });
    await db.assessmentTask.createMany({ data: [
      { id: '${taskId}', cycleId: '${cycleId}', employeeId: employee.id, managerId: manager.id, status: 'self_eval' },
      { id: '${claimTaskId}', cycleId: '${cycleId}', employeeId: other.id, status: 'self_eval' },
      { id: '${managerOwnTaskId}', cycleId: '${cycleId}', employeeId: manager.id, status: 'self_eval' },
    ] });
  `);
});

test.afterAll(() => {
  fixture(`
    await db.notificationLog.deleteMany({ where: { taskId: { in: ['${taskId}', '${claimTaskId}', '${managerOwnTaskId}'] } } });
    await db.flowRecord.deleteMany({ where: { taskId: { in: ['${taskId}', '${claimTaskId}', '${managerOwnTaskId}'] } } });
    await db.assessmentTask.deleteMany({ where: { cycleId: '${cycleId}' } });
    await db.assessmentCycle.deleteMany({ where: { id: '${cycleId}' } });
    const { Client } = require('minio'); const storage = new Client({ endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT), useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
    for (const key of ${JSON.stringify(keys)}) await storage.removeObject(process.env.MINIO_BUCKET, key);
  `);
});

test('real upload ownership, task access, legacy links and reference forgery', async ({ request }) => {
  const employee = await login(request, 'EMP001');
  const manager = await login(request, 'MGR001');
  const other = await login(request, 'EMP002');
  const upload = await request.post(`${origin}/api/v1/storage/upload`, {
    headers: employee, multipart: { file: { name: 'audit.txt', mimeType: 'text/plain', buffer: Buffer.from('fictional audit evidence') } },
  });
  expect(upload.status()).toBe(201);
  const attachment = (await upload.json()).data;
  const key = new URL(attachment.url, origin).searchParams.get('key')!;
  keys.push(key);
  const download = (headers: Record<string, string>, url = attachment.url) => request.get(`${origin}/api/v1${url}`, { headers });
  expect((await download(employee)).status()).toBe(200);
  expect((await download(other)).status()).toBe(403);
  expect((await download(manager)).status()).toBe(403);

  const variant = await request.post(`${origin}/api/v1/tasks/${taskId}/self-eval`, {
    headers: employee, data: { indicators: [], summary: { attachments: [{ ...attachment, url: `${attachment.url}&download=1` }] } },
  });
  expect(variant.status()).toBe(403);

  const stolen = await request.post(`${origin}/api/v1/tasks/${claimTaskId}/self-eval`, {
    headers: other, data: { indicators: [], summary: { attachments: [attachment] } },
  });
  expect(stolen.status()).toBe(403);
  expect(fixture(`console.log(JSON.stringify(await db.selfEvalSummary.count({ where: { taskId: '${claimTaskId}' } })));`)).toBe(0);
  const submitted = await request.post(`${origin}/api/v1/tasks/${taskId}/self-eval`, {
    headers: employee, data: { indicators: [], summary: { achievements: 'fictional evidence', attachments: [attachment] } },
  });
  expect(submitted.status()).toBe(200);
  expect((await download(manager)).status()).toBe(200);
  expect((await download(other)).status()).toBe(403);

  const managerUpload = await request.post(`${origin}/api/v1/storage/upload`, {
    headers: manager, multipart: { file: { name: 'manager.txt', mimeType: 'text/plain', buffer: Buffer.from('fictional manager evidence') } },
  });
  expect(managerUpload.status()).toBe(201);
  const managerAttachment = (await managerUpload.json()).data;
  keys.push(new URL(managerAttachment.url, origin).searchParams.get('key')!);
  const detail = await request.get(`${origin}/api/v1/tasks/${taskId}`, { headers: manager });
  expect(detail.status()).toBe(200);
  const draft = await request.put(`${origin}/api/v1/tasks/${taskId}/manager-evaluation-draft`, {
    headers: manager, data: { expectedUpdatedAt: (await detail.json()).data.updatedAt,
      indicators: [], evalSummary: { attachments: [managerAttachment] } },
  });
  expect(draft.status()).toBe(200);

  // A pre-fix object has no uploader metadata; its existing task reference remains authoritative.
  const legacyKey = `uploads/2026/11/16/${randomUUID()}-legacy.txt`;
  keys.push(legacyKey);
  const legacyUrl = `/storage/download?key=${encodeURIComponent(legacyKey)}`;
  fixture(`
    const { Client } = require('minio'); const storage = new Client({ endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT), useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
    await storage.putObject(process.env.MINIO_BUCKET, '${legacyKey}', Buffer.from('fictional legacy evidence'));
    const summary = await db.managerEvalSummary.findUniqueOrThrow({ where: { taskId: '${taskId}' } });
    await db.managerEvalSummary.update({ where: { taskId: '${taskId}' }, data: { attachments: [...summary.attachments, { url: '${legacyUrl}', name: 'legacy.txt' }] } });
  `);
  expect((await download(manager, legacyUrl)).status()).toBe(200);
  expect((await download(employee, legacyUrl)).status()).toBe(403);
  fixture(`await db.assessmentTask.update({ where: { id: '${taskId}' }, data: { status: 'published' } });`);
  expect((await download(employee, legacyUrl)).status()).toBe(200);
  fixture(`await db.assessmentCycle.update({ where: { id: '${cycleId}' }, data: { publishVisibleFields: { manager_comment: false } } });`);
  expect((await download(employee, legacyUrl)).status()).toBe(403);
  fixture(`await db.assessmentTask.update({ where: { id: '${taskId}' }, data: { managerId: null } });`);
  expect((await download(manager, legacyUrl)).status()).toBe(403);
  expect((await download(other, legacyUrl)).status()).toBe(403);
  const reattach = await request.post(`${origin}/api/v1/tasks/${managerOwnTaskId}/self-eval`, {
    headers: manager, data: { indicators: [], summary: { attachments: [managerAttachment] } },
  });
  expect(reattach.status()).toBe(403);
  expect((await download(manager, managerAttachment.url)).status()).toBe(403);
});
