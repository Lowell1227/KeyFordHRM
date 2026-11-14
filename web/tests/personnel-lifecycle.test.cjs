const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
function loadTs(relative) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const lifecycle = loadTs('src/utils/employee-lifecycle.ts');
const pending = () => ({
  id: 'request-1', intakeType: 'new_hire', sourceType: 'manual_employee_create',
  recordStatus: 'submitted', onboardingStatus: 'pending_entry', requestVersion: 3,
  requiresArrivalConfirmation: true, arrivalConfirmedAt: null,
  profileReviewStatus: 'approved', performanceReviewStatus: 'not_required',
  proposedValue: { employee: { effectiveFrom: '2026-11-12', entryDate: '2026-11-12' } },
});

test('arrival remains pending even after the reviewed date and a profile applied timestamp', () => {
  const request = { ...pending(), appliedAt: '2026-11-12T00:00:00Z' };
  assert.equal(lifecycle.applicationProgress(request), '待确认到岗');
  assert.equal(lifecycle.isPendingArrival(request), true);
});

test('arrival requires reviewed intake and excludes cancellation, draft, legacy and completed records', () => {
  assert.equal(lifecycle.isPendingArrival(pending()), true);
  for (const override of [
    { requiresArrivalConfirmation: false }, { arrivalConfirmedAt: '2026-11-12T00:00:00Z' },
    { onboardingStatus: 'effective' }, { onboardingStatus: 'cancelled' }, { recordStatus: 'draft' },
    { profileReviewStatus: 'pending' }, { profileReviewStatus: 'rejected' }, { cancelledAt: '2026-11-12' },
  ]) assert.equal(lifecycle.isPendingArrival({ ...pending(), ...override }), false);
});

test('arrival must match reviewed date, carry a version, and not be future in Shanghai', () => {
  const now = new Date('2026-11-11T16:30:00Z');
  assert.equal(lifecycle.arrivalConfirmationError(pending(), '2026-11-12', now), '');
  assert.match(lifecycle.arrivalConfirmationError(pending(), '2026-11-11', now), /审核/);
  assert.match(lifecycle.arrivalConfirmationError(pending(), '2026-11-12', new Date('2026-11-11T15:30:00Z')), /未来/);
  assert.match(lifecycle.arrivalConfirmationError({ ...pending(), requestVersion: undefined }, '2026-11-12', now), /版本/);
  assert.match(lifecycle.arrivalConfirmationError({ ...pending(), requestVersion: 0 }, '2026-11-12', now), /版本/);
  assert.notEqual(lifecycle.arrivalConfirmationError({ ...pending(), proposedValue: { employee: { effectiveFrom: '2026-02-30' } } }, '2026-02-30', now), '');
  assert.equal(lifecycle.reviewedArrivalDate({ ...pending(), intakeType: 'reentry', proposedValue: { employee: { effectiveDate: '2026-11-12' } } }), '2026-11-12');
});

test('ordinary interview routes require login without talent-management authorization or menu entries', () => {
  const { routes } = loadTs('src/router/routes.ts');
  for (const routePath of ['/talent-interviews', '/talent-interviews/:id']) {
    const route = routes.find(item => item.path === routePath);
    assert.equal(route.meta.requiresAuth, true);
    assert.equal(route.meta.roles, undefined);
    assert.equal(route.meta.hrCapabilities, undefined);
    assert.equal(route.meta.navigation, undefined);
  }
  const performanceRoutes = routes.filter(item => item.path === '/interviews');
  assert.equal(performanceRoutes.length, 1);
  assert.equal(performanceRoutes[0].meta.title, '绩效面谈');
  assert.equal(new Set(routes.map(item => item.path)).size, routes.length);
});

