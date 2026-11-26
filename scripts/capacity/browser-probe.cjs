#!/usr/bin/env node
'use strict';

// Usage: node scripts/capacity/browser-probe.cjs --manifest <private.json> --out <directory>
// Sequential cold-context samples: first participant + manager/head/leader/hr at both widths.
// Handoff consumes ONE dedicated indicator_confirming task, at desktop width only.
// No screenshots, trace, HAR, storageState, console messages, or raw errors are saved.
// --self-test needs no Playwright, server, credentials, or browser startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const TIMEOUT = 30000;
const PROBE_STARTED = performance.now();
const VIEWPORTS = [
  { name: 'pc', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const elapsed = start => Math.round(performance.now() - start);

class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function check(condition, code) { if (!condition) throw new ProbeError(code); }
function errorCode(error) {
  return error instanceof ProbeError ? error.code : error?.name === 'TimeoutError' ? 'timeout' : 'probe_error';
}

function validateManifest(value) {
  check(value && typeof value === 'object', 'invalid_manifest');
  check(typeof value.runId === 'string' && /^CAP_[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.runId), 'invalid_run_id');
  // Check spelling too: WHATWG URL normalizes aliases such as 127.1 into 127.0.0.1.
  check(typeof value.baseURL === 'string' && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{3,4}\/?$/.test(value.baseURL), 'unsafe_base_url');
  const url = new URL(value.baseURL);
  check(Number(url.port) >= 1024 && Number(url.port) <= 65535 && Number(url.port) !== 5173, 'unsafe_port');
  function account(item, taskRequired = false) {
    check(item && typeof item.employeeNo === 'string' && item.employeeNo.trim().length > 0
      && typeof item.password === 'string' && item.password.length > 0, 'invalid_account');
    if (taskRequired) check(typeof item.taskId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.taskId), 'invalid_task_id');
    return { employeeNo: item.employeeNo, password: item.password, ...(taskRequired ? { taskId: item.taskId } : {}) };
  }
  check(Array.isArray(value.participants) && value.participants.length > 0, 'missing_participants');
  const participants = value.participants.map(item => account(item, true));
  check(value.actors && typeof value.actors === 'object', 'missing_actors');
  const actors = Object.fromEntries(['manager', 'head', 'leader', 'hr'].map(role => [role, account(value.actors[role])]));
  return { runId: value.runId, baseURL: url.origin, participants, actors, handoff: account(value.handoff, true) };
}

function routeTemplate(raw) {
  let pathname;
  try { pathname = new URL(raw, 'http://127.0.0.1').pathname; } catch { return '/:unknown'; }
  const exact = new Set([
    '/login', '/change-password', '/dashboard', '/tasks',
    '/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/tasks',
    '/api/v1/cycles/mine',
    '/api/v1/tasks/mine', '/api/v1/tasks/team', '/api/v1/tasks/department-review',
    '/api/v1/goal-plans', '/api/v1/goal-plans/options',
  ]);
  if (exact.has(pathname)) return pathname;
  if (/^\/tasks\/[^/]+$/.test(pathname)) return '/tasks/:taskId';
  if (/^\/api\/v1\/tasks\/[^/]+\/indicators\/confirm$/.test(pathname)) return '/api/v1/tasks/:taskId/indicators/confirm';
  if (/^\/api\/v1\/tasks\/[^/]+$/.test(pathname)) return '/api/v1/tasks/:taskId';
  if (/^\/api\/v1\/goal-plans\/[^/]+$/.test(pathname)) return '/api/v1/goal-plans/:taskId';
  if (pathname.startsWith('/api/v1/')) return '/api/v1/:other';
  if (pathname.startsWith('/assets/')) return '/assets/:asset';
  return '/:other';
}

function requestAllowed(raw, origin) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (['data:', 'blob:'].includes(url.protocol)) return true;
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  return url.origin === origin && !url.username && !url.password;
}

async function unwrap(response) {
  const body = await response.json();
  check(body && body.code === 0 && body.data !== undefined, 'unexpected_response_envelope');
  return body.data;
}

