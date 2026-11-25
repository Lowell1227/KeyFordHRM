const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '../src');
function load(relative, dependencies = {}) {
  const filename = path.join(root, relative), loaded = new Module(filename, module); loaded.paths = module.paths;
  loaded.require = id => {
    if (id in dependencies) return dependencies[id];
    if (id.endsWith('.vue')) return {};
    if (id.startsWith('@/')) return load(id.slice(2) + '.ts', dependencies);
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), id + '.ts')), dependencies);
    return require(id);
  };
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('.vue')) { const { descriptor } = parse(source), script = compileScript(descriptor, { id: filename });
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, []); source = script.content; }
  loaded._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
  return loaded.exports;
}

test('resume intake entry is editor-only and does not widen talent or demand-review permissions', () => {
  const { routes } = load('router/routes.ts');
  const { canAccessRoute } = load('router/navigation.ts');
  const intake = routes.find(route => route.name === 'RecruitmentIntakes');
  assert.equal(intake?.path, '/recruitment/intakes');
  for (const hrCapabilities of [['recruitment_view'], ['talent_hiring_confirm'], ['recruitment_demand_review'], []]) {
    assert.equal(canAccessRoute(intake, { sysRole: 'employee', hrCapabilities }), false);
  }
  assert.equal(canAccessRoute(intake, { sysRole: 'employee', hrCapabilities: ['recruitment_edit'] }), true);
  assert.equal(canAccessRoute(intake, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }), true);
  assert.equal(canAccessRoute(intake, { sysRole: 'hr', isAssessorOnly: true }), false);
});

test('completed intake links use only returned candidate and application IDs', () => {
  const { intakeResultTarget } = load('views/recruitment/intake-presentation.ts');
  assert.deepEqual(intakeResultTarget({ candidateId: 'candidate-a', applicationId: 'application-b' }), { path: '/talents', query: { candidateId: 'candidate-a', applicationId: 'application-b' } });
  assert.deepEqual(intakeResultTarget({ candidateId: 'candidate-a', applicationId: null }), { path: '/talents', query: { candidateId: 'candidate-a' } });
  assert.equal(intakeResultTarget({ applicationId: 'untrusted' }), null);
});

test('resume suggestions never overwrite manual fields without selecting that exact field', () => {
  const { applyIntakeSuggestions } = load('views/recruitment/intake-presentation.ts');
  const draft = { name: 'Fictional manual name', phone: '', yearsOfExperience: 0 };
  const suggested = { name: 'Fictional parser name', phone: 'fictional-phone', yearsOfExperience: 3, userId: 'must-not-link' };
  assert.deepEqual(applyIntakeSuggestions(draft, suggested, ['phone', 'userId']), { ...draft, phone: 'fictional-phone' });
  assert.equal(draft.phone, '');
});

test('external posting links permit HTTPS only without credentials and never infer identity from a name', () => {
  const { safePostingUrl } = load('views/recruitment/intake-presentation.ts');
  assert.equal(safePostingUrl('https://jobs.example.test/fictional-job?id=1'), 'https://jobs.example.test/fictional-job?id=1');
  for (const value of ['javascript:alert(1)', 'http://jobs.example.test/job', 'https://u:p@jobs.example.test/job', 'not a link']) assert.equal(safePostingUrl(value), '');
});

