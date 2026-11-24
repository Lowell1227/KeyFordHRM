const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');

const flush = () => new Promise(resolve => setImmediate(resolve));
const task = (extra = {}) => ({ id: 'task-1', context: 'new', status: 'succeeded', stage: 'extracting', fileName: 'fictional.pdf',
  createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 150000).toISOString(),
  expiresAt: new Date(Date.now() + 1800000).toISOString(), result: { fields: {}, reviewItems: [] }, ...extra });

function form(t, { api = {}, resumeApi = {}, parseResume = async () => ({ fields: {}, reviewItems: [] }), bind = async () => true,
  prepareFile = async file => file, candidateId = null } = {}) {
  const filename = path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue');
  const source = compileScript(parse(fs.readFileSync(filename, 'utf8')).descriptor, { id: 'resume-form' }).content;
  const loaded = new Module(filename, module);
  const events = [];
  const salaryFilename = path.resolve(__dirname, '../src/utils/talent-salary.ts');
  const salaryModule = new Module(salaryFilename, module);
  salaryModule._compile(ts.transpileModule(fs.readFileSync(salaryFilename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, salaryFilename);
  const dependencies = {
    vue,
    'element-plus': { ElMessage: { success() {}, warning() {}, error() {} }, ElMessageBox: { confirm: async () => true } },
    '@/api/talent-pool.api': { talentPoolApi: { checkPhone: async () => ({ exists: false }), ...api } },
    '@/api/talent-resume.api': { talentResumeApi: {
      status: async () => ({ enabled: true, configured: true }), current: async () => null, parse: parseResume,
      start: async (file, context) => task({ context, fileName: file.name, result: await parseResume(file) }),
      file: async () => new Blob(['validated resume'], { type: 'application/octet-stream' }),
      clear: async () => {}, ...resumeApi,
    } },
    '@/api/talent-recruitment.api': { talentRecruitmentApi: { owners: async () => ({ items: [] }) } },
    '@/stores/auth.store': { useAuthStore: () => ({ user: { id: 'hr' } }) },
    '@/types/talent.types': { TALENT_STATUSES: ['new', 'hired'], TALENT_PHONE_EXISTS: 'TALENT_PHONE_EXISTS' },
    '../useTalentPermissions': { useTalentPermissions: () => ({ canEdit: vue.computed(() => true) }) },
    '@/utils/image-compress': { isImageFile: file => file.type.startsWith('image/') },
    '@/utils/talent-salary': salaryModule.exports,
    './talent-file-upload': {
      TALENT_MAX_FILES: 3, TALENT_FILE_EXTENSIONS: ['pdf', 'jpg', 'png'], TALENT_MAX_FILE_BYTES: 10 * 1024 * 1024,
      talentFileExtension: name => name.split('.').pop().toLowerCase(),
      prepareTalentFile: async (file, state) => state.file ?? (state.file = await prepareFile(file)),
      uploadAndBindTalentFile: async (id, file, state, current) => {
        const success = await bind(id, file, state, current);
        if (success) state.bound ??= { id: `bound-${file.name}`, candidateId: id, fileName: file.name };
        return success;
      },
    },
  };
  const taskFilename = path.resolve(__dirname, '../src/views/talent/components/useResumeTask.ts');
  if (fs.existsSync(taskFilename)) {
    const taskModule = new Module(taskFilename, module);
    taskModule.require = id => dependencies[id] ?? require(id);
    taskModule._compile(ts.transpileModule(fs.readFileSync(taskFilename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, taskFilename);
    dependencies['./useResumeTask'] = taskModule.exports;
  }
  loaded.require = id => id in dependencies ? dependencies[id] : id.startsWith('@/') || id.endsWith('.vue') ? {} : require(id);
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const props = vue.reactive({ modelValue: true, candidateId });
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
  let state;
  const app = renderer.createApp({ setup() { state = loaded.exports.default.setup(props, { emit: (...args) => events.push(args), expose() {} }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  state.formRef.value = { validate: async () => true, clearValidate() {} };
  return { state, props, events };
}
test('retry after partial upload keeps one candidate and uploads only remaining files', async t => {
  let creates = 0, updates = 0; const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')], uploads = [];
  let failed = false;
  const { state } = form(t, { api: {
    create: async () => { creates++; return { id: 'persisted', editVersion: 'v1' }; },
    update: async id => { assert.equal(id, 'persisted'); updates++; return { editVersion: 'v2' }; },
  }, bind: async (id, file) => { assert.equal(id, 'persisted'); uploads.push(file.name); if (file.name === 'b.pdf' && !failed) { failed = true; throw Error('synthetic failure'); } return true; } });
  state.pendingFiles.value = files;
  await flush();
  await state.submit();
  assert.equal(state.persistedCandidateId.value, 'persisted');
  assert.deepEqual(state.pendingFiles.value.map(f => f.name), ['b.pdf']);
  await state.submit();
  assert.equal(creates, 1); assert.equal(updates, 1);
  assert.deepEqual(uploads, ['a.pdf', 'b.pdf', 'b.pdf']);
});
test('parse fills blanks and requires selection to replace existing values', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { name: 'Parsed', school: 'Fictional University', expectSalaryMin: 12 }, reviewItems: [] }) });
  state.form.name = 'Human input';
  await state.parseResume(new File(['x'], 'fictional.pdf'));
  assert.equal(state.form.name, 'Human input'); assert.equal(state.form.school, 'Fictional University');
  assert.equal(state.form.expectSalaryMin, 12000);
  assert.equal(state.parseConflicts.value.length, 1);
  state.parseConflicts.value[0].selected = true;
  state.applySelectedParsedFields(); assert.equal(state.form.name, 'Parsed');
});

test('explicit personal fields fill blanks, save their precision and reload without calculating age', async t => {
  let saved;
  const parsed = { gender: 'female', birthYear: 1998, birthMonth: 5, reportedAge: 27 };
  const { state } = form(t, { parseResume: async () => ({ fields: parsed, reviewItems: [] }),
    api: { create: async body => { saved = body; return { id: 'saved', editVersion: 'v1' }; } } });
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  for (const [key, value] of Object.entries(parsed)) assert.equal(state.form[key], value);
  await state.submit();
  for (const [key, value] of Object.entries(parsed)) assert.equal(saved[key], value);
  assert.equal('reportedAgeRecordedAt' in saved, false);
  const reopened = form(t, { candidateId: 'saved', api: { detail: async () => ({ ...detail('saved'), ...parsed,
    reportedAgeRecordedAt: '2026-11-24T02:00:00Z' }) } });
  await flush();
  for (const [key, value] of Object.entries(parsed)) assert.equal(reopened.state.form[key], value);
});

test('age-only parsing never populates birth year or month and manual fields can be cleared', async t => {
  let saved;
  const { state } = form(t, { parseResume: async () => ({ fields: { reportedAge: 28 }, reviewItems: [] }),
    api: { create: async body => { saved = body; return { id: 'saved', editVersion: 'v1' }; } } });
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  assert.equal(state.form.reportedAge, 28);
  assert.equal(state.form.birthYear, undefined); assert.equal(state.form.birthMonth, undefined);
  state.form.reportedAge = undefined;
  await state.submit();
  assert.equal(saved.reportedAge, null); assert.equal(saved.birthMonth, null);
});

test('parsed birth month cannot be silently paired with a conflicting existing birth year', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { birthYear: 1998, birthMonth: 5 }, reviewItems: [] }) });
  state.form.birthYear = 1997;
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  assert.equal(state.form.birthYear, 1997); assert.equal(state.form.birthMonth, undefined);
  const month = state.parseConflicts.value.find(item => item.field === 'birthMonth');
  month.selected = true; state.applySelectedParsedFields();
  assert.equal(state.form.birthMonth, undefined);
  for (const item of state.parseConflicts.value) item.selected = true;
  state.applySelectedParsedFields();
  assert.equal(state.form.birthYear, 1998); assert.equal(state.form.birthMonth, 5);
});