function observe(page, origin, output) {
  const requests = new Map(), pending = new Set(), successes = new Set();
  const state = { phase: 'login', goalHeaders: null, detailStatus: null };
  function track(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
  }
  page.on('request', request => {
    const url = new URL(request.url());
    const item = {
      phase: state.phase, method: request.method(), route: routeTemplate(request.url()),
      atMs: elapsed(PROBE_STARTED), status: null, durationMs: null, outcome: 'pending',
    };
    if (output.requests.length < 1000) output.requests.push(item);
    else output.omittedRequests += 1;
    requests.set(request, { item, started: performance.now() });
    if (url.origin === origin && url.pathname === '/api/v1/goal-plans' && url.searchParams.get('scope') === 'review') {
      // Private, memory-only header from the real UI login. Never part of output.
      const authorization = request.headers().authorization;
      if (authorization) state.goalHeaders = { authorization };
    }
  });
  page.on('response', response => {
    const request = response.request(), entry = requests.get(request);
    if (entry) entry.item.status = response.status();
    const url = new URL(response.url());
    if (url.origin !== origin || request.method() !== 'GET' || !response.ok()) return;
    if (!/^\/api\/v1\/(tasks(?:\/[^/]+)?|goal-plans|cycles\/mine)$/.test(url.pathname)) return;
    track((async () => {
      try {
        const data = await unwrap(response);
        successes.add(url.pathname);
        if (url.pathname === '/api/v1/cycles/mine') state.noPersonalCycles = Array.isArray(data) && data.length === 0;
        if (url.pathname.startsWith('/api/v1/tasks/') && typeof data?.status === 'string') {
          state.detailStatus = ['indicator_confirming', 'indicator_approving', 'self_eval'].includes(data.status) ? data.status : 'other';
        }
      } catch { /* A 200 error envelope must not count as usable content. */ }
    })());
  });
  for (const [event, outcome] of [['requestfinished', 'finished'], ['requestfailed', 'request_failed']]) {
    page.on(event, request => {
      const entry = requests.get(request);
      if (entry) {
        entry.item.durationMs = elapsed(entry.started);
        entry.item.outcome = outcome;
        requests.delete(request);
      }
    });
  }
  page.on('pageerror', () => { output.pageErrors += 1; });
  page.on('dialog', dialog => {
    output.dismissedNativeDialogs += 1;
    void dialog.dismiss().catch(() => {});
  });
  return { state, successes, settle: () => Promise.allSettled([...pending]) };
}