test('intake and posting APIs keep revisions and explicit idempotency bodies, without fake mail ingestion', async () => {
  const calls = [], http = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, async (...args) => { calls.push({ method, args }); return {}; }]));
  const api = load('api/recruitment-intakes.api.ts', { './http': { __esModule: true, default: http } }).recruitmentIntakesApi;
  const body = { requestId: '11111111-1111-4111-8111-111111111111', expectedRevision: 3, mode: 'candidate_only', existingCandidateId: 'candidate-a' };
  await api.confirm('intake/a', body); assert.deepEqual(calls[0].args[1], body);
  assert.equal(calls[0].args[0], '/recruitment-intakes/intake%2Fa/confirm');
  await api.list({ state: 'awaiting_resume', page: 2, pageSize: 10, ownerId: 'owner-a', sourceChannel: 'job_site', keyword: 'Fictional job' });
  assert.equal(calls[1].args[1].params.ownerId, 'owner-a');
  assert.equal(Object.keys(api).some(key => /ingest|fixture|fake/i.test(key)), false);
  const postings = load('api/recruitment-postings.api.ts', { './http': { __esModule: true, default: http } }).recruitmentPostingsApi;
  await postings.update('posting/a', { expectedRevision: 4, demandId: 'demand-b', reason: 'Fictional reviewed remapping' });
  assert.equal(calls[2].args[0], '/recruitment-postings/posting%2Fa'); assert.equal(calls[2].args[1].expectedRevision, 4);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function intake(extra = {}) { return { id: 'intake-a', revision: 3, state: 'pending_review', transport: 'manual', sourceChannel: 'job_site', ownerId: 'editor-a', postingId: null, demandId: null, positionName: 'Fictional engineer', sourceNotes: 'Fictional permitted source', nextFollowUpAt: null, candidateDraft: { name: 'Fictional applicant', phone: '13800000000', sourceChannel: 'job_site' }, applicationDraft: { deptId: 'dept-a', positionName: 'Fictional engineer', ownerId: 'editor-a' }, parseStatus: 'idle', parseResult: null, parseMessage: null, issues: [], files: [], candidateId: null, applicationId: null, mail: null, associatedFromIds: [], ...extra }; }
function workflow(t, options = {}) {
  const calls = [], confirmations = [], canEdit = vue.ref(options.editable !== false), auth = vue.reactive({ user: { id: 'editor-a' } });
  const api = { detail: async () => intake(), create: async body => { calls.push(['create', body]); return intake(); }, update: async (id, body) => { calls.push(['update', id, body]); return intake({ revision: 4 }); },
    confirm: async (id, body) => { calls.push(['confirm', id, body]); return intake({ state: 'completed', candidateId: 'candidate-a', applicationId: body.mode === 'candidate_application' ? 'app-b' : null, revision: 4 }); },
    parse: async () => intake({ revision: 4, parseStatus: 'succeeded', parseResult: { fields: { name: 'Fictional suggested name' }, reviewItems: [], source: { fileName: 'fictional.pdf' } } }),
    close: async () => intake({ state: 'closed' }), associate: async () => intake(), upload: async () => intake(), ...options.api };
  const module = load('views/recruitment/useRecruitmentIntake.ts', {
    '@/api/recruitment-intakes.api': { recruitmentIntakesApi: api },
    '@/api/talent-pool.api': { talentPoolApi: { checkPhone: async () => options.phoneResult || { exists: false }, detail: async id => ({ id, name: 'Fictional existing profile', followUps: [] }) } },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: { applications: async () => options.existingApplications || [] } },
    '@/api/upload.api': { uploadApi: {} },
    '@/utils/image-compress': { isImageFile: file => /\.(png|jpe?g)$/i.test(file.name), compressImage: async file => file },
    '@/stores/auth.store': { useAuthStore: () => auth },
    '@/views/talent/useTalentPermissions': { useTalentPermissions: () => ({ canEdit }) },
    'element-plus': { ElMessageBox: { confirm: async (...args) => { confirmations.push(args); await options.onConfirmation?.(); return true; } } },
  });
  const scope = vue.effectScope(); const state = scope.run(() => module.useRecruitmentIntake()); t.after(() => scope.stop());
  return { state, calls, canEdit, auth, confirmations };
}