test('year-only replacement clears an old month instead of inventing new date precision', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { birthYear: 1998 }, reviewItems: [] }) });
  state.form.birthYear = 1997; state.form.birthMonth = 6;
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  state.parseConflicts.value[0].selected = true; state.applySelectedParsedFields();
  assert.equal(state.form.birthYear, 1998); assert.equal(state.form.birthMonth, undefined);
});

test('newer manual birth month invalidates the whole pending parsed birth pair', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { birthYear: 1998, birthMonth: 5 }, reviewItems: [] }) });
  state.form.birthYear = 1997; state.form.birthMonth = 6;
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  for (const item of state.parseConflicts.value) item.selected = true;
  state.form.birthMonth = 7; state.applySelectedParsedFields();
  assert.equal(state.form.birthYear, 1997); assert.equal(state.form.birthMonth, 7);
});

test('existing explicit gender and age require selection and keep newer manual input', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { gender: 'female', reportedAge: 28 }, reviewItems: [] }) });
  state.form.gender = 'male'; state.form.reportedAge = 27;
  await state.parseResume(new File(['synthetic'], 'fictional.pdf'));
  assert.equal(state.form.gender, 'male'); assert.equal(state.form.reportedAge, 27);
  for (const item of state.parseConflicts.value) item.selected = true;
  state.form.reportedAge = 29; state.applySelectedParsedFields();
  assert.equal(state.form.gender, 'female'); assert.equal(state.form.reportedAge, 29);
});

