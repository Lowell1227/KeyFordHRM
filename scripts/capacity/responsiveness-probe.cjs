#!/usr/bin/env node
'use strict';

// Parent runs this after merging responsiveness-fixture.cjs stdout into the private manifest.
// Usage: node scripts/capacity/responsiveness-probe.cjs --manifest <private.json> --out <owned-subdirectory>
// --self-test is offline: no Playwright import, Docker, database, browser or HTTP.
// Optional CAPACITY_RESPONSIVENESS_HEADED=1 permits real Chromium window visibility checks.
// No HAR, screenshots, trace, storageState, response bodies, headers or credentials are saved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { requestAllowed, routeTemplate } = require('./browser-probe.cjs');
const TIMEOUT = 30000, AUTO_WINDOW = 15000, HOLD_WINDOW = 11500;
const VIEWPORTS = [{ name: 'pc', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const elapsed = start => Math.round(performance.now() - start);
class ProbeError extends Error { constructor(code) { super(code); this.code = code; } }
function check(condition, code) { if (!condition) throw new ProbeError(code); }
function reason(error) { return error instanceof ProbeError ? error.code : error?.name === 'TimeoutError' ? 'timeout' : 'probe_error_detail_omitted'; }

function validateManifest(value) {
  check(/^CAP_[a-f0-9]{12}$/.test(value?.runId || ''), 'invalid_run_id');
  check(typeof value.baseURL === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/?$/.test(value.baseURL), 'unsafe_base_url');
  const url = new URL(value.baseURL);
  check(+url.port >= 1024 && +url.port <= 65535 && +url.port !== 5173, 'unsafe_port');
  const prefix = `${value.runId.slice(4)}-`;
  function actor(account, suffix) {
    check(account?.employeeNo === prefix + suffix && typeof account.password === 'string'
      && account.password.length >= 20 && /^[a-f0-9-]{36}$/.test(account.id || ''), 'invalid_owned_account');
    return { id: account.id, employeeNo: account.employeeNo, password: account.password };
  }
  const actors = Object.fromEntries(['manager', 'head', 'leader', 'hr'].map(role => [role, actor(value.actors?.[role], role)]));
  check(value.responsiveness?.schemaVersion === 1, 'responsiveness_fixture_required');
  check(typeof value.handoff?.password === 'string' && value.handoff.password.length >= 20, 'fixture_password_missing');
  const ids = new Set();
  function fixture(item, kind, viewport) {
    const suffix = `${kind === 'handoffs' ? 'goal' : 'result'}-${viewport}`;
    check(item?.employeeNo === prefix + 'rsp-' + suffix && item.employeeName === `Synthetic response-${suffix}`
      && typeof item.cycleName === 'string' && item.cycleName.startsWith(value.runId + ' Response '), 'unowned_fixture_identity');
    for (const key of ['id', 'taskId', 'cycleId']) check(/^[a-f0-9-]{36}$/.test(item[key] || ''), 'invalid_fixture_id');
    check(!ids.has(item.taskId), 'fixture_task_reused'); ids.add(item.taskId);
    return { id: item.id, employeeNo: item.employeeNo, employeeName: item.employeeName,
      taskId: item.taskId, cycleId: item.cycleId, cycleName: item.cycleName, password: value.handoff.password };
  }
  const responsiveness = {};
  for (const kind of ['handoffs', 'approvals']) responsiveness[kind] = Object.fromEntries(VIEWPORTS.map(viewport =>
    [viewport.name, fixture(value.responsiveness[kind]?.[viewport.name], kind, viewport.name)]));
  return { runId: value.runId, baseURL: url.origin, actors, responsiveness };
}

function validateProxy(proxy, runId, baseURL) {
  check(proxy?.Config?.Labels?.['hrm.capacity.run'] === runId
    && proxy.Name === `/hrm-cap-${runId.toLowerCase()}-proxy` && proxy.State?.Running, 'proxy_not_owned_or_running');
  const ports = proxy.NetworkSettings?.Ports?.['80/tcp'];
  check(Array.isArray(ports) && ports.length === 1 && ports[0].HostIp === '127.0.0.1'
    && String(ports[0].HostPort) === new URL(baseURL).port, 'proxy_port_mismatch');
}
function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
async function until(predicate, timeout, code) {
  const started = performance.now();
  do { if (await predicate()) return; await sleep(100); } while (elapsed(started) < timeout);
  throw new ProbeError(code);
}
async function unwrap(response) {
  check(response?.ok(), 'http_request_rejected');
  const body = await response.json();
  check(body?.code === 0 && body.data !== undefined, 'invalid_api_envelope');
  return body.data;
}
function readCount(session, endpoint) { return session.requests.filter(item => item.endpoint === endpoint && item.method === 'GET').length; }
async function focusState(page) {
  return page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus(),
    events: { ...window.__responsivenessEvents } }));
}

