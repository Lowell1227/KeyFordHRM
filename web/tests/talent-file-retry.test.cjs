const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function helper(upload, bind, image = {}) {
  const filename = path.resolve(__dirname, '../src/views/talent/components/talent-file-upload.ts');
  const loaded = new Module(filename, module);
  const deps = {
    'element-plus': { ElMessage: { error() {} } },
    '@/api/talent-pool.api': { talentPoolApi: { bindFile: bind } },
    '@/api/upload.api': { uploadApi: { upload } },
    '@/utils/image-compress': { isImageFile: () => false, ...image },
  };
  loaded.require = id => deps[id] ?? require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, filename);
  return loaded.exports;
}
test('binding retry reuses the uploaded object instead of uploading another copy', async () => {
  let uploads = 0, binds = 0;
  const { uploadAndBindTalentFile: upload } = helper(async () => { uploads++; return { url: '/api/v1/storage/download?key=talent-resume/synthetic.pdf', size: 4, mimeType: 'application/pdf' }; },
    async (_id, data) => { assert.equal(data.objectKey, 'talent-resume/synthetic.pdf'); if (++binds === 1) throw Error('synthetic network failure'); });
  const file = new File(['test'], 'synthetic.pdf', { type: 'application/pdf' });
  const state = {};
  await assert.rejects(upload('same-candidate', file, state));
  assert.equal(await upload('same-candidate', file, state), true);
  assert.equal(uploads, 1);
  assert.equal(binds, 2);
});
test('closing or changing the form during upload prevents a late bind', async () => {
  let binds = 0, current = true;
  const { uploadAndBindTalentFile: upload } = helper(async () => { current = false; return { url: '/api/v1/storage/download?key=talent-resume/synthetic.pdf', size: 4 }; }, async () => { binds++; });
  assert.equal(await upload('old-candidate', new File(['test'], 'synthetic.pdf'), {}, () => current), false);
  assert.equal(binds, 0);
});

test('parse preparation and retry share one compression and retain the bound record', async () => {
  let compressions = 0, uploads = 0, binds = 0, finishCompression;
  const original = new File(['original'], 'original.png', { type: 'image/png' });
  const compressed = new File(['small'], 'original.jpg', { type: 'image/jpeg' });
  const bound = { id: 'bound', candidateId: 'same-candidate', fileName: compressed.name };
  const { prepareTalentFile, uploadAndBindTalentFile } = helper(async file => {
    uploads++; assert.equal(file, compressed);
    return { url: '/api/v1/storage/download?key=talent-resume/original.jpg', mimeType: file.type, size: file.size };
  }, async (_id, body) => { binds++; assert.equal(body.fileName, compressed.name); return bound; }, {
    isImageFile: () => true,
    compressImage: () => { compressions++; return new Promise(r => { finishCompression = () => r(compressed); }); },
  });
  const state = {};
  const first = prepareTalentFile(original, state), second = prepareTalentFile(original, state);
  finishCompression();
  assert.equal(await first, compressed); assert.equal(await second, compressed);
  assert.equal(await uploadAndBindTalentFile('same-candidate', original, state), true);
  assert.equal(state.bound, bound);
  assert.equal(await uploadAndBindTalentFile('same-candidate', original, state), true);
  assert.equal(compressions, 1); assert.equal(uploads, 1); assert.equal(binds, 1);
});

test('late photo compression cannot upload or bind to a replaced candidate', async () => {
  let uploads = 0, binds = 0, finishCompression, current = true;
  const original = new File(['original'], 'original.png', { type: 'image/png' });
  const { uploadAndBindTalentFile } = helper(async () => { uploads++; }, async () => { binds++; }, {
    isImageFile: () => true,
    compressImage: () => new Promise(r => { finishCompression = () => r(original); }),
  });
  const pending = uploadAndBindTalentFile('old-candidate', original, {}, () => current);
  current = false; finishCompression();
  assert.equal(await pending, false);
  assert.equal(uploads, 0); assert.equal(binds, 0);
});

test('oversize photo after compression never reaches upload or binding', async () => {
  let uploads = 0, binds = 0, compressions = 0;
  const original = new File([new Uint8Array(11 * 1024 * 1024)], 'original.jpg', { type: 'image/jpeg' });
  const { uploadAndBindTalentFile } = helper(async () => { uploads++; }, async () => { binds++; }, {
    isImageFile: () => true,
    compressImage: async file => { compressions++; return file; },
  });
  assert.equal(await uploadAndBindTalentFile('candidate', original), false);
  assert.equal(compressions, 1); assert.equal(uploads, 0); assert.equal(binds, 0);
});