async function openSession(browser, manifest, viewport, label, sessions) {
  const output = {
    label, viewport: { width: viewport.width, height: viewport.height },
    requests: [], omittedRequests: 0, pageErrors: 0, dismissedNativeDialogs: 0,
    blockedRequests: 0, blockedWrites: 0, blockedWebSockets: 0, routingErrors: 0,
  };
  sessions.push(output);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile',
    acceptDownloads: false, serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', async route => {
      try {
        const request = route.request();
        if (!requestAllowed(request.url(), manifest.baseURL)) {
          output.blockedRequests += 1;
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) output.blockedWrites += 1;
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      } catch { output.routingErrors += 1; }
    });
    await context.routeWebSocket('**/*', socket => {
      if (requestAllowed(socket.url(), manifest.baseURL)) socket.connectToServer();
      else { output.blockedWebSockets += 1; void socket.close().catch(() => {}); }
    });
    await context.addInitScript(() => {
      const events = { focus: 0, blur: 0, visible: 0, hidden: 0 };
      Object.defineProperty(window, '__capacityBrowserProbe', { value: events });
      window.addEventListener('focus', () => { events.focus += 1; });
      window.addEventListener('blur', () => { events.blur += 1; });
      document.addEventListener('visibilitychange', () => { events[document.hidden ? 'hidden' : 'visible'] += 1; });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);
    page.setDefaultNavigationTimeout(TIMEOUT);
    const observer = observe(page, manifest.baseURL, output);
    return { context, page, output, ...observer };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function tasksUsable(session) {
  const { page, successes } = session;
  const started = performance.now();
  while (elapsed(started) < TIMEOUT) {
    const team = new URL(page.url()).searchParams.get('scope') === 'team';
    const loaded = successes.has(team ? '/api/v1/tasks/team' : '/api/v1/tasks/mine')
      || (!team && session.state.noPersonalCycles === true && successes.has('/api/v1/cycles/mine'));
    if (loaded) {
      const ready = await page.locator('[data-testid="task-surface"], [data-testid="team-task-list"], [data-testid="team-task-workspace"]').evaluateAll(elements =>
        elements.some(element => element.getClientRects().length > 0
          && !element.querySelector('.el-loading-mask, .el-skeleton, .el-result__icon .icon-error')
          && (element.matches('[data-testid="task-surface"]')
            ? Boolean(element.querySelector('[data-testid="personal-task-card"], .empty-wrap')) : true)));
      const hasError = await page.locator('[data-testid="personal-task-error"]:visible, .el-alert--error:visible, .team-task-workspace__state.el-result:visible').count() > 0;
      if (ready && !hasError) return;
    }
    await sleep(100);
  }
  throw new ProbeError('tasks_content_not_usable');
}

async function login(session, manifest, account) {
  const { page, output } = session;
  const result = { status: 'incomplete', stage: 'open_login', route: '/login' };
  output.login = result;
  try {
    let started = performance.now();
    await page.goto(manifest.baseURL + '/login?redirect=%2Ftasks', { waitUntil: 'domcontentloaded' });
    result.loginDocumentMs = elapsed(started);
    result.stage = 'password_form';
    await page.getByTestId('login-shell').waitFor();
    if (await page.getByTestId('preview-login').isVisible()) throw new ProbeError('password_form_hidden_by_preview_build');
    const toggle = page.getByTestId('password-login-toggle');
    await toggle.waitFor();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.locator('#login-employee-no').fill(account.employeeNo);
    await page.locator('#login-password').fill(account.password);
    result.stage = 'login_post';
    started = performance.now();
    const navigationPromise = page.waitForURL(url => url.pathname !== '/login')
      .then(() => ({ durationMs: elapsed(started), route: routeTemplate(page.url()) })).catch(() => null);
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login'
      && response.request().method() === 'POST').catch(() => null);
    await page.getByTestId('login-submit').click();
    const response = await responsePromise;
    result.loginPostHeadersMs = elapsed(started);
    check(response, 'login_post_not_observed');
    result.loginHttpStatus = response.status();
    check(response.ok(), 'login_http_rejected');
    // The token-containing login response is never parsed or exported.
    await response.finished();
    const timing = response.request().timing();
    result.loginPostMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : elapsed(started);
    result.stage = 'navigate_tasks';
    const navigation = await navigationPromise;
    check(navigation, 'post_login_navigation_not_observed');
    result.route = navigation.route;
    result.navigationMs = navigation.durationMs;
    check(new URL(page.url()).pathname !== '/change-password', 'password_change_required');
    check(new URL(page.url()).pathname === '/tasks', 'unexpected_post_login_route');
    result.stage = 'tasks_content';
    await tasksUsable(session);
    result.contentUsableMs = elapsed(started);
    result.routeToContentMs = Math.max(0, result.contentUsableMs - result.navigationMs);
    result.status = 'observed';
    result.stage = 'done';
  } catch (error) {
    result.reason = errorCode(error);
    result.route = routeTemplate(page.url());
  }
  return result.status === 'observed';
}

async function hasInputDraft(page) {
  // Inspect only; do not clear drafts, acknowledge navigation guards, or submit saved input.
  return page.locator('textarea:visible, input:not([readonly]):not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):visible, [contenteditable="true"]:visible')
    .evaluateAll(elements => elements.some(element => String(element.value ?? element.textContent ?? '').trim().length > 0));
}

async function focusState(page) {
  return page.evaluate(() => ({
    visibility: document.visibilityState, focused: document.hasFocus(),
    events: { ...window.__capacityBrowserProbe },
  }));
}

async function targetVisibility(page, identity) {
  if (!identity) return { status: 'unknown', actionable: false };
  return page.getByTestId('goal-plan-list').locator('.el-table__row:visible, .goal-mobile:visible').evaluateAll((elements, target) => {
    const rows = elements.filter(element => {
      const text = (element.innerText || '').split('\n').map(line => line.trim());
      const cells = [...element.querySelectorAll('.cell')].map(cell => cell.textContent.trim());
      return element.matches('.goal-mobile')
        ? text.some(line => line.startsWith(target.employeeName + ' \u00b7 ')) && text.includes(target.cycleName)
        : cells.includes(target.employeeName) && cells.includes(target.cycleName);
    });
    if (rows.length > 1) return { status: 'ambiguous_row', actionable: false };
    if (!rows.length) return { status: 'absent', actionable: false };
    const button = [...rows[0].querySelectorAll('button')].find(item => item.textContent.trim() === '\u529e\u7406\u76ee\u6807');
    return {
      status: 'visible', actionable: Boolean(button && !button.disabled && button.getClientRects().length
        && rows[0].textContent.includes('\u5f85\u5206\u7ba1\u9886\u5bfc\u5ba1\u6838')),
    };
  }, identity);
}