async function openSession(browser, manifest, viewport, label, report) {
  const output = { label, viewport: viewport.name, pageErrors: 0, blockedExternal: 0, blockedWrites: 0, routingErrors: 0 };
  report.sessions.push(output);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile', acceptDownloads: false, serviceWorkers: 'block' });
  const session = { context, output, requests: [], authorization: null, fault: null, navigations: 0 };
  try {
    const allowedWrites = new Set(['/api/v1/auth/login',
      ...Object.values(manifest.responsiveness.handoffs).map(item => `/api/v1/tasks/${item.taskId}/indicators/confirm`),
      ...Object.values(manifest.responsiveness.approvals).map(item => `/api/v1/cycles/${item.cycleId}/calibration/confirm`)]);
    await context.route('**/*', async route => {
      try {
        const request = route.request();
        if (!requestAllowed(request.url(), manifest.baseURL)) {
          output.blockedExternal++; await route.abort('blockedbyclient'); return;
        }
        const url = new URL(request.url());
        if (url.origin === manifest.baseURL && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
          && !(request.method() === 'POST' && allowedWrites.has(url.pathname))) {
          output.blockedWrites++; await route.abort('blockedbyclient'); return;
        }
        const fault = session.fault;
        if (request.method() === 'GET' && fault?.endpoint === url.pathname
          && (!fault.once || fault.hits === 0)) {
          fault.hits++;
          if (fault.abort) { await route.abort('failed'); return; }
          if (fault.delayMs) await sleep(fault.delayMs);
        }
        await route.continue();
      } catch { if (!session.closing) output.routingErrors++; }
    });
    await context.routeWebSocket('**/*', socket => {
      if (requestAllowed(socket.url(), manifest.baseURL)) socket.connectToServer();
      else { output.blockedExternal++; void socket.close().catch(() => {}); }
    });
    await context.addInitScript(() => {
      const events = { focus: 0, blur: 0, visible: 0, hidden: 0 };
      Object.defineProperty(window, '__responsivenessEvents', { value: events });
      window.addEventListener('focus', event => { if (event.isTrusted) events.focus++; });
      window.addEventListener('blur', event => { if (event.isTrusted) events.blur++; });
      document.addEventListener('visibilitychange', event => { if (event.isTrusted) events[document.hidden ? 'hidden' : 'visible']++; });
    });
    const page = await context.newPage(); session.page = page;
    page.setDefaultTimeout(TIMEOUT); page.setDefaultNavigationTimeout(TIMEOUT);
    const pending = new Map();
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== manifest.baseURL || !url.pathname.startsWith('/api/v1/')) return;
      // Raw endpoint and Authorization are memory-only; report summaries contain no IDs/headers.
      const item = { endpoint: url.pathname, route: routeTemplate(url.href), method: request.method(),
        started: performance.now(), status: null, finished: false, failed: false };
      session.requests.push(item); pending.set(request, item);
      if (request.method() === 'GET' && request.headers().authorization) session.authorization = request.headers().authorization;
    });
    page.on('response', response => { const item = pending.get(response.request()); if (item) item.status = response.status(); });
    for (const event of ['requestfinished', 'requestfailed']) page.on(event, request => {
      const item = pending.get(request);
      if (item) { item.finished = true; item.failed = event === 'requestfailed'; pending.delete(request); }
    });
    page.on('pageerror', () => { output.pageErrors++; });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) session.navigations++; });
    return session;
  } catch (error) { await context.close(); throw error; }
}
async function closeSession(session) {
  if (!session) return;
  session.closing = true;
  session.output.requests = session.requests.map(item => ({ route: item.route, method: item.method,
    status: item.status, finished: item.finished, failed: item.failed }));
  await session.context.close();
}