test('entry-exit excludes transfers and archive edits without losing resignation or legacy onboarding', () => {
  assert.equal(lifecycle.isPersonnelLifecycleRequest(pending()), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ sourceType: 'manual_employee_create' }), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ proposedValue: { employee: { changeType: 'resignation' } } }), true);
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ sourceType: 'manual_archive_change' }), false);
  const resignedProfileEdit = { sourceType: 'manual_archive_change', baseValue: { employee: { employeeStatus: 'resigned' } }, proposedValue: { employee: { employeeStatus: 'resigned' } } };
  assert.equal(lifecycle.isPersonnelLifecycleRequest(resignedProfileEdit), false);
  assert.equal(lifecycle.applicationType(resignedProfileEdit), '档案修改');
  assert.equal(lifecycle.isPersonnelLifecycleRequest({ proposedValue: { employee: { changeType: 'transfer' } } }), false);
});

test('submission message separates exempt applied fields from pending review', () => {
  assert.equal(lifecycle.archiveSubmissionMessage({ directApplied: ['姓名'], request: null }), '档案已更新');
  assert.match(lifecycle.archiveSubmissionMessage({ directApplied: ['姓名'], request: { profileReviewStatus: 'pending' } }), /姓名已生效.*其余变更已提交审核/);
  assert.doesNotMatch(lifecycle.archiveSubmissionMessage({ directApplied: [], request: { profileReviewStatus: 'pending' } }), /已生效/);
});

test('legacy review and application links retain query context at entry-exit', () => {
  const { routes } = loadTs('src/router/routes.ts');
  assert.equal(routes.find(route => route.path === '/entry-exit').meta.navigation.label, '入离职');
  const oldReview = routes.find(route => route.path === '/personnel-change-reviews');
  assert.deepEqual(oldReview.redirect({ query: { category: 'position', requestId: 'r1' }, hash: '' }), {
    path: '/entry-exit', query: { category: 'position', requestId: 'r1', tab: 'reviews' }, hash: '',
  });
  const oldProcessing = routes.find(route => route.path === '/personnel-processing');
  assert.equal(oldProcessing.redirect({ query: { requestId: 'r2' }, hash: '' }).query.requestId, 'r2');
});

test('archive editor exposes one Submit command without manual save or policy modes', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/admin/UserManageView.vue'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeArchiveInlineEditor.vue'), 'utf8');
  assert.equal(/reviewMode|宽松模式|保存后关闭|saveArchiveAndClose/.test(view + editor), false);
  assert.match(view, /@click="archiveEditorRef\?\.submit\(\)">提交<\/el-button>/);
  assert.match(editor, /session !== generation/);
  assert.match(editor, /expectedVersion: draftId \? draftVersion/);
});

test('talent source travels in payloads, never from name/phone route parameters', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/admin/UserManageView.vue'), 'utf8');
  const create = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeCreateDrawer.vue'), 'utf8');
  const reentry = fs.readFileSync(path.join(root, 'src/views/admin/components/EmployeeReentryDrawer.vue'), 'utf8');
  assert.equal(/fromTalent|route\.query\.phone|route\.query\.name/.test(view), false);
  assert.equal(view.includes('await talentPoolApi.detail(id)'), true);
  assert.equal(create.includes('talentCandidateId: sourceTalentId.value'), true);
  assert.equal(create.includes("emit('reentry', candidate.id, talentId)"), true);
  assert.equal(reentry.includes('talentCandidateId: currentRequest.value?.talentCandidateId ?? props.talentCandidateId'), true);
  assert.equal(/saveAndExit|保存并退出/.test(create), false);
});