async function observeWindow(session, identity, durationMs, phase, submittedAt) {
  session.state.phase = phase;
  const started = performance.now();
  let firstActionableMs = null, firstActionableInWindowMs = null, atEnd;
  do {
    atEnd = await targetVisibility(session.page, typeof identity === 'function' ? identity() : identity);
    if (atEnd.actionable && firstActionableMs === null) {
      firstActionableMs = elapsed(submittedAt);
      firstActionableInWindowMs = elapsed(started);
    }
    if (elapsed(started) < durationMs) await sleep(Math.min(200, durationMs - elapsed(started)));
  } while (elapsed(started) < durationMs);
  const reads = session.output.requests.filter(item => item.phase === phase && item.method === 'GET' && item.route === '/api/v1/goal-plans');
  return {
    startedAfterSubmitMs: Math.round(started - submittedAt), durationMs: elapsed(started),
    firstActionableAfterSubmitMs: firstActionableMs,
    firstActionableInWindowMs, atEnd,
    frontendListGetStarted: reads.length,
    frontendListGetFinished: reads.filter(item => item.outcome === 'finished').length,
    focus: await focusState(session.page),
  };
}

async function backendVisibility(session, manifest, handoff, result) {
  check(session.state.goalHeaders, 'leader_ui_authorization_not_observed');
  const started = performance.now();
  const url = new URL('/api/v1/goal-plans', manifest.baseURL);
  url.search = new URLSearchParams({ scope: 'review', employeeName: handoff.employeeNo, page: '1', pageSize: '100' }).toString();
  // APIRequestContext GET is separate from page traffic; it does not refresh the UI.
  const response = await session.context.request.get(url.href, {
    headers: session.state.goalHeaders, timeout: TIMEOUT, maxRedirects: 0,
  });
  try {
    result.backend = { method: 'GET', route: '/api/v1/goal-plans', status: response.status(), durationMs: elapsed(started), targetPresent: false, actionable: false };
    check(response.ok(), 'leader_backend_get_rejected');
    const data = await unwrap(response);
    check(Array.isArray(data.items), 'unexpected_goal_list_contract');
    const item = data.items.find(row => row.id === handoff.taskId);
    result.backend.targetPresent = Boolean(item);
    result.backend.actionable = Boolean(item?.status === 'indicator_approving' && item?.permissions?.canApprove);
    result.backend.completeFilteredPage = Number.isFinite(data.total) && data.total <= data.items.length;
    if (!item) return null;
    check(typeof item.employeeName === 'string' && item.employeeName.length > 0
      && typeof item.cycleName === 'string' && item.cycleName.length > 0, 'missing_goal_row_identity');
    return { employeeName: item.employeeName, cycleName: item.cycleName };
  } finally { await response.dispose(); }
}