async function login(session, manifest, account, target) {
  const { page } = session;
  await page.goto(manifest.baseURL + '/login?redirect=' + encodeURIComponent(target), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-shell').waitFor();
  check(!await page.getByTestId('preview-login').isVisible(), 'password_form_hidden_by_preview_build');
  const toggle = page.getByTestId('password-login-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator('#login-employee-no').fill(account.employeeNo);
  await page.locator('#login-password').fill(account.password);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login'
    && response.request().method() === 'POST').catch(() => null);
  await page.getByTestId('login-submit').click();
  const response = await responsePromise;
  check(response?.ok(), 'password_login_rejected'); await response.finished();
  await page.waitForURL(url => url.pathname === new URL(target, manifest.baseURL).pathname);
  check(!page.url().includes('/change-password'), 'fixture_password_change_required');
}
async function readBackend(session, manifest, endpoint) {
  check(session.authorization, 'ui_authorization_not_observed');
  const response = await session.context.request.get(manifest.baseURL + endpoint, {
    headers: { Authorization: session.authorization }, timeout: TIMEOUT, maxRedirects: 0,
  });
  try { return await unwrap(response); } finally { await response.dispose(); }
}
function targetRow(session, fixture, kind) {
  const selector = kind === 'goal' ? '[data-testid="goal-plan-list"] .el-table__row:visible, [data-testid="goal-plan-list"] .goal-mobile:visible'
    : kind === 'calibration' ? '.calibration-view .desktop-result-table .el-table__row:visible, .calibration-mobile-list .mobile-result-card:visible'
      : '.approval-view .desktop-result-table .el-table__row:visible, .approval-mobile-list .mobile-result-card:visible';
  let rows = session.page.locator(selector).filter({ hasText: fixture.employeeName });
  rows = kind === 'goal' ? rows.filter({ hasText: fixture.cycleName }) : rows.filter({ hasText: fixture.employeeNo });
  return rows;
}
async function actionable(session, fixture, kind) {
  const rows = targetRow(session, fixture, kind);
  check(await rows.count() <= 1, 'ambiguous_visible_target');
  if (!await rows.count()) return false;
  const button = rows.getByRole('button', { name: kind === 'goal' ? '\u529e\u7406\u76ee\u6807' : '\u901a\u8fc7', exact: true });
  return await button.isVisible() && await button.isEnabled();
}
async function observeAuto(session, fixture, kind, endpoint, submittedAt, clickAt) {
  const navigations = session.navigations;
  await until(() => actionable(session, fixture, kind), Math.max(0, AUTO_WINDOW - elapsed(clickAt)), 'not_actionable_within_15s_without_refresh');
  const durationMs = elapsed(submittedAt);
  const clickToReadyMs = elapsed(clickAt);
  const reads = session.requests.filter(item => item.endpoint === endpoint && item.method === 'GET' && item.started >= clickAt);
  check(clickToReadyMs <= AUTO_WINDOW, 'frontend_exceeded_15s_from_ui_click');
  check(session.navigations === navigations, 'page_navigated_during_auto_window');
  check(reads.length > 0, 'no_automatic_frontend_list_request');
  return { actionable: true, readyAfterClickMs: clickToReadyMs, readyAfterSubmitMs: durationMs,
    automaticListReads: reads.length, manualRefreshes: 0,
    documentNavigations: session.navigations - navigations, focus: await focusState(session.page) };
}
async function waitQuiet(session, endpoint) {
  await until(() => !session.requests.some(item => item.endpoint === endpoint && !item.finished), TIMEOUT, 'list_request_not_settled');
}
async function holdInput(session, endpoint, input) {
  await waitQuiet(session, endpoint);
  const draft = 'Synthetic unsaved filter';
  await input.fill(draft);
  const count = readCount(session, endpoint), started = performance.now();
  await sleep(HOLD_WINDOW);
  const result = { heldMs: elapsed(started), listReadsWhileDirty: readCount(session, endpoint) - count,
    inputPreserved: await input.inputValue() === draft };
  check(result.inputPreserved && result.listReadsWhileDirty === 0, 'dirty_input_was_refreshed_or_lost');
  await input.fill(''); await input.press('Tab');
  return result;
}
async function retainOnFailure(session, endpoint, fixture, kind) {
  await waitQuiet(session, endpoint);
  const fault = { endpoint, abort: true, hits: 0 }; session.fault = fault;
  try {
    await until(() => fault.hits > 0, AUTO_WINDOW, 'no_background_request_for_failure_check');
    const alerts = session.page.locator(kind === 'goal' ? '[data-testid="goal-plan-list"] .el-alert--error:visible'
      : '.approval-view__load-error:visible');
    await until(async () => await alerts.count() > 0, 5000, 'background_failure_not_visible');
    const retained = await actionable(session, fixture, kind);
    let pendingCountRetained = null;
    if (kind === 'approval') {
      pendingCountRetained = /\u5f85\u6211\u5ba1\u6279\s+1\s+\u4eba/.test(await session.page.locator('.approval-view__overview-disclosure > summary').innerText());
    }
    check(retained && pendingCountRetained !== false, 'failed_background_read_displayed_false_zero');
    return { injected: 'same_origin_get_abort_only', abortedReads: fault.hits, previousRowRetained: retained,
      previousPendingCountRetained: pendingCountRetained, errorVisible: true };
  } finally { session.fault = null; }
}
async function nativeWindowProbe(session, endpoint) {
  const result = { status: 'unproven', syntheticEventsDispatched: false };
  let cdp, windowId;
  try {
    cdp = await session.context.newCDPSession(session.page);
    ({ windowId } = await cdp.send('Browser.getWindowForTarget'));
    result.before = await focusState(session.page);
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await sleep(750); result.minimized = await focusState(session.page);
    const count = readCount(session, endpoint), started = performance.now();
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.page.bringToFront(); await sleep(3000);
    result.restored = await focusState(session.page);
    result.observedMs = elapsed(started); result.listReadsWithinRestoreWindow = readCount(session, endpoint) - count;
    result.nativeHiddenVisible = result.minimized.visibility === 'hidden' && result.restored.visibility === 'visible'
      && result.minimized.events.hidden > result.before.events.hidden && result.restored.events.visible > result.before.events.visible;
    result.nativeFocus = result.restored.events.focus > result.before.events.focus;
    result.status = result.nativeHiddenVisible && result.listReadsWithinRestoreWindow > 0 ? 'observed' : 'unproven';
  } catch { result.reason = 'native_window_transition_unavailable'; }
  finally {
    if (cdp && windowId !== undefined) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
    await cdp?.detach().catch(() => {});
  }
  return result;
}

async function goalCase(browser, manifest, viewport, report) {
  const result = { kind: 'goal', viewport: viewport.name, status: 'incomplete', stage: 'reviewer_login' };
  report.cases.push(result);
  const fixture = manifest.responsiveness.handoffs[viewport.name];
  let reviewer, employee;
  try {
    reviewer = await openSession(browser, manifest, viewport, `goal_leader_${viewport.name}`, report);
    const listPath = '/api/v1/goal-plans';
    const query = new URLSearchParams({ scope: 'review', cycleId: fixture.cycleId, pageSize: '20' });
    const initial = reviewer.page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === listPath && url.searchParams.get('scope') === 'review'
        && url.searchParams.get('cycleId') === fixture.cycleId && response.request().method() === 'GET';
    }).catch(() => null);
    await login(reviewer, manifest, manifest.actors.leader, `/tasks?goalView=review&cycleId=${fixture.cycleId}`);
    const before = await unwrap(await initial);
    check(!before.items.some(item => item.id === fixture.taskId), 'goal_fixture_already_consumed');
    await reviewer.page.getByTestId('goal-plan-list').waitFor();
    result.stage = 'employee_login_and_detail';
    employee = await openSession(browser, manifest, viewport, `goal_employee_${viewport.name}`, report);
    const detailPath = `/api/v1/tasks/${fixture.taskId}`;
    const detailResponse = employee.page.waitForResponse(response => new URL(response.url()).pathname === detailPath && response.request().method() === 'GET').catch(() => null);
    await login(employee, manifest, fixture, `/tasks/${fixture.taskId}?stage=goal-confirmation`);
    check((await unwrap(await detailResponse)).status === 'indicator_confirming', 'goal_fixture_not_confirming');
    await employee.page.getByRole('button', { name: '\u786e\u8ba4\u6307\u6807', exact: true }).click();
    const dialog = employee.page.getByRole('dialog').filter({ hasText: '\u5458\u5de5\u786e\u8ba4\u540e\u4ecd\u9700\u5206\u7ba1\u9886\u5bfc\u5ba1\u6838' });
    await dialog.waitFor();
    result.preSubmitFocus = await focusState(reviewer.page);
    check(result.preSubmitFocus.visibility === 'visible', 'preopened_reviewer_not_visible_polling_unproven');
    result.stage = 'employee_ui_confirmation';
    const responsePromise = employee.page.waitForResponse(response => new URL(response.url()).pathname === detailPath + '/indicators/confirm'
      && response.request().method() === 'POST').catch(() => null);
    const clickAt = performance.now();
    await dialog.getByRole('button', { name: '\u786e\u8ba4\u6307\u6807', exact: true }).click();
    await unwrap(await responsePromise);
    const submittedAt = performance.now(); result.uiSubmitMs = elapsed(clickAt);
    result.stage = 'automatic_review_list';
    const measurements = await Promise.allSettled([
      observeAuto(reviewer, fixture, 'goal', listPath, submittedAt, clickAt).then(value => { result.frontend = value; }),
      (async () => {
        const backendStart = performance.now();
        const data = await readBackend(reviewer, manifest, `${listPath}?${query}`);
        const item = data.items.find(row => row.id === fixture.taskId);
        result.backend = { getMs: elapsed(backendStart), observedReadyAfterClickMs: elapsed(clickAt), observedReadyAfterSubmitMs: elapsed(submittedAt),
          actionable: item?.status === 'indicator_approving' && item?.permissions?.canApprove === true };
      })(),
    ]);
    for (const measurement of measurements) if (measurement.status === 'rejected') throw measurement.reason;
    check(result.backend.actionable, 'backend_goal_not_actionable');
    result.stage = 'dirty_filter_protection';
    result.inputProtection = await holdInput(reviewer, listPath, reviewer.page.getByRole('textbox', { name: '\u5458\u5de5\u59d3\u540d', exact: true }));
    result.stage = 'failed_refresh_retention';
    result.failureProtection = await retainOnFailure(reviewer, listPath, fixture, 'goal');
    result.stage = 'native_window_observation';
    result.focusVisibility = await nativeWindowProbe(reviewer, listPath);
    result.status = 'passed'; result.stage = 'done';
  } catch (error) { result.status = 'failed'; result.reason = reason(error); }
  finally { await closeSession(employee); await closeSession(reviewer); }
}