test('unpaired or invalid personal fields block saving at their field', async t => {
  let writes = 0;
  const { state } = form(t, { api: { create: async () => { writes++; return { id: 'saved', editVersion: 'v1' }; } } });
  await flush(); state.form.birthMonth = 5; await state.submit();
  assert.equal(writes, 0); assert.match(state.birthError.value, /年份/);
  state.form.birthYear = 1998; state.form.reportedAge = 28.5; await state.submit();
  assert.equal(writes, 0); assert.match(state.reportedAgeError.value, /整数/);
});

test('server personal field errors appear beside their inputs without losing human data', async t => {
  const { state } = form(t, { api: { create: async () => {
    throw { response: { status: 400, data: { message: '请核对出生年月和注明年龄', data: {
      fieldErrors: { birthMonth: '出生月份与年份不匹配', reportedAge: '注明年龄待核对' },
    } } } };
  } } });
  await flush(); state.form.birthYear = 1998; state.form.birthMonth = 5; state.form.reportedAge = 28;
  await state.submit();
  assert.equal(state.birthError.value, '出生月份与年份不匹配');
  assert.equal(state.reportedAgeError.value, '注明年龄待核对');
  assert.equal(state.form.birthMonth, 5); assert.equal(state.form.reportedAge, 28);
});
test('late parsing cannot fill a closed or replaced form', async t => {
  let resolve, started;
  const parsingStarted = new Promise(r => { started = r; });
  const { state, props } = form(t, { parseResume: () => new Promise(r => { resolve = r; started(); }) });
  const pending = state.parseResume(new File(['x'], 'fictional.pdf'));
  await parsingStarted;
  props.modelValue = false;
  resolve({ fields: { name: 'Wrong session' }, reviewItems: [] }); await pending;
  assert.equal(state.form.name, '');
});

const detail = (id = 'persisted', files = []) => ({ id, editVersion: 'latest', name: 'Saved candidate', phone: '17000000000',
  gender: 'unknown', sourceChannel: 'referral', tags: [], status: 'new', createdById: 'hr', files });

test('negotiable salary is a parse conflict until HR explicitly selects replacement', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { expectSalaryMin: 12, expectSalaryMax: 18 }, reviewItems: [] }) });
  state.form.salaryNegotiable = true; await vue.nextTick();
  await state.parseResume(new File(['x'], 'salary.pdf'));
  assert.equal(state.form.salaryNegotiable, true);
  assert.equal(state.form.expectSalaryMin, undefined);
  assert.equal(state.form.expectSalaryMax, undefined);
  assert.deepEqual(state.parseConflicts.value.map(item => item.field), ['expectSalaryMin', 'expectSalaryMax']);
  state.parseConflicts.value[0].selected = true;
  state.applySelectedParsedFields();
  assert.equal(state.form.salaryNegotiable, false);
  assert.equal(state.form.expectSalaryMin, 12000);
  assert.equal(state.form.expectSalaryMax, undefined);
});