test('phone duplicates require explicit reuse and never send candidate overwrite fields', async t => {
  const f = workflow(t, { phoneResult: { exists: true, candidate: { id: 'existing-a', name: 'Fictional existing', statusLabel: '初步了解' } } });
  await f.state.open('intake-a'); await f.state.checkPhone();
  await f.state.confirm('candidate_only'); assert.equal(f.calls.length, 0);
  assert.match(f.state.error.value, /复用/); f.state.reuseExisting.value = true;
  await f.state.confirm('candidate_only');
  assert.equal(f.calls[0][2].existingCandidateId, 'existing-a'); assert.equal('candidate' in f.calls[0][2], false); assert.equal('application' in f.calls[0][2], false);
});

test('candidate-only and application modes are explicit and application requires department/job', async t => {
  const f = workflow(t); await f.state.open('intake-a'); await f.state.checkPhone(); await f.state.confirm('candidate_application');
  assert.equal(f.calls[0][2].mode, 'candidate_application'); assert.equal(f.calls[0][2].application.positionName, 'Fictional engineer');
  const g = workflow(t); await g.state.open('intake-a'); g.state.application.positionName = ''; await g.state.confirm('candidate_application'); assert.equal(g.calls.length, 0);
});

test('one explicit confirm saves a changed checked draft first and confirms with the returned revision', async t => {
  const f = workflow(t); await f.state.open('intake-a'); f.state.draft.value.name = 'Fictional corrected applicant';
  await f.state.confirm('candidate_only');
  assert.equal(f.calls[0][0], 'update'); assert.equal(f.calls[1][0], 'confirm'); assert.equal(f.calls[1][2].expectedRevision, 4);
  assert.equal(f.calls[1][2].candidate.name, 'Fictional corrected applicant');
});

for (const status of [409, 503]) test(`confirm never proceeds after the preceding draft save returns ${status}`, async t => {
  let confirms = 0; const f = workflow(t, { api: { update: async () => { throw { response: { status } }; }, confirm: async () => { confirms++; return intake(); } } });
  await f.state.open('intake-a'); f.state.draft.value.name = 'Keep the corrected applicant'; await f.state.confirm('candidate_only');
  assert.equal(confirms, 0); assert.equal(f.state.draft.value.name, 'Keep the corrected applicant');
});

test('lost confirmation result retries the exact body and request ID without changing mode', async t => {
  const requests = [], f = workflow(t, { api: { confirm: async (id, body) => { requests.push(structuredClone(body)); if (requests.length === 1) throw new Error('lost receipt'); return intake({ state: 'completed', candidateId: 'candidate-a' }); } } });
  await f.state.open('intake-a'); await f.state.checkPhone(); await f.state.confirm('candidate_only');
  assert.equal(f.state.unknown.value, true); await f.state.confirm('candidate_application');
  assert.equal(requests.length, 1); await f.state.confirm('candidate_only'); assert.deepEqual(requests[1], requests[0]);
});

test('explicit same-job existing application reuse sends its ID and reviewed job context', async t => {
  const f = workflow(t, { phoneResult: { exists: true, candidate: { id: 'existing-a', name: 'Fictional existing' } },
    existingApplications: [{ id: 'existing-app', candidateId: 'existing-a', positionName: 'Fictional engineer', deptId: 'dept-a' }] });
  await f.state.open('intake-a'); await f.state.checkPhone(); f.state.reuseExisting.value = true; await flush();
  f.state.existingApplicationId.value = 'existing-app'; await f.state.confirm('candidate_application');
  assert.equal(f.calls[0][2].existingApplicationId, 'existing-app'); assert.equal(f.calls[0][2].application.positionName, 'Fictional engineer');
  assert.equal(f.state.existingProfile.value.id, 'existing-a');
});

