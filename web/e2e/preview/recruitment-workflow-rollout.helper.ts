import { test as base, expect, type APIResponse, type Page, type Response, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const origin = 'http://localhost:5173';
export type Actor = { id: string; name: string; token: string };
export type Directory = { id: string; name: string; code: string };
export type Fixture = {
  prefix: string; baseline: unknown; department: Directory; position: Directory; secondPosition: Directory; education: Directory;
  actors: Record<'operator' | 'dual' | 'reviewer' | 'confirmer' | 'viewer' | 'outsider' | 'assessor', Actor>;
};
export type Application = { id: string; candidateId: string; revision: number; stage: string; intentDemandId: string | null;
  sourceChannel: string | null; recruitmentDemandId: string | null; recruitmentDemandSnapshot: unknown;
  hiringRequestedById: string | null; hiringReviewedById: string | null };
export type Demand = { id: string; revision: number; occupiedCount: number; sourceState: string; trackingState: string };
export type Intake = { id: string; revision: number; state: string; demandId: string | null; candidateId: string | null; applicationId: string | null };
export type Workbench = { groups: Array<{ key: string; total: number; items: Array<{ id: string; title: string; intakeId?: string; applicationId?: string }> }> };
export type Proof = { stage: string; cases: string[]; [key: string]: unknown };

// All database access goes through the existing preview and fictional-data guards.
export function previewNode<T>(body: string): T {
  try {
    const output = execFileSync('docker', ['exec', '-i', '-w', '/app', 'hrm-api-1', 'node'], {
      encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'], input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const {PrismaClient}=require('@prisma/client'); const db=new PrismaClient({log:[],errorFormat:'minimal'});
      const fixtures=require('./test/talent-core/recruitment-intake-fixtures.cjs');
      (async()=>{await require('./test/talent-core/recruitment-demand-preview.cjs').assertFictionalDatabase(db);${body}})()
      .catch(()=>{process.exitCode=1;}).finally(()=>db.$disconnect());`,
    });
    return JSON.parse(output) as T;
  } catch { throw new Error('Guarded rollout fixture operation failed; private process output suppressed'); }
}

export async function json<T>(result: Pick<APIResponse | Response, 'status' | 'url' | 'json'>, status = 200): Promise<T> {
  expect(result.status(), new URL(result.url()).pathname).toBe(status);
  const envelope = await result.json(); expect(envelope.code).toBe(0); return envelope.data as T;
}
export function response(page: Page, method: string, path: string, action?: string) {
  return page.waitForResponse(row => new URL(row.url()).pathname === '/api/v1' + path && row.request().method() === method
    && (!action || row.request().postDataJSON()?.action === action));
}
export async function api<T>(page: Page, actor: Actor, method: string, path: string, data?: unknown, status = 200): Promise<T> {
  return json<T>(await page.request.fetch(origin + '/api/v1' + path, { method, headers: { authorization: 'Bearer ' + actor.token }, data }), status);
}
export async function as(page: Page, actor: Actor, path: string) {
  await page.goto('/login');
  await page.evaluate(token => { localStorage.setItem('token', token); localStorage.setItem('expiresAt', String(Date.now() + 3500000)); }, actor.token);
  await page.goto(path);
}
export const field = (page: Page, scope: ReturnType<Page['locator']>, label: string) =>
  scope.locator('.el-form-item').filter({ has: page.getByText(label, { exact: true }) });
export async function choose(page: Page, select: ReturnType<Page['locator']>, name: string) {
  await select.press('Enter'); const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible(); await option.click();
}
export async function capture(page: Page, info: TestInfo, proof: Proof, name: string) {
  const dimensions = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    panels: [...document.querySelectorAll('.el-drawer__body, .el-dialog__body')].filter(node => node.getClientRects().length)
      .map(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth })) }));
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  const png = await readFile(path);
  const screenshots = (proof.screenshots ??= []) as unknown[];
  screenshots.push({ name, ...dimensions, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } });
  expect(dimensions.documentWidth, name + ': document overflow').toBeLessThanOrEqual(dimensions.viewport.width + 1);
  for (const panel of dimensions.panels) expect(panel.scrollWidth, name + ': panel overflow').toBeLessThanOrEqual(panel.width + 1);
}

export async function approvedDemand(page: Page, f: Fixture, position = f.position) {
  let row = await api<Demand>(page, f.actors.operator, 'POST', '/recruitment-demands/local', { requestId: randomUUID(),
    deptId: f.department.id, positionId: position.id, headcount: 2, reason: `虚构${f.prefix}全流程验收` }, 201);
  row = await api<Demand>(page, f.actors.operator, 'POST', `/recruitment-demands/${row.id}/local-actions`,
    { expectedRevision: row.revision, action: 'submit' }, 201);
  return api<Demand>(page, f.actors.reviewer, 'POST', `/recruitment-demands/${row.id}/local-actions`,
    { expectedRevision: row.revision, action: 'approve' }, 201);
}
export async function seedApplication(page: Page, f: Fixture, name: string, demandId: string | null, position = f.position, sourceChannel: string | null = 'job_site') {
  const candidate = await api<{ id: string }>(page, f.actors.operator, 'POST', '/talents', {
    name: `虚构${f.prefix}_${name}`, phone: `170${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
    sourceChannel: 'other', education: f.education.name, educationReferenceDataId: f.education.id,
  }, 201);
  return api<Application>(page, f.actors.operator, 'POST', `/talent-recruitment/candidates/${candidate.id}/applications`, {
    requestId: randomUUID(), deptId: f.department.id, positionName: position.name, intentDemandId: demandId, sourceChannel,
  }, 201);
}
export async function setupAccepted(page: Page, f: Fixture, demand: Demand, name: string) {
  let row = await seedApplication(page, f, name, demand.id);
  const action = async (actor: Actor, action: string, extra = {}) => {
    row = await api<Application>(page, actor, 'POST', `/talent-recruitment/applications/${row.id}/actions`, {
      expectedRevision: row.revision, action, note: `虚构${f.prefix}明确的测试前置`, ...extra,
    }, 201);
  };
  await action(f.actors.operator, 'submit_hiring', { recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision });
  await action(f.actors.confirmer, 'approve_hiring'); await action(f.actors.operator, 'accept_offer');
  return row;
}

export const test = base.extend<{ owned: { f: Fixture; proof: Proof } }>({
  owned: async ({ page }, use, info) => {
    expect(process.env.HRM_RECRUITMENT_ROLLOUT_READY, 'Run only after the owner explicitly confirms the refreshed preview').toBe('1');
    expect(info.config.globalSetup).toBeNull(); expect(info.project.use.baseURL).toBe(origin);
    expect(info.project.outputDir.replaceAll('\\', '/'), 'A new owned runXX output directory is required')
      .toMatch(/\/test-results\/recruitment-workflow-rollout\/run\d+$/);
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 390 : 1440, height: info.project.name === 'mobile' ? 844 : 900 });
    const f = previewNode<Fixture>(`console.log(JSON.stringify(await fixtures.createIntakeFixture(db,'RDI_'+require('node:crypto').randomUUID().slice(0,8))));`);
    const proof: Proof = { stage: 'fixture_created', cases: [], prefix: f.prefix, viewport: page.viewportSize(),
      realNestHttp: true, realPostgres: true, routeMocks: false,
      evidenceBoundary: 'Real isolated application; fictional identities. API/DB setup is not UI acceptance.',
      outboundBoundary: 'Preview guard disables DingTalk credentials/notifications/calendar; no mailbox, AI, or upstream action in this suite.' };
    const pageErrors: string[] = [], externalCalls: string[] = [], forbiddenActions: string[] = [];
    const onError = (error: Error) => pageErrors.push(error.message);
    const onRequest = (request: import('@playwright/test').Request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) externalCalls.push(url.hostname + url.pathname);
      if (/\/recruitment-intakes\/mailbox\/sync$|\/recruitment-intakes\/[^/]+\/parse$|\/recruitment-demands\/sync/.test(url.pathname)) forbiddenActions.push(url.pathname);
    };
    page.on('pageerror', onError); page.context().on('request', onRequest);
    try {
      await use({ f, proof });
      expect(pageErrors).toEqual([]); expect(externalCalls).toEqual([]); expect(forbiddenActions).toEqual([]);
    } finally {
      proof.status = info.status; proof.pageErrors = pageErrors; proof.browserExternalCalls = externalCalls;
      proof.mailboxAiUpstreamRequests = forbiddenActions;
      if (info.status !== 'passed') {
        try { await capture(page, info, proof, 'FAILED-' + proof.stage); } catch (error) { proof.failureCaptureError = String(error); }
      }
      try {
        // Explicitly owned onboarding prerequisites are archived, never unrelated requests or employees.
        proof.ownedOnboardingCleanup = previewNode(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
          const result=await db.employeeDataChangeRequest.updateMany({where:{createdById:{in:owner.actorIds},
          employeeName:{startsWith:${JSON.stringify('虚构' + f.prefix)}},sourceReference:${JSON.stringify(f.prefix)},archivedAt:null},data:{archivedAt:new Date()}});
          console.log(JSON.stringify({archived:result.count}));`);
        proof.cleanup = previewNode(`console.log(JSON.stringify(await fixtures.archiveIntakeFixture(db,${JSON.stringify(f.prefix)})));`);
        expect(proof.cleanup).toMatchObject({ activeActors: 0, activeCandidates: 0, activeDemands: 0, openIntakes: 0, activePostings: 0 });
        previewNode(`await fixtures.assertProtectedBaseline(db,${JSON.stringify(f.baseline)});console.log(JSON.stringify({protected:true}));`);
        proof.protected32PayrollBatchesAndOldDemandsUnchanged = true;
      } finally {
        page.removeListener('pageerror', onError); page.context().removeListener('request', onRequest);
        await writeFile(info.outputPath('proof.json'), JSON.stringify(proof, null, 2));
      }
    }
  },
});
export { expect };