async function delayedGuard(session, endpoint, act, verify) {
  await waitQuiet(session, endpoint);
  const fault = { endpoint, delayMs: 2000, once: true, hits: 0 }; session.fault = fault;
  try {
    await until(() => fault.hits === 1, AUTO_WINDOW, 'no_poll_for_inflight_protection');
    await act();
    const count = readCount(session, endpoint), started = performance.now();
    await sleep(HOLD_WINDOW);
    const result = { inFlightReadDelayedMs: fault.delayMs, heldMs: elapsed(started),
      subsequentReadsWhileProtected: readCount(session, endpoint) - count, inputOrSelectionPreserved: await verify() };
    check(result.subsequentReadsWhileProtected === 0 && result.inputOrSelectionPreserved, 'protected_state_refreshed_or_lost');
    return result;
  } finally { session.fault = null; }
}
async function approvalCase(browser, manifest, viewport, report) {
  const result = { kind: 'approval', viewport: viewport.name, status: 'incomplete', stage: 'approver_login' };
  report.cases.push(result);
  const fixture = manifest.responsiveness.approvals[viewport.name];
  const endpoint = `/api/v1/cycles/${fixture.cycleId}/approval`;
  let approver, hr;
  try {
    approver = await openSession(browser, manifest, viewport, `result_leader_${viewport.name}`, report);
    const initial = approver.page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'GET').catch(() => null);
    await login(approver, manifest, manifest.actors.leader, `/approval?cycleId=${fixture.cycleId}`);
    check(!(await unwrap(await initial)).some(item => item.id === fixture.taskId), 'approval_fixture_already_consumed');
    await waitQuiet(approver, endpoint);
    result.stage = 'hr_calibration_ui';
    hr = await openSession(browser, manifest, viewport, `result_hr_${viewport.name}`, report);
    const calibrationPath = `/api/v1/cycles/${fixture.cycleId}/calibration`;
    const initialCalibration = hr.page.waitForResponse(response => new URL(response.url()).pathname === calibrationPath && response.request().method() === 'GET').catch(() => null);
    await login(hr, manifest, manifest.actors.hr, `/calibration?cycleId=${fixture.cycleId}`);
    const calibrationResponse = await initialCalibration;
    result.calibrationWorkbenchHttpStatus = calibrationResponse?.status() ?? null;
    const workbench = await unwrap(calibrationResponse);
    check(workbench.items.some(item => item.taskId === fixture.taskId && item.status === 'hr_calibration' && item.canCalibrate), 'real_calibration_fixture_or_access_blocked');
    await targetRow(hr, fixture, 'calibration').getByRole('button', { name: '\u786e\u8ba4\u6821\u51c6', exact: true }).click();
    const dialog = hr.page.getByRole('dialog', { name: '\u6821\u51c6\u786e\u8ba4', exact: true });
    await dialog.waitFor();
    result.preSubmitFocus = await focusState(approver.page);
    check(result.preSubmitFocus.visibility === 'visible', 'preopened_approver_not_visible_polling_unproven');
    const responsePromise = hr.page.waitForResponse(response => new URL(response.url()).pathname === calibrationPath + '/confirm' && response.request().method() === 'POST').catch(() => null);
    const clickAt = performance.now();
    await dialog.getByRole('button', { name: '\u786e\u8ba4', exact: true }).click();
    const confirmed = await responsePromise;
    result.calibrationHttpStatus = confirmed?.status() ?? null;
    check((await unwrap(confirmed)).updated === 1, 'calibration_did_not_create_one_approval');
    const submittedAt = performance.now(); result.uiSubmitMs = elapsed(clickAt);
    result.stage = 'automatic_approval_list';
    const measurements = await Promise.allSettled([
      observeAuto(approver, fixture, 'approval', endpoint, submittedAt, clickAt).then(value => { result.frontend = value; }),
      (async () => {
        const backendStart = performance.now();
        const list = await readBackend(approver, manifest, endpoint);
        const item = list.find(row => row.id === fixture.taskId);
        result.backend = { getMs: elapsed(backendStart), observedReadyAfterClickMs: elapsed(clickAt), observedReadyAfterSubmitMs: elapsed(submittedAt),
          actionable: item?.status === 'approval' && !item.approvedAt
            && item.approverId === manifest.actors.leader.id && item.employeeId !== manifest.actors.leader.id };
      })(),
    ]);
    for (const measurement of measurements) if (measurement.status === 'rejected') throw measurement.reason;
    check(result.backend.actionable, 'backend_result_not_actionable');
    result.stage = 'selection_protection';
    const row = () => targetRow(approver, fixture, 'approval');
    result.selectionProtection = await delayedGuard(approver, endpoint,
      () => row().locator('.el-checkbox').click(), () => row().getByRole('checkbox').isChecked());
    await row().locator('.el-checkbox').click();
    result.stage = 'reject_dialog_protection';
    const rejectDialog = approver.page.getByRole('dialog', { name: '\u9000\u56de\u7ee9\u6548\u6821\u51c6', exact: true });
    const draft = 'Synthetic reason retained; do not submit';
    result.rejectProtection = await delayedGuard(approver, endpoint, async () => {
      await row().getByRole('button', { name: '\u9000\u56de', exact: true }).click();
      await rejectDialog.getByRole('textbox', { name: '\u9000\u56de\u539f\u56e0', exact: true }).fill(draft);
    }, async () => await rejectDialog.isVisible() && await rejectDialog.getByRole('textbox', { name: '\u9000\u56de\u539f\u56e0', exact: true }).inputValue() === draft);
    await rejectDialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click();
    result.stage = 'dirty_filter_protection';
    result.inputProtection = await holdInput(approver, endpoint, approver.page.getByRole('textbox', { name: '\u5458\u5de5\u59d3\u540d\u6216\u5de5\u53f7', exact: true }));
    result.stage = 'failed_refresh_retention';
    result.failureProtection = await retainOnFailure(approver, endpoint, fixture, 'approval');
    result.stage = 'native_window_observation';
    result.focusVisibility = await nativeWindowProbe(approver, endpoint);
    result.status = 'passed'; result.stage = 'done';
  } catch (error) { result.status = 'failed'; result.reason = reason(error); }
  finally { await closeSession(hr); await closeSession(approver); }
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') { selfTest(); return; }
  check(argv.length === 4, 'usage_manifest_and_out_required');
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    check(['--manifest', '--out'].includes(argv[i]) && !args[argv[i]] && argv[i + 1], 'invalid_arguments');
    args[argv[i]] = argv[i + 1];
  }
  check(args['--manifest'] && args['--out'], 'usage_manifest_and_out_required');
  const manifestPath = fs.realpathSync(path.resolve(args['--manifest']));
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const out = path.resolve(args['--out']);
  check(contained(path.dirname(manifestPath), out), 'output_must_be_below_private_manifest_directory');
  const { assertRunId, assertOwned, docker } = await import('./isolation.mjs');
  assertRunId(manifest.runId);
  const proxyName = `hrm-cap-${manifest.runId.toLowerCase()}-proxy`;
  const proxy = JSON.parse(docker(['inspect', proxyName]))[0];
  assertOwned(proxy, manifest.runId); validateProxy(proxy, manifest.runId, manifest.baseURL);
  check(docker(['port', proxyName, '80/tcp']) === `127.0.0.1:${new URL(manifest.baseURL).port}`, 'proxy_live_port_mismatch');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  check(contained(path.dirname(manifestPath), fs.realpathSync(out)), 'output_symlink_escapes_private_directory');
  const reportPath = path.join(out, 'responsiveness-probe.json');
  fs.writeFileSync(reportPath, '{"status":"started"}\n', { flag: 'wx', mode: 0o600 });
  const report = { runId: manifest.runId, status: 'incomplete', at: new Date().toISOString(), cases: [], sessions: [],
    scope: { realBackend: true, proxyOwnershipVerified: true, maxConcurrentContexts: 2, singleUseFixtures: true,
      automaticDeadlineMs: AUTO_WINDOW, protectionWindowMs: HOLD_WINDOW, pollIntervalExpectedMs: 10000,
      manualRefreshes: 0, syntheticFocusEvents: false, faultInjection: 'get_delay_or_abort_only',
      artifacts: 'safe_statuses_and_timings_only', nativeFocusAcceptanceSeparate: true,
      resultFixtureStartsAtHrCalibration: true, gradingAndPublicationNotCovered: true } };
  let browser;
  try {
    delete process.env.DEBUG; delete process.env.DEBUG_FILE; delete process.env.NODE_DEBUG; process.env.PWDEBUG = '0';
    const { chromium } = require(path.resolve(__dirname, '../../web/node_modules/playwright'));
    report.scope.headed = process.env.CAPACITY_RESPONSIVENESS_HEADED === '1';
    browser = await chromium.launch({ headless: !report.scope.headed });
    for (const viewport of VIEWPORTS) {
      await goalCase(browser, manifest, viewport, report);
      await approvalCase(browser, manifest, viewport, report);
    }
    const safeSessions = report.sessions.every(item => !item.pageErrors && !item.blockedWrites && !item.routingErrors);
    report.status = report.cases.length === 4 && report.cases.every(item => item.status === 'passed') && safeSessions ? 'passed' : 'failed';
    report.nativeVisibilityProvenCases = report.cases.filter(item => item.focusVisibility?.status === 'observed').length;
  } catch (error) { report.status = 'failed'; report.reason = reason(error); }
  finally {
    await browser?.close().catch(() => { report.status = 'failed'; report.closeFailed = true; });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({ status: report.status, cases: report.cases.map(item => ({
    kind: item.kind, viewport: item.viewport, status: item.status, stage: item.stage, reason: item.reason,
    frontendReadyMs: item.frontend?.readyAfterClickMs, backendReadyMs: item.backend?.observedReadyAfterClickMs,
    nativeVisibility: item.focusVisibility?.status ?? 'unproven',
  })) }) + '\n');
  if (report.status !== 'passed') process.exitCode = 1;
}