async function handoffProbe(browser, manifest, report) {
  const result = { status: 'incomplete', stage: 'leader_login', viewport: 'pc', submission: 'not_attempted' };
  report.handoff = result;
  let leader, employee;
  try {
    leader = await openSession(browser, manifest, VIEWPORTS[0], 'handoff_leader', report.sessions);
    check(await login(leader, manifest, manifest.actors.leader), 'leader_login_incomplete');
    result.stage = 'preopen_leader_review';
    leader.state.phase = 'preopen_review';
    const initialRead = leader.page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/goal-plans' && url.searchParams.get('scope') === 'review' && response.request().method() === 'GET';
    }).catch(() => null);
    await leader.page.goto(manifest.baseURL + '/tasks?goalView=review', { waitUntil: 'domcontentloaded' });
    const initialResponse = await initialRead;
    check(initialResponse?.ok(), 'leader_review_list_not_loaded');
    const initialData = await unwrap(initialResponse);
    check(Array.isArray(initialData.items), 'unexpected_goal_list_contract');
    result.initialTargetPresent = initialData.items.some(item => item.id === manifest.handoff.taskId);
    await leader.page.getByTestId('goal-plan-list').waitFor();
    await leader.page.waitForFunction(() => document.querySelector('[data-testid="goal-plan-list"]')?.getAttribute('aria-busy') === 'false');
    result.leaderPreopened = true;
    result.leaderInitialFocus = await focusState(leader.page);

    result.stage = 'employee_login';
    employee = await openSession(browser, manifest, VIEWPORTS[0], 'handoff_employee', report.sessions);
    check(await login(employee, manifest, manifest.handoff), 'employee_login_incomplete');
    result.stage = 'employee_detail';
    employee.state.phase = 'employee_detail';
    const detailPath = `/api/v1/tasks/${manifest.handoff.taskId}`;
    const detailResponse = employee.page.waitForResponse(response => new URL(response.url()).pathname === detailPath && response.request().method() === 'GET').catch(() => null);
    await employee.page.goto(manifest.baseURL + `/tasks/${manifest.handoff.taskId}?stage=goal-confirmation`, { waitUntil: 'domcontentloaded' });
    const detail = await detailResponse;
    check(detail?.ok(), 'employee_detail_not_loaded');
    check((await unwrap(detail)).status === 'indicator_confirming', 'handoff_task_not_indicator_confirming');
    result.initialTaskStatus = 'indicator_confirming';
    check(!await hasInputDraft(employee.page), 'input_draft_preserved');
    const confirmLabel = '\u786e\u8ba4\u6307\u6807';
    await employee.page.getByRole('button', { name: confirmLabel, exact: true }).click();
    const dialog = employee.page.getByRole('dialog').filter({ hasText: '\u5458\u5de5\u786e\u8ba4\u540e\u4ecd\u9700\u5206\u7ba1\u9886\u5bfc\u5ba1\u6838' });
    await dialog.waitFor();
    check(!await hasInputDraft(employee.page), 'input_draft_preserved');
    result.stage = 'employee_confirm_ui';
    const confirmPath = detailPath + '/indicators/confirm';
    employee.state.phase = 'employee_confirm';
    leader.state.phase = 'employee_confirm_wait';
    await employee.page.bringToFront();
    result.leaderBackgroundFocus = await focusState(leader.page);
    const responsePromise = employee.page.waitForResponse(response => new URL(response.url()).pathname === confirmPath
      && response.request().method() === 'POST').catch(() => null);
    const started = performance.now();
    result.submission = 'attempted_once';
    await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
    const confirmed = await responsePromise;
    check(confirmed, 'employee_confirmation_request_not_observed');
    result.submissionHttpStatus = confirmed.status();
    check(confirmed.ok(), 'employee_confirmation_rejected');
    await unwrap(confirmed);
    const submittedAt = performance.now();
    result.submissionMs = elapsed(started);
    result.submittedAtMs = Math.round(submittedAt - PROBE_STARTED);
    result.submission = 'http_success_via_ui';
    // Start the 20-second DOM-only observation before the independent backend GET.
    result.stage = 'idle_observation';
    let identity = null;
    const observation = observeWindow(leader, () => identity, 20000, 'idle_20s', submittedAt);
    let backendError = null;
    try { identity = await backendVisibility(leader, manifest, manifest.handoff, result); }
    catch (error) { backendError = error; }
    result.idle20s = await observation;
    result.idle20s.observedAfterSubmitMs = elapsed(submittedAt);
    result.idle20s.within15s = result.idle20s.firstActionableAfterSubmitMs !== null
      && result.idle20s.firstActionableAfterSubmitMs <= 15000;
    if (backendError) throw backendError;

    result.stage = 'focus_observation';
    const beforeFocus = await focusState(leader.page);
    leader.state.phase = 'focus_3s';
    await leader.page.bringToFront();
    result.focus3s = await observeWindow(leader, identity, 3000, 'focus_3s', submittedAt);
    result.focus3s.nativeFocusEventObserved = result.focus3s.focus.events.focus > beforeFocus.events.focus;
    result.focus3s.nativeVisibleEventObserved = result.focus3s.focus.events.visible > beforeFocus.events.visible;
    result.focus3s.realBackgroundTransitionObserved = result.leaderBackgroundFocus.visibility === 'hidden'
      && result.focus3s.focus.visibility === 'visible';
    result.focus3s.syntheticEventsDispatched = false;

    result.stage = 'manual_refresh_comparison';
    check(!await hasInputDraft(leader.page), 'leader_input_draft_preserved_refresh_skipped');
    leader.state.phase = 'manual_refresh';
    const refreshed = leader.page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/goal-plans' && url.searchParams.get('scope') === 'review' && response.request().method() === 'GET';
    }).catch(() => null);
    const refreshStarted = performance.now();
    await leader.page.reload({ waitUntil: 'domcontentloaded' });
    const refreshResponse = await refreshed;
    check(refreshResponse?.ok(), 'manual_refresh_list_not_loaded');
    await unwrap(refreshResponse);
    await leader.page.getByTestId('goal-plan-list').waitFor();
    await leader.page.waitForFunction(() => document.querySelector('[data-testid="goal-plan-list"]')?.getAttribute('aria-busy') === 'false');
    result.manualRefresh = { durationMs: elapsed(refreshStarted), target: await targetVisibility(leader.page, identity) };
    result.route = routeTemplate(leader.page.url());
    result.status = 'observed';
    result.stage = 'done';
    result.conclusion = !result.backend.actionable ? 'backend_not_actionable'
      : result.idle20s.atEnd.actionable || result.focus3s.atEnd.actionable ? 'visible_before_manual_refresh'
        : result.manualRefresh.target.actionable ? 'manual_refresh_required' : 'not_visible_after_manual_refresh';
  } catch (error) { result.reason = errorCode(error); }
  finally {
    for (const session of [employee, leader]) {
      if (session) { await session.context.close(); await session.settle(); }
    }
  }
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') { selfTest(); return; }
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('Usage: node scripts/capacity/browser-probe.cjs --manifest <private.json> --out <directory>\nNo browser runs with --self-test. See file header for sampling and artifact policy.\n');
    return;
  }
  check(argv.length === 4 || argv.length === 6, 'expected_manifest_and_out');
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    check(['--manifest', '--out', '--role'].includes(argv[i]) && !args[argv[i]] && argv[i + 1], 'invalid_arguments');
    args[argv[i]] = argv[i + 1];
  }
  check(args['--manifest'] && args['--out'], 'expected_manifest_and_out');
  check(!args['--role'] || ['employee', 'manager', 'head', 'leader', 'hr'].includes(args['--role']), 'invalid_role');
  const manifestPath = path.resolve(args['--manifest']);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const out = path.resolve(args['--out']);
  const reportPath = path.join(out, 'browser-probe.json');
  check(reportPath !== manifestPath, 'output_would_overwrite_manifest');
  const report = {
    runId: manifest.runId, status: 'incomplete', sessions: [],
    scope: {
      firstParticipantOnly: true, participantCount: manifest.participants.length,
      roles: ['employee', 'manager', 'head', 'leader', 'hr'], maxConcurrentContexts: 2,
      handoffTaskIsSingleUse: true, handoffViewport: 'pc',
      headedOrUserBrowser: false, externalRequestsAllowed: false,
      sameOriginBusinessRequests: 'unmodified_passthrough', dataAndBlobAllowed: true,
      artifacts: 'timings_statuses_route_templates_only',
      screenshots: false, trace: false, har: false, storageState: false,
      coldContexts: true, routingDisablesHttpCache: true,
      isolationOwnershipRequiresMainRunnerVerification: true,
      focusLimitation: 'headless_bringToFront_is_observed_not_synthetic_or_OS_focus_acceptance',
    },
  };
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.writeFileSync(reportPath, JSON.stringify({ runId: manifest.runId, status: 'started' }) + '\n', { flag: 'wx', mode: 0o600 });
  let browser;
  try {
    // Debug logging can contain form arguments; disable it before importing Playwright.
    delete process.env.DEBUG;
    delete process.env.DEBUG_FILE;
    delete process.env.NODE_DEBUG;
    process.env.PWDEBUG = '0';
    const { chromium } = require(path.resolve(__dirname, '../../web/node_modules/playwright'));
    browser = await chromium.launch({ headless: true });
    const samples = [{ role: 'employee', account: manifest.participants[0] },
      ...Object.entries(manifest.actors).map(([role, account]) => ({ role, account }))]
      .filter(sample => !args['--role'] || sample.role === args['--role']);
    report.scope.roles = samples.map(sample => sample.role);
    for (const viewport of VIEWPORTS) {
      for (const sample of samples) {
        const session = await openSession(browser, manifest, viewport, `login_${sample.role}_${viewport.name}`, report.sessions);
        try { await login(session, manifest, sample.account); }
        finally { await session.context.close(); await session.settle(); }
      }
    }
    if (!args['--role']) await handoffProbe(browser, manifest, report);
    else report.scope.handoffSkipped = 'targeted-login-recheck';
    report.status = report.sessions.every(session => session.login?.status === 'observed') && (args['--role'] || report.handoff?.status === 'observed')
      ? 'observed' : 'incomplete';
  } catch (error) { report.reason = errorCode(error); }
  finally {
    if (browser) await browser.close().catch(() => { report.closeStatus = 'failed'; });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({
    status: report.status, loginSamples: report.sessions.filter(session => session.login).length,
    handoffStatus: report.handoff?.status ?? 'not_started', handoffConclusion: report.handoff?.conclusion ?? 'not_completed',
  }) + '\n');
  if (report.status !== 'observed') process.exitCode = 1;
}

