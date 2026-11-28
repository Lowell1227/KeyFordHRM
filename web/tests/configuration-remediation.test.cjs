const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

function attentionPredicate() {
  const source = read('views/system/ConfigurationStatusPanel.vue').split('<script setup lang="ts">')[1].split('</script>')[0];
  const tree = ts.createSourceFile('configuration.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = tree.statements.filter(ts.isVariableStatement).flatMap(item => [...item.declarationList.declarations]);
  const code = ['isIncomplete', 'needsAttention'].map(name => {
    const declaration = declarations.find(item => item.name.getText(tree) === name);
    assert.ok(declaration, name);
    return `const ${declaration.getText(tree)};`;
  }).join('\n');
  return vm.runInNewContext(ts.transpileModule(`${code}\nneedsAttention;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText);
}

test('unknown field or verification states remain pending instead of disappearing as no work', () => {
  const check = attentionPredicate();
  assert.equal(check({ fields: [{ state: 'unknown' }], verification: 'passed' }), true);
  assert.equal(check({ fields: [{ state: 'present' }], verification: 'unknown' }), true);
  assert.equal(check({ fields: [{ state: 'present' }], verification: 'passed' }), false);
});

test('the overview prioritizes configuration status and leaves capability documentation collapsed', () => {
  const overview = read('views/system/SystemOverviewView.vue');
  assert.match(overview, /<ConfigurationStatusPanel/);
  assert.match(overview, /<details[^>]*>\s*<summary>能力清单/);
  const panel = read('views/system/ConfigurationStatusPanel.vue');
  for (const label of ['待核对', '配置项目', '核验记录', '当前业务状态']) assert.ok(panel.includes(label));
});

test('known recruitment configuration blockers use contextual settings links', () => {
  for (const [file, target] of [
    ['views/recruitment/RecruitmentIntakesView.vue', 'recruitment-mail'],
    ['views/recruitment/RecruitmentDemandsView.vue', 'recruitment-demand'],
    ['views/talent/components/TalentFormDrawer.vue', 'ai-resume'],
  ]) {
    assert.ok(read(file).includes('ConfigurationLink'));
    assert.ok(read(file).includes(`setting="${target}"`));
  }
  assert.match(read('components/common/ConfigurationLink.vue'), /target="_blank"/);
});
