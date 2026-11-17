const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const source = path => readFileSync(resolve(__dirname, '..', path), 'utf8');

test('edit uses the loaded baseline and retains input until explicit reload', () => {
  const form = source('src/views/talent/components/TalentFormDrawer.vue');
  assert.match(form, /editVersion: loadedEditVersion.value/);
  assert.match(form, /loadedEditVersion.value = detail.editVersion/);
  assert.match(form, /TALENT_EDIT_CONFLICT/);
  assert.match(form, /v-if="editConflict"/);
  assert.match(form, /async function reloadAfterConflict/);
  assert.match(form, /ElMessageBox.confirm/);
  const handler = form.slice(form.indexOf('function captureConflict'), form.indexOf('async function reloadAfterConflict'));
  assert.doesNotMatch(handler, /resetForm\(|onOpen\(/);
});

test('quick reject captures identity and baseline before confirmation', () => {
  const detail = source('src/views/talent/components/TalentDetailDrawer.vue');
  const action = detail.slice(detail.indexOf('async function markRejected'), detail.indexOf('async function removeCandidate'));
  assert.match(action, /const target = detail.value/);
  assert.match(action, /editVersion: target.editVersion/);
  assert.match(action, /props.candidateId !== target.id/);
});