test('mail association switches the form to the original waiting context and clears old identity choices', async t => {
  const source = intake({ transport: 'email', positionName: null, demandId: null, sourceNotes: 'Fictional incoming mail' });
  const target = intake({ id: 'waiting-b', revision: 8, ownerId: 'original-owner', demandId: 'original-demand',
    positionName: 'Original intended job', sourceNotes: 'Original permitted source and follow-up', nextFollowUpAt: '2037-01-11T02:00:00.000Z',
    candidateDraft: { name: 'Original waiting applicant', phone: source.candidateDraft.phone, sourceChannel: 'job_site' },
    applicationDraft: { deptId: 'original-dept', positionName: 'Original intended job', ownerId: 'original-owner' }, associatedFromIds: [source.id] });
  const f = workflow(t, { phoneResult: { exists: true, candidate: { id: 'existing-a', name: 'Fictional existing' } }, api: {
    detail: async () => source,
    associate: async (id, body) => {
      assert.equal(id, source.id); assert.equal(body.expectedRevision, source.revision);
      assert.equal(body.targetIntakeId, target.id); assert.equal(body.expectedTargetRevision, 7); return target;
    },
  } });
  await f.state.open(source.id); await f.state.checkPhone(); f.state.reuseExisting.value = true; await flush();
  f.state.chosenSuggestions.value = ['name'];
  await f.state.associate({ ...target, revision: 7, state: 'awaiting_resume' });
  assert.equal(f.state.current.value.id, target.id); assert.equal(f.state.revision.value, 8);
  assert.equal(f.state.form.positionName, target.positionName); assert.equal(f.state.form.demandId, target.demandId);
  assert.equal(f.state.form.sourceNotes, target.sourceNotes); assert.equal(f.state.form.nextFollowUpAt, target.nextFollowUpAt);
  assert.equal(f.state.form.ownerId, target.ownerId); assert.equal(f.state.draft.value.name, target.candidateDraft.name);
  assert.equal(f.state.application.deptId, 'original-dept'); assert.equal(f.state.application.ownerId, target.ownerId);
  assert.equal(f.state.phone.value, null); assert.equal(f.state.reuseExisting.value, false);
  assert.equal(f.state.existingProfile.value, null); assert.deepEqual(f.state.chosenSuggestions.value, []);
  assert.equal(f.state.dirty.value, false);
});

test('409 preserves draft and revision until a separate explicit reconfirmation', async t => {
  let writes = 0;
  const f = workflow(t, { api: { update: async () => { writes++; throw { response: { status: 409 } }; } } });
  await f.state.open('intake-a'); f.state.draft.value.name = 'Fictional manual correction';
  await f.state.save(); await f.state.refresh(); await f.state.save();
  assert.equal(writes, 1); assert.equal(f.state.draft.value.name, 'Fictional manual correction'); assert.equal(f.state.revision.value, 3);
});

test('a successful explicit conflict review unlocks the retained draft with the freshly read revision', async t => {
  let reads = 0, writes = 0;
  const f = workflow(t, { api: {
    detail: async () => intake({ revision: reads++ ? 4 : 3 }),
    update: async (_id, body) => {
      if (++writes === 1) throw { response: { status: 409 } };
      assert.equal(body.expectedRevision, 4);
      assert.equal(body.candidateDraft.name, 'Retained local correction');
      return intake({ revision: 5 });
    },
  } });
  await f.state.open('intake-a'); f.state.draft.value.name = 'Retained local correction';
  await f.state.save(); assert.equal(f.state.blocked.value, true);
  await f.state.reconfirm();
  assert.equal(f.confirmations.length, 1); assert.equal(f.state.blocked.value, false);
  assert.equal(f.state.revision.value, 4); assert.equal(f.state.draft.value.name, 'Retained local correction');
  await f.state.save(); assert.equal(writes, 2);
});

test('another record change while the conflict confirmation is open still blocks the retained draft', async t => {
  let reads = 0;
  const f = workflow(t, { api: {
    detail: async () => intake({ revision: reads++ ? 4 : 3 }),
    update: async () => { throw { response: { status: 409 } }; },
  }, onConfirmation: async () => { f.state.current.value = intake({ revision: 5 }); } });
  await f.state.open('intake-a'); f.state.draft.value.name = 'Keep this local correction';
  await f.state.save(); await f.state.reconfirm();
  assert.equal(f.state.blocked.value, true); assert.equal(f.state.revision.value, 3);
  assert.equal(f.state.draft.value.name, 'Keep this local correction');
});