function selfTest() {
  const runId = 'CAP_012345abcdef', prefix = '012345abcdef-';
  let id = 1;
  function fixture(kind, viewport) {
    const suffix = `${kind}-${viewport}`;
    return { id: '00000000-0000-0000-0000-000000000010', employeeNo: prefix + 'rsp-' + suffix,
      employeeName: 'Synthetic response-' + suffix, cycleName: runId + ' Response Test',
      taskId: `00000000-0000-0000-0000-${String(id++).padStart(12, '0')}`, cycleId: '00000000-0000-0000-0000-000000000020' };
  }
  const value = { runId, baseURL: 'http://127.0.0.1:49177',
    actors: Object.fromEntries(['manager', 'head', 'leader', 'hr'].map(role => [role, {
      id: '00000000-0000-0000-0000-000000000030', employeeNo: prefix + role, password: 'fictional-self-test-only' }])),
    handoff: { password: 'fictional-self-test-only' }, responsiveness: { schemaVersion: 1,
      handoffs: Object.fromEntries(['pc', 'mobile'].map(view => [view, fixture('goal', view)])),
      approvals: Object.fromEntries(['pc', 'mobile'].map(view => [view, fixture('result', view)])) } };
  assert.equal(validateManifest(value).baseURL, value.baseURL);
  for (const baseURL of ['http://127.0.0.1:5173', 'http://127.1:49177', 'http://localhost:49177',
    'https://127.0.0.1:49177', 'http://127.0.0.1:80', 'http://127.0.0.1:49177/path', 'http://127.0.0.1:49177/?token=fictional',
    'http://user:fictional@127.0.0.1:49177', 'http://127.0.0.1:65536']) assert.throws(() => validateManifest({ ...value, baseURL }));
  assert.throws(() => validateManifest({ ...value, runId: 'CAP_other' }));
  assert.throws(() => validateManifest({ ...value, responsiveness: null }));
  const reused = structuredClone(value);
  reused.responsiveness.handoffs.mobile.taskId = reused.responsiveness.handoffs.pc.taskId;
  assert.throws(() => validateManifest(reused));
  const foreign = structuredClone(value);
  foreign.responsiveness.approvals.pc.employeeNo = 'not-this-run';
  assert.throws(() => validateManifest(foreign));
  const proxy = { Name: '/hrm-cap-cap_012345abcdef-proxy', Config: { Labels: { 'hrm.capacity.run': runId } },
    State: { Running: true }, NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '49177' }] } } };
  validateProxy(proxy, runId, value.baseURL);
  assert.throws(() => validateProxy(proxy, runId, 'http://127.0.0.1:49178'));
  assert.throws(() => validateProxy({ ...proxy, Name: '/kayford-deploy-web' }, runId, value.baseURL));
  assert.throws(() => validateProxy({ ...proxy, State: { Running: false } }, runId, value.baseURL));
  assert.throws(() => validateProxy({ ...proxy, Config: { Labels: {} } }, runId, value.baseURL));
  assert.throws(() => validateProxy({ ...proxy, NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '49177' }] } } }, runId, value.baseURL));
  assert.equal(contained(path.resolve('private'), path.resolve('private/run')), true);
  assert.equal(contained(path.resolve('private'), path.resolve('private-other')), false);
  assert.equal(contained(path.resolve('private'), path.resolve('private')), false);
  assert.equal(requestAllowed(value.baseURL + '/api/v1/goal-plans', value.baseURL), true);
  assert.equal(requestAllowed('http://127.0.0.1:5173/api/v1/goal-plans', value.baseURL), false);
  process.stdout.write('{"status":"self_test_passed"}\n');
}

module.exports = { validateManifest, validateProxy, contained, main, selfTest };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ status: 'failed', reason: reason(error) }) + '\n'); process.exitCode = 1;
});