test('Playwright desktop/mobile history renders per-round differences and independent audits without a backend', async t => {
  const { createServer } = await import('vite');
  const { default: vuePlugin } = await import('@vitejs/plugin-vue');
  const { chromium, expect } = require('@playwright/test');
  const portProbe = require('node:net').createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const request = {
    id: 'browser-history', sourceType: 'manual_employee_create', intakeType: 'new_hire', requestVersion: 3,
    recordStatus: 'submitted', onboardingStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    createdAt: '2026-11-10T01:00:00Z', baseValue: {}, proposedValue: { employee: { effectiveFrom: '2026-11-15' } },
    revisionHistory: [
      { version: 1, proposedValue: { employee: { effectiveFrom: '2026-11-12' } } },
      { version: 2, proposedValue: { employee: { effectiveFrom: '2026-11-14' } } },
    ],
    events: [
      { id: 'rejected-1', action: 'reject_employee_data_change', createdAt: '2026-11-11T01:00:00Z', newValue: { reason: '第一轮退回原因' } },
      { id: 'revised-2', action: 'revise_employee_arrival_date', createdAt: '2026-11-12T01:00:00Z', newValue: { requestVersion: 2 } },
      { id: 'rejected-2', action: 'reject_employee_data_change', createdAt: '2026-11-12T02:00:00Z', newValue: { reason: '第二轮退回原因'.repeat(10) } },
      { id: 'revised-3', action: 'revise_employee_arrival_date', createdAt: '2026-11-13T01:00:00Z', newValue: { requestVersion: 3 } },
    ],
  };
  const standalone = { id: 'standalone-direct', action: 'employee_profile_direct_update', createdAt: '2026-11-13T01:00:00Z',
    oldValue: { education: '本科' }, newValue: { education: '硕士' } };
  const code = `import { createApp, h } from 'vue';
    import ElementPlus from 'element-plus';
    import 'element-plus/dist/index.css';
    import Detail from '/src/views/admin/components/EmployeeApplicationDetail.vue';
    import History from '/src/views/admin/components/EmployeeChangeHistory.vue';
    const request = ${JSON.stringify(request)};
    createApp({ render: () => h('main', { style: 'max-width:960px;margin:auto;padding:12px;box-sizing:border-box;font-family:Arial,sans-serif' }, [
      h('section', { id: 'detail-fixture' }, [h(Detail, { request })]),
      h('section', { id: 'history-fixture' }, [h(History, { requests: [request], events: [${JSON.stringify(standalone)}] })])
    ]) }).use(ElementPlus).mount('#app');`;
  const server = await createServer({ root, configFile: false,
    cacheDir: path.join(root, '../tmp/personnel-web-log-agent/vite-cache'),
    resolve: { alias: { '@': path.join(root, 'src') } },
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [vuePlugin(), {
      name: 'personnel-history-test-only',
      resolveId: id => id === '/personnel-history-fixture.ts' ? '\0personnel-history-fixture' : undefined,
      load: id => id === '\0personnel-history-fixture' ? code : undefined,
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/personnel-history-fixture') return next();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="app"></div><script type="module" src="/personnel-history-fixture.ts"></script></body></html>');
        });
      },
    }],
  });
  t.after(() => server.close());
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const forbidden = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(origin + '/') || new URL(url).pathname.startsWith('/api/')) {
        forbidden.push(url); return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin + '/personnel-history-fixture');
    const detail = page.locator('#detail-fixture');
    await expect(detail.locator('[data-event-id="revised-2"]')).toBeVisible();
    await page.locator('#history-fixture .el-collapse-item__header').click();
    for (const scope of [detail, page.locator('#history-fixture')]) {
      for (const [id, before, after] of [['revised-2', '2026-11-12', '2026-11-14'], ['revised-3', '2026-11-14', '2026-11-15']]) {
        const round = scope.locator(`[data-event-id="${id}"]`);
        await round.locator('summary').click();
        await expect(round.locator('dd')).toHaveText(`${before} → ${after}`);
      }
      await expect(scope.locator('[data-event-id="rejected-1"]')).toContainText('第一轮退回原因');
      await expect(scope.locator('[data-event-id="rejected-2"]')).toContainText('第二轮退回原因');
    }
    const direct = page.locator('[data-event-id="standalone-direct"]');
    await direct.locator('summary').click();
    await expect(direct).toContainText('本科 → 硕士');
    await expect(direct).toContainText('未记录');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(forbidden, []);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, `../tmp/personnel-web-log-agent/history-rounds-${width}.png`), fullPage: true });
    await page.close();
  }
});