test('parse suggestions never replace manual content automatically and editors cannot be impersonated', async t => {
  const f = workflow(t); await f.state.open('intake-a'); await f.state.parse();
  assert.equal(f.state.draft.value.name, 'Fictional applicant'); assert.equal(f.state.current.value.parseStatus, 'succeeded');
  f.canEdit.value = false; await flush(); await f.state.save(); await f.state.confirm('candidate_only'); assert.equal(f.calls.length, 0); assert.equal(f.state.current.value, null);
});

for (const status of [403, 404]) test(`failed ${status} source refresh cannot authorize reconfirmation with the old object`, async t => {
  let reads = 0;
  const f = workflow(t, { api: { detail: async () => { if (reads++) throw { response: { status } }; return intake(); }, update: async () => { throw { response: { status: 409 } }; } } });
  await f.state.open('intake-a'); f.state.draft.value.name = 'Keep the manual draft'; await f.state.save(); await f.state.reconfirm();
  assert.equal(f.confirmations.length, 0); assert.equal(f.state.blocked.value, true); assert.equal(f.state.draft.value.name, 'Keep the manual draft');
});

test('optional candidate fields report existing DTO limits and retain zero experience/age', () => {
  const { validateIntakeDraft } = load('views/recruitment/intake-presentation.ts');
  const errors = validateIntakeDraft({ name: 'x'.repeat(51), email: 'bad-email', currentCompany: 'x'.repeat(151), yearsOfExperience: 1.5,
    birthMonth: 2, reportedAge: 151, note: 'x'.repeat(501), education: 'Unverified name' });
  for (const field of ['name', 'email', 'currentCompany', 'yearsOfExperience', 'birthMonth', 'reportedAge', 'note', 'education']) assert.ok(errors[field], field);
  assert.deepEqual(validateIntakeDraft({ yearsOfExperience: 0, reportedAge: 0 }), {});
});

test('salary parse suggestions use canonical yuan fields rather than legacy thousand-yuan DTO fields', () => {
  const { applyIntakeSuggestions } = load('views/recruitment/intake-presentation.ts');
  const value = applyIntakeSuggestions({}, { expectSalaryMin: 8, expectSalaryMax: 12 }, ['expectSalaryMin', 'expectSalaryMax']);
  assert.equal(value.expectSalaryMinYuan, 8000); assert.equal(value.expectSalaryMaxYuan, 12000); assert.equal('expectSalaryMin' in value, false);
});

test('education reference and label stay coherent across synchronous select events and later selections', async () => {
  const component = load('views/recruitment/components/RecruitmentIntakeDraftForm.vue').default;
  const props = vue.reactive({ modelValue: { education: 'Old education', educationReferenceDataId: 'old-id' } }), emitted = [];
  const scope = vue.effectScope(); const state = scope.run(() => component.setup(props, { expose() {}, emit: (_event, value) => emitted.push(value) }));
  state.update('educationReferenceDataId', 'education-a'); state.update('education', 'Fictional education A');
  assert.equal(emitted.at(-1).educationReferenceDataId, 'education-a'); assert.equal(emitted.at(-1).education, 'Fictional education A');
  props.modelValue = emitted.at(-1); await vue.nextTick();
  state.update('educationReferenceDataId', 'education-b'); state.update('education', 'Fictional education B');
  assert.equal(emitted.at(-1).educationReferenceDataId, 'education-b'); assert.equal(emitted.at(-1).education, 'Fictional education B'); scope.stop();
});