function selfTest() {
  const account = { employeeNo: 'FICTIONAL', password: 'not-a-real-password' };
  const valid = {
    runId: 'CAP_self_test', baseURL: 'http://127.0.0.1:49177',
    participants: [{ ...account, taskId: 'fictional-task' }],
    actors: { manager: account, head: account, leader: account, hr: account },
    handoff: { ...account, taskId: 'fictional-handoff' },
  };
  assert.equal(validateManifest(valid).baseURL, valid.baseURL);
  for (const baseURL of [
    'https://example.com:49177', 'http://127.0.0.1:5173', 'http://127.0.0.1',
    'http://127.0.0.1:80', 'http://127.0.0.1:443', 'http://127.0.0.1:0',
    'http://127.0.0.2:49177', 'http://127.1:49177',
    'http://user:secret@127.0.0.1:49177', 'http://127.0.0.1:49177/path',
    'http://127.0.0.1:49177/?token=secret', 'http://127.0.0.1:49177/#secret',
  ]) assert.throws(() => validateManifest({ ...valid, baseURL }));
  assert.throws(() => validateManifest({ ...valid, runId: 'NOT_CAP' }));
  assert.throws(() => validateManifest({ ...valid, participants: [] }));
  assert.throws(() => validateManifest({ ...valid, handoff: { ...account, taskId: '../escape' } }));
  assert.throws(() => validateManifest({ ...valid, actors: { ...valid.actors, hr: {} } }));
  assert.equal(routeTemplate('/api/v1/tasks/private-id/indicators/confirm?password=secret'), '/api/v1/tasks/:taskId/indicators/confirm');
  assert.equal(routeTemplate('/tasks/private-id?employeeNo=secret'), '/tasks/:taskId');
  assert.equal(routeTemplate('/api/v1/unlisted/private-account'), '/api/v1/:other');
  const origin = valid.baseURL;
  assert.equal(requestAllowed(origin + '/api/v1/auth/login', origin), true);
  assert.equal(requestAllowed(origin + '/api/v1/tasks/fictional-handoff/indicators/confirm', origin), true);
  assert.equal(requestAllowed(origin + '/api/v1/any-business-write', origin), true);
  assert.equal(requestAllowed('data:image/png;base64,AA==', origin), true);
  assert.equal(requestAllowed('blob:' + origin + '/fictional', origin), true);
  assert.equal(requestAllowed('ws://127.0.0.1:49177/events', origin), true);
  assert.equal(requestAllowed('wss://example.com/events', origin), false);
  assert.equal(requestAllowed('https://example.com/api/v1/auth/login', origin), false);
  assert.equal(requestAllowed('http://127.0.0.1:49178/api/v1/tasks', origin), false);
  assert.equal(requestAllowed('http://user:secret@127.0.0.1:49177/api/v1/tasks', origin), false);
  assert.equal(requestAllowed(origin + '/api/v1/tasks', origin), true);
  process.stdout.write(JSON.stringify({ status: 'self_test_passed' }) + '\n');
}

module.exports = { validateManifest, routeTemplate, requestAllowed, selfTest, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ status: 'failed', reason: errorCode(error) }) + '\n');
  process.exitCode = 1;
});