test('reloading the same salary values establishes a new baseline before an unrelated edit', async t => {
  const writes = [];
  let reads = 0;
  const { state } = form(t, { candidateId: 'persisted', api: {
    detail: async () => ({ ...detail(), expectSalaryMin: ++reads === 1 ? 5 : 6, expectSalaryMax: 8 }),
    update: async (_id, body) => {
      writes.push(body);
      if (writes.length === 1) throw { response: { status: 409, data: { message: '资料已更新', data: { reason: 'TALENT_EDIT_CONFLICT' } } } };
      return { ...detail(), editVersion: 'saved' };
    },
  } });
  await flush();
  state.form.expectSalaryMin = 6000;
  await state.submit();
  assert.equal(state.editConflict.value, true);
  await state.reloadAfterConflict();
  state.form.note = '虚构修改备注';
  await state.submit();
  assert.equal(writes.length, 2);
  assert.equal(writes[0].expectSalaryMinYuan, 6000);
  assert.equal(writes[1].note, '虚构修改备注');
  assert.equal('expectSalaryMinYuan' in writes[1], false);
  assert.equal('expectSalaryMaxYuan' in writes[1], false);
});

test('busy form ignores file selection, removal and parsing even through native input events', async t => {
  let parses = 0;
  const { state } = form(t, { parseResume: async () => { parses++; return { fields: {}, reviewItems: [] }; } });
  const original = new File(['old'], 'old.pdf'), added = new File(['new'], 'new.pdf');
  state.pendingFiles.value = [original];
  for (const flag of ['saving', 'pendingUploading']) {
    state[flag].value = true;
    state.onPendingPick({ target: { files: [added], value: 'native-selection' } });
    state.removePending(original);
    await state.parseResume(added);
    assert.deepEqual(state.pendingFiles.value, [original]);
    state[flag].value = false;
  }
  assert.equal(parses, 0);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue'), 'utf8');
  for (const id of ['talent-form-file-input', 'talent-form-camera-input']) {
    assert.match(source, new RegExp(`<input[^>]*id="${id}"[^>]*:disabled="fileBusy"`));
  }
});

test('409 reload after partial create keeps persisted identity and remaining upload state', async t => {
  let creates = 0, updates = 0, failUpload = true;
  const first = new File(['a'], 'first.pdf'), second = new File(['b'], 'second.pdf');
  const { state, events } = form(t, { api: {
    create: async () => { creates++; return { id: 'persisted', editVersion: 'v1' }; },
    update: async (id, body) => {
      assert.equal(id, 'persisted'); updates++;
      if (updates === 1) throw { response: { data: { data: { reason: 'TALENT_EDIT_CONFLICT' } } } };
      assert.equal(body.editVersion, 'latest'); return { editVersion: 'v3' };
    },
    detail: async id => { assert.equal(id, 'persisted'); return detail(id, [{ id: 'bound-first.pdf', candidateId: id, fileName: first.name }]); },
  }, bind: async (_id, file, state) => {
    if (file === second && failUpload) { failUpload = false; state.uploaded = { url: 'cached-object' }; throw Error('bind failed'); }
    return true;
  } });
  state.pendingFiles.value = [first, second];
  await flush();
  await state.submit();
  const cached = state.fileUploadStates.get(second);
  const partialEvents = events.filter(event => event[0] === 'saved').length;
  await state.submit(); assert.equal(state.editConflict.value, true);
  assert.doesNotMatch(state.saveError.value, /资料已保存|附件未全部上传/);
  assert.equal(events.filter(event => event[0] === 'saved').length, partialEvents);
  await state.reloadAfterConflict();
  assert.equal(state.persistedCandidateId.value, 'persisted');
  assert.equal(state.isEdit.value, true);
  assert.equal(state.loadedEditVersion.value, 'latest');
  assert.deepEqual(state.pendingFiles.value, [second]);
  assert.equal(state.fileUploadStates.get(second), cached);
  assert.equal(state.editFiles.value.length, 1);
  assert.equal(state.form.name, 'Saved candidate');
  await state.submit(); assert.equal(creates, 1); assert.equal(updates, 2);
});

test('file budget includes successfully bound files after a partial failure', async t => {
  const files = ['a.pdf', 'b.pdf', 'c.pdf'].map(name => new File(['x'], name));
  const { state } = form(t, { api: { create: async () => ({ id: 'persisted', editVersion: 'v1' }) },
    bind: async (_id, file) => { if (file === files[1]) throw Error('synthetic bind failure'); return true; } });
  state.pendingFiles.value = files;
  await flush();
  await state.submit();
  assert.equal(state.editFiles.value.length, 1);
  assert.equal(state.pendingFiles.value.length, 2);
  state.onPendingPick({ target: { files: [new File(['fourth'], 'fourth.pdf')], value: '' } });
  assert.deepEqual(state.pendingFiles.value.map(file => file.name), ['b.pdf', 'c.pdf']);
});