test('asynchronous parsing polls to completion, updates the revision and leaves manual input untouched', async t => {
  const timers = []; t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return 1; });
  let reads = 0;
  const f = workflow(t, { api: { detail: async () => reads++ ? intake({ revision: 5, parseStatus: 'succeeded', parseResult: { fields: { name: 'Suggested' }, reviewItems: [] } }) : intake(),
    parse: async () => intake({ revision: 4, parseStatus: 'processing' }) } });
  await f.state.open('intake-a'); await f.state.parse(); f.state.draft.value.name = 'Manual while parsing';
  assert.match(f.state.result.value, /解析已开始/);
  assert.equal(timers.length, 1); await timers[0]();
  assert.equal(f.state.current.value.parseStatus, 'succeeded'); assert.equal(f.state.revision.value, 5); assert.equal(f.state.draft.value.name, 'Manual while parsing');
  assert.match(f.state.result.value, /解析已完成/);
});

test('a concurrent source change during parse polling never silently rebases the editable draft', async t => {
  const timers = []; t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return 1; });
  let reads = 0;
  const f = workflow(t, { api: { detail: async () => reads++ ? intake({ revision: 6, sourceNotes: 'Changed by another editor', parseStatus: 'succeeded' }) : intake(),
    parse: async () => intake({ revision: 4, parseStatus: 'processing' }) } });
  await f.state.open('intake-a'); await f.state.parse(); await timers[0]();
  assert.equal(f.state.blocked.value, true); assert.equal(f.state.revision.value, 4); assert.equal(f.state.form.sourceNotes, 'Fictional permitted source');
});

test('own parse failure can retry successfully while preserving manual draft and an edited local state', async t => {
  const timers = []; t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return 1; });
  let server = intake(), parses = 0;
  const f = workflow(t, { api: { detail: async () => structuredClone(server), parse: async () => { parses++; server = { ...server, revision: server.revision + 1, parseStatus: 'processing' }; return structuredClone(server); } } });
  await f.state.open('intake-a'); await f.state.parse();
  server = { ...server, revision: 5, state: 'needs_material', parseStatus: 'failed', parseMessage: 'Retry or manually enter' };
  await timers.shift()();
  assert.equal(f.state.blocked.value, false); assert.equal(f.state.form.state, 'needs_material'); assert.equal(f.state.dirty.value, false);
  await f.state.parse(); assert.equal(parses, 2);
  f.state.draft.value.name = 'Keep manually checked name'; f.state.form.state = 'awaiting_resume';
  server = { ...server, revision: 7, state: 'pending_review', parseStatus: 'succeeded', parseResult: { fields: { major: 'Suggested major' }, reviewItems: [] } };
  await timers.shift()();
  assert.equal(f.state.blocked.value, false); assert.equal(f.state.revision.value, 7);
  assert.equal(f.state.form.state, 'awaiting_resume'); assert.equal(f.state.draft.value.name, 'Keep manually checked name');
  f.state.chosenSuggestions.value = ['major']; f.state.applySuggestions(); assert.equal(f.state.draft.value.major, 'Suggested major');
});

for (const extra of [{ revision: 6 }, { associatedToId: 'another-intake' }, { candidateId: 'another-candidate', state: 'completed' }, { ownerId: 'another-owner' }]) {
  test(`parse completion does not rebase concurrent or terminal changes ${Object.keys(extra).join('/')}`, async t => {
    const timers = []; t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return 1; });
    let reads = 0;
    const f = workflow(t, { api: { detail: async () => reads++ ? intake({ revision: 5, parseStatus: 'succeeded', state: 'pending_review', ...extra }) : intake(), parse: async () => intake({ revision: 4, parseStatus: 'processing' }) } });
    await f.state.open('intake-a'); await f.state.parse(); f.state.draft.value.name = 'Keep manual input'; await timers.shift()();
    assert.equal(f.state.blocked.value, true); assert.equal(f.state.revision.value, 4); assert.equal(f.state.draft.value.name, 'Keep manual input');
  });
}

test('posting identity requires an explicit verification decision with evidence, never a title match', () => {
  const { validatePosting } = load('views/recruitment/intake-presentation.ts');
  const input = { demandId: 'demand-a', ownerId: 'owner-a', channel: 'Fictional source', name: 'Same name as another job', url: 'https://jobs.example.test/one', verifiedIdentity: true, evidence: '' };
  assert.ok(validatePosting(input).evidence);
  assert.deepEqual(validatePosting({ ...input, verifiedIdentity: false }), {});
  assert.ok(validatePosting({ ...input, verifiedIdentity: false, url: 'javascript:alert(1)' }).url);
});

async function intakePage(t, demandDetail, postingDetail) {
  const route = vue.reactive({ query: {} }), auth = vue.reactive({ user: { id: 'editor-a', name: 'Fictional editor' } });
  const dependencies = {
    'vue-router': { useRoute: () => route, useRouter: () => ({ push() {} }) },
    '@/stores/auth.store': { useAuthStore: () => auth }, '@/views/talent/useTalentPermissions': { useTalentPermissions: () => ({ canEdit: vue.ref(true) }) },
    '@/views/talent/useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
    '@/api/recruitment-intakes.api': { recruitmentIntakesApi: { list: async () => ({ items: [], total: 0 }), mailStatus: async () => ({ configured: false }) } },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: { detail: demandDetail, directories: async () => ({ departments: [], positions: [] }), list: async () => ({ items: [] }) } },
    '@/api/recruitment-postings.api': { recruitmentPostingsApi: { detail: postingDetail, list: async () => ({ items: [] }) } },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: { owners: async () => ({ items: [] }) } },
    '@/api/talent-pool.api': { talentPoolApi: {} }, '@/api/upload.api': { uploadApi: {} },
    '@/utils/image-compress': { isImageFile: () => false, compressImage: async file => file },
    'element-plus': { ElMessageBox: { confirm: async () => true } },
  };
  const component = load('views/recruitment/RecruitmentIntakesView.vue', dependencies).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state; const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush(); state.review.start('pending_review'); return state;
}
test('late demand A and posting A resolution cannot replace a newer demand B selection', async t => {
  for (const viaPosting of [false, true]) {
    let resolveA;
    const a = new Promise(resolve => { resolveA = resolve; });
    const row = id => ({ id, sourceState: 'approved', usable: true, deptId: `dept-${id}`, positionName: `Fictional ${id}` });
    const state = await intakePage(t, id => id === 'A' ? a : Promise.resolve(row(id)), async () => ({ id: 'posting-a', active: true, verifiedIdentity: true, demandId: 'A', ownerId: 'owner-a' }));
    const first = viaPosting ? state.choosePosting('posting-a') : state.useDemand('A'); await flush();
    await state.useDemand('B'); resolveA(row('A')); await first;
    assert.equal(state.form.demandId, 'B'); assert.equal(state.application.positionName, 'Fictional B');
  }
});

test('intake and posting selectors constrain long dropdown labels to their input width', () => {
  for (const relative of ['views/recruitment/RecruitmentIntakesView.vue', 'views/recruitment/components/RecruitmentPostingsPanel.vue']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const selects = source.match(/<el-select(?=[\s>])[^>]*>/g) || [];
    assert.ok(selects.length);
    for (const select of selects) assert.match(select, /:fit-input-width="true"/, select.slice(0, 120));
  }
});

test('intake keyword filter describes only the supported job and source search', () => {
  const source = fs.readFileSync(path.join(root, 'views/recruitment/RecruitmentIntakesView.vue'), 'utf8');
  assert.match(source, /label="岗位 \/ 来源线索"/);
  assert.match(source, /aria-label="岗位或来源线索"/);
  assert.doesNotMatch(source, /aria-label="姓名或岗位"/);
});

test('source issue codes give a short business next step without leaking unknown codes', () => {
  const { intakeIssueLabel } = load('views/recruitment/intake-presentation.ts');
  const expected = {
    source_unverified: '请选择实际资料来源后再入库。', posting_unverified: '外部职位尚未核实，请核对职位及内部需求。',
    link_only: '只有链接，请补充简历文件或人工核对资料。', notification_only: '仅收到通知，请补充简历材料。',
    body_too_large: '正文过长，请补充简历文件或人工核对资料。', file_too_large: '附件过大，请重新上传10MB以内的简历。',
    unsupported_attachment: '附件无法读取，请补充PDF、Word或图片简历。', missing_material: '缺少简历材料，请补充文件或人工填写。',
  };
  for (const [code, text] of Object.entries(expected)) assert.equal(intakeIssueLabel(code), text);
  assert.equal(intakeIssueLabel('private_unknown_detail'), '来源资料待核对，请补充或人工确认。');
});