test('edit uploads use the same pending queue without the old editable uploader', async t => {
  let binds = 0;
  const { state } = form(t, { candidateId: 'existing', api: {
    detail: async () => detail('existing'), update: async id => { assert.equal(id, 'existing'); return { editVersion: 'updated' }; },
  }, bind: async id => { assert.equal(id, 'existing'); binds++; return true; } });
  await vue.nextTick();
  state.resumeEnabled.value = false;
  state.onPendingPick({ target: { files: [new File(['edit'], 'edit.pdf')], value: '' } });
  assert.equal(binds, 0); assert.equal(state.pendingFiles.value.length, 1);
  await state.submit(); assert.equal(binds, 1);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue'), 'utf8');
  assert.doesNotMatch(source, /<TalentFileList[^>]*\seditable(?:\s|>|\/)/);
  assert.doesNotMatch(source, /<TalentFileList[^>]*:editable="(?:true|canEdit)"/);
});

test('compressible large photo uses the prepared file for parsing and later upload state', async t => {
  const photo = new File([new Uint8Array(11 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
  const compressed = new File(['small'], 'photo.jpg', { type: 'image/jpeg' });
  let preparations = 0, parses = 0;
  const { state } = form(t, { prepareFile: async file => { assert.equal(file, photo); preparations++; return compressed; },
    parseResume: async file => { assert.equal(file, compressed); parses++; return { fields: {}, reviewItems: [] }; },
    api: { create: async () => ({ id: 'persisted', editVersion: 'v1' }) },
    bind: async (_id, file, state) => { assert.equal(file, photo); assert.equal(state.file, compressed); return true; },
  });
  state.pendingFiles.value = [photo];
  await state.parseResume(photo); await state.submit();
  assert.equal(preparations, 1); assert.equal(parses, 1);
});

test('photo still over limit after preparation stays queued with an inline error and no parse call', async t => {
  let parses = 0;
  const photo = new File([new Uint8Array(11 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' });
  const { state } = form(t, { parseResume: async () => { parses++; return { fields: {}, reviewItems: [] }; } });
  state.pendingFiles.value = [photo]; await state.parseResume(photo);
  assert.equal(parses, 0); assert.match(state.parseError.value, /10MB/);
  assert.deepEqual(state.pendingFiles.value, [photo]); assert.equal(state.parsing.value, false);
});

test('education validation is shown at the field and clears only when selection changes', async t => {
  const message = '请选择有效的学历基础资料';
  const { state } = form(t, { api: { create: async () => {
    throw { response: { data: { message, data: { fieldErrors: { educationReferenceDataId: message } } } } };
  } } });
  state.form.education = 'Historical education'; state.form.educationReferenceDataId = 'inactive';
  await flush();
  await state.submit();
  assert.equal(state.educationError.value, message);
  assert.equal(state.form.educationReferenceDataId, 'inactive');
  state.form.educationReferenceDataId = 'active'; await vue.nextTick();
  assert.equal(state.educationError.value, '');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue'), 'utf8');
  assert.match(source, /<el-form-item[^>]*label="学历"[^>]*:error="educationError"/);
});

test('owner rejection is shown at the owner field and clears on selection change', async t => {
  const message = '负责人须为当前在职或试用的 HR 维护人员';
  const { state } = form(t, { api: { create: async () => { throw { response: { data: { message } } }; } } });
  await flush();
  await state.submit();
  assert.equal(state.ownerFieldError.value, message);
  state.form.ownerId = 'valid-hr'; await vue.nextTick();
  assert.equal(state.ownerFieldError.value, '');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue'), 'utf8');
  assert.match(source, /<el-form-item[^>]*label="人才负责人"[^>]*:error="ownerFieldError \|\| ownerError"/);
});

test('late photo preparation after replacing candidate cannot start parsing or change its form', async t => {
  let finishPreparation, started, parses = 0;
  const preparing = new Promise(r => { started = r; });
  const { state, props } = form(t, { prepareFile: file => new Promise(r => { finishPreparation = () => r(file); started(); }),
    parseResume: async () => { parses++; return { fields: { name: 'Wrong session' }, reviewItems: [] }; },
    api: { detail: async id => detail(id) },
  });
  const pending = state.parseResume(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await preparing;
  props.candidateId = 'replacement'; await vue.nextTick();
  finishPreparation(); await pending;
  assert.equal(parses, 0);
  assert.equal(state.form.name, 'Saved candidate');
});

test('disabled parsing still recovers matching result and original source without auto creating or applying', async t => {
  let creates = 0; const contexts = [], downloads = [];
  const { state } = form(t, { candidateId: 'existing', api: { detail: async () => detail('existing'), create: async () => { creates++; } },
    resumeApi: {
      status: async () => ({ enabled: false, configured: false }),
      current: async context => { contexts.push(context); return task({ context, result: { fields: { name: 'Parsed', school: 'Fictional school' }, reviewItems: [] } }); },
      file: async id => { downloads.push(id); return new Blob(['validated bytes'], { type: 'application/octet-stream' }); },
    },
  });
  await flush();
  assert.deepEqual(contexts, ['existing']); assert.deepEqual(downloads, ['task-1']);
  assert.equal(state.form.name, 'Saved candidate'); assert.equal(state.form.school, '');
  assert.equal(state.pendingFiles.value[0].name, 'fictional.pdf');
  assert.equal(state.pendingFiles.value[0].type, 'application/octet-stream');
  assert.equal(await state.pendingFiles.value[0].text(), 'validated bytes');
  assert.equal(creates, 0);
  state.applyParsedResult();
  assert.equal(state.form.school, 'Fictional school'); assert.equal(state.form.name, 'Saved candidate');
  assert.equal(state.parseConflicts.value[0].selected, false);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/views/talent/components/TalentFormDrawer.vue'), 'utf8');
  assert.match(source, /填入解析结果/); assert.match(source, /最长 150 秒/); assert.match(source, /30 分钟/);
  assert.doesNotMatch(source, /el-progress|percentage/);
});

test('closing and reopening recovers server task, never deletes it and requires explicit field application', async t => {
  let reads = 0, clears = 0;
  const { state, props } = form(t, { resumeApi: { current: async () => { reads++; return task({ result: { fields: { school: 'Recovered' }, reviewItems: [] } }); },
    clear: async () => { clears++; } } });
  await flush(); props.modelValue = false; await flush();
  assert.equal(state.pendingFiles.value.length, 0);
  props.modelValue = true; await flush();
  assert.equal(reads, 2); assert.equal(clears, 0); assert.equal(state.form.school, '');
  state.form.school = 'Human after reopen'; state.applyParsedResult();
  assert.equal(state.form.school, 'Human after reopen'); assert.equal(state.parseConflicts.value[0].value, 'Recovered');
});

test('late recovered download cannot queue a file into another candidate or closed form', async t => {
  let resolveFile;
  const { state, props } = form(t, { candidateId: 'A', api: { detail: async id => detail(id) }, resumeApi: {
    current: async context => context === 'A' ? task({ context }) : null,
    file: () => new Promise(resolve => { resolveFile = resolve; }),
  } });
  await flush(); props.candidateId = 'B'; await flush();
  resolveFile(new Blob(['old file'])); await flush();
  assert.deepEqual(state.pendingFiles.value, []); assert.equal(state.form.name, 'Saved candidate');
  assert.equal(state.fileError.value, '');
});

test('task deletion happens only after candidate and recovered attachment both save, not partial failure', async t => {
  const order = []; let fails = true;
  const { state } = form(t, { resumeApi: { current: async () => task(), clear: async id => order.push(`clear:${id}`) },
    api: { create: async () => { order.push('candidate'); return { id: 'persisted', editVersion: 'v1' }; },
      update: async () => ({ editVersion: 'v2' }) },
    bind: async () => { order.push('attachment'); if (fails) { fails = false; throw Error('upload failed'); } return true; },
  });
  await flush(); await state.submit();
  assert.deepEqual(order, ['candidate', 'attachment']); assert.equal(state.pendingFiles.value.length, 1);
  await state.submit();
  assert.deepEqual(order, ['candidate', 'attachment', 'attachment', 'clear:task-1']);
});

test('failed source recovery blocks saving until recovered or explicitly cleared and preserves human input', async t => {
  let clears = 0;
  const { state } = form(t, { resumeApi: { current: async () => task(), file: async () => { throw Error('offline'); },
    clear: async () => { clears++; } } });
  await flush(); state.form.name = 'Human input';
  assert.equal(state.saveDisabled.value, true); assert.match(state.fileError.value, /恢复|重试/);
  await state.clearResumeTask(); assert.equal(clears, 1);
  assert.equal(state.form.name, 'Human input'); assert.equal(state.saveDisabled.value, false);
});

test('old parse conflict selection cannot overwrite the newer human edit', async t => {
  const { state } = form(t, { parseResume: async () => ({ fields: { name: 'Parsed' }, reviewItems: [] }) });
  state.form.name = 'First human input';
  await state.parseResume(new File(['x'], 'fictional.pdf'));
  state.parseConflicts.value[0].selected = true;
  state.form.name = 'More recent human input';
  state.applySelectedParsedFields();
  assert.equal(state.form.name, 'More recent human input');
  assert.equal(state.parseConflicts.value[0].selected, false);
});

test('bound recovered source cannot be unbound while its retained task awaits cleanup', async t => {
  let unbinds = 0;
  const { state } = form(t, { resumeApi: { current: async () => task(), clear: async () => { throw Error('offline'); } },
    api: { create: async () => ({ id: 'persisted', editVersion: 'v1' }), unbindFile: async () => { unbinds++; } } });
  await flush(); await state.submit();
  assert.match(state.saveError.value, /附件已保存/);
  await state.removeSavedFile(state.editFiles.value[0]);
  assert.equal(unbinds, 0); assert.match(state.fileError.value, /清除解析任务/);
});

test('closed recovered download cannot change error, pending files or busy in a reopened session', async t => {
  let resolveFile, reads = 0;
  const { state, props } = form(t, { resumeApi: { current: async () => ++reads === 1 ? task() : null,
    file: () => new Promise(resolve => { resolveFile = resolve; }) } });
  await flush(); props.modelValue = false; props.modelValue = true; await flush();
  resolveFile(new Blob(['old resume'])); await flush();
  assert.deepEqual(state.pendingFiles.value, []); assert.equal(state.fileError.value, '');
  assert.equal(state.recoveringResumeFile.value, false);
});

test('uncertain start recovers the authenticated source instead of trusting a same-named local file', async t => {
  let reads = 0;
  const { state } = form(t, { resumeApi: {
    current: async () => ++reads === 1 ? null : task(), start: async () => { throw Error('lost response'); },
    file: async () => new Blob(['retained server file'], { type: 'application/octet-stream' }),
  } });
  await flush(); await state.parseResume(new File(['different local content'], 'fictional.pdf')); await flush();
  assert.equal(await state.resumeSourceFile.value.text(), 'retained server file');
  assert.equal(state.pendingFiles.value.length, 2);
});

test('recovered source reuses an identical pending file without queuing a duplicate attachment', async t => {
  let reads = 0;
  const original = new File(['same content'], 'fictional.pdf');
  const { state } = form(t, { resumeApi: {
    current: async () => ++reads === 1 ? null : task(), start: async () => { throw Error('lost response'); },
    file: async () => new Blob(['same content'], { type: 'application/octet-stream' }),
  } });
  await flush(); await state.parseResume(original); await flush();
  assert.equal(state.resumeSourceFile.value, original); assert.deepEqual(state.pendingFiles.value, [original]);
});

test('double network failure preserves recovered A and never associates same-named B or auto-applies A', async t => {
  let reads = 0;
  const { state } = form(t, { resumeApi: {
    current: async () => { if (++reads > 1) throw Error('reconciliation offline'); return task({
      result: { fields: { name: 'Candidate A', school: 'School A' }, reviewItems: [] },
    }); },
    start: async () => { throw Error('admission offline'); },
    file: async () => new Blob(['source A']),
  } });
  await flush();
  const sourceA = state.resumeSourceFile.value;
  assert.equal(await sourceA.text(), 'source A');
  await state.parseResume(new File(['source B'], 'fictional.pdf'));
  await flush();
  assert.equal(state.resumeRecovered.value, true);
  assert.equal(state.resumeSourceFile.value, sourceA);
  assert.equal(state.form.name, ''); assert.equal(state.form.school, '');
  state.applyParsedResult();
  assert.equal(state.form.name, 'Candidate A');
  assert.equal(await state.resumeSourceFile.value.text(), 'source A');
});