test('intake mapping history exposes only exact old/new demand links and source revisions', () => {
  const { intakeMappingHistory } = load('views/recruitment/intake-presentation.ts');
  const links = intakeMappingHistory({ metadata: { mapping: {
    before: { demandId: 'demand-old', postingRevision: 3, privateText: 'must-not-render' },
    after: { demandId: 'demand-new', postingRevision: 4, candidateDraft: { name: 'must-not-render' } },
  }, phone: 'must-not-render' } });
  assert.deepEqual(links, [
    { label: '旧需求', reference: 'demand-old', target: { path: '/recruitment/demands', query: { demandId: 'demand-old' } }, postingRevision: 3 },
    { label: '新需求', reference: 'demand-new', target: { path: '/recruitment/demands', query: { demandId: 'demand-new' } }, postingRevision: 4 },
  ]);
  assert.doesNotMatch(JSON.stringify(links), /must-not-render|candidateDraft|privateText|phone/);
  assert.deepEqual(intakeMappingHistory({ metadata: { state: 'pending_review' } }), []);
});

test('posting snapshot history compares consecutive source versions and preserves exact demand IDs', () => {
  const { intakeMappingHistory, intakeEventLabel } = load('views/recruitment/intake-presentation.ts');
  const previous = { snapshot: { demandId: '11111111-1111-4111-8111-111111111111', name: 'Not public' } };
  const current = { snapshot: { demandId: '22222222-2222-4222-8222-222222222222', url: 'Not public' } };
  const links = intakeMappingHistory(current, previous);
  assert.equal(links[0].label, '旧需求'); assert.equal(links[0].target.query.demandId, previous.snapshot.demandId);
  assert.equal(links[1].reference, '22222222'); assert.equal(links[1].target.query.demandId, current.snapshot.demandId);
  assert.equal(intakeEventLabel('remap_posting'), '更换职位归属');
  assert.equal(intakeMappingHistory({ snapshot: { demandId: null } })[1].target, null);
});

test('a mapping demand deep link reads that exact detail only after demand access is available', async t => {
  const route = vue.reactive({ query: { demandId: 'demand-old' } }), allowed = vue.ref(false), reads = [];
  const component = load('views/recruitment/RecruitmentDemandsView.vue', {
    'vue-router': { useRoute: () => route, useRouter: () => ({ push() {} }) },
    'element-plus': { ElMessageBox: { confirm: async () => true } },
    '@/stores/auth.store': { useAuthStore: () => vue.reactive({ user: { id: 'editor-a' } }) },
    '../talent/useRecruitmentLeaveGuard': { useRecruitmentLeaveGuard: () => ({ prepareToLeave: async () => true }) },
    '../talent/useTalentPermissions': { useTalentPermissions: () => ({ canRead: vue.ref(false), canReadDemand: allowed, canEdit: vue.ref(false) }) },
    '@/api/recruitment-demands.api': { recruitmentDemandsApi: { list: async () => ({ items: [], total: 0 }), status: async () => ({ configured: false }),
      detail: async id => { reads.push(id); return { id }; } } },
  }).default;
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state; const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount()); await flush(); assert.deepEqual(reads, []);
  allowed.value = true; await flush(); assert.deepEqual(reads, ['demand-old']); assert.equal(state.current.value.id, 'demand-old');
  route.query.demandId = 'demand-new'; await flush(); assert.equal(state.current.value.id, 'demand-new'); assert.equal(state.drawerOpen.value, true);
});
