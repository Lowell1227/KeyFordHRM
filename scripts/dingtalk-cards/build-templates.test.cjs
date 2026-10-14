const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplates } = require('./build-templates.cjs');

const contracts = {
  todo: ['title', 'subjectName', 'cycleLabel', 'periodLabel', 'stateLabel', 'summary', 'dueLabel', 'primaryText', 'primaryUrl', 'secondaryText', 'secondaryUrl'],
  goal: ['cycleLabel', 'stateLabel', 'goalCount', 'summary', 'feedbackSummary', 'primaryText', 'primaryUrl', 'updatedLabel'],
  evaluation: ['cycleLabel', 'periodLabel', 'reviewRoleLabel', 'stateLabel', 'summary', 'dueLabel', 'primaryText', 'primaryUrl', 'submittedLabel'],
  result: ['cycleLabel', 'stateLabel', 'summary', 'primaryText', 'primaryUrl', 'updatedLabel'],
};
function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; }

test('four native imports declare only the backend contract and no sensitive result fields', () => {
  const templates = buildTemplates();
  assert.deepEqual(Object.keys(templates), ['todo', 'goal', 'evaluation', 'result']);
  for (const [kind, template] of Object.entries(templates)) {
    const editor = JSON.parse(template.editorData);
    // The live message-card editor exports type "im" (native export, 2026-10-14).
    assert.equal(template.type, 'im');
    assert.equal(template.mode, 'card');
    assert.equal(editor.schemaVersion, '3.0.0');
    assert.deepEqual(editor.variableList.map(v => v.name).sort(), contracts[kind].toSorted());
    assert.ok(editor.variableList.every(v => v.type === 'string' && v.private === false));
    const nodes = editor.schema.componentsTree.flatMap(walk);
    assert.equal(nodes[0].componentName, 'Card');
    const buttons = nodes.filter(n => n.componentName === 'SingleButton');
    assert.equal(buttons.length, kind === 'todo' ? 2 : 1);
    for (const button of buttons) {
      assert.equal(button.props.actionType, 'url');
      assert.equal(button.props.enableClickEvent, true);
      assert.equal(button.props.disabledWhileForward, true);
      assert.equal(button.props.url.valueType, 'variable');
      assert.equal(button.props.url.variable, button.id.includes('secondary') ? 'secondaryUrl' : 'primaryUrl');
      assert.equal(button.props.actionId.content, '');
      assert.deepEqual(button.props.params, []);
    }
    const optional = kind === 'todo' ? ['dueLabel', 'cycleLabel', 'periodLabel']
      : kind === 'goal' ? ['feedbackSummary', 'updatedLabel']
        : kind === 'evaluation' ? ['dueLabel', 'submittedLabel'] : ['updatedLabel'];
    for (const key of optional) {
      const row = nodes.find(n => n.componentName === 'BaseText' && n.props.text.content.includes('${' + key + '}'));
      assert.equal(row.props.visible.valueType, 'condition');
      assert.ok(row.props.visible.condition.conditions.some(c => c.variable === key && c.op === 'isNotEmpty'));
    }
    assert.ok(template.widgetInfo.startsWith('<LinearLayout'));
    assert.match(template.widgetInfo, /@dtOpenLink\{/);
    assert.doesNotMatch(template.widgetInfo, /dtSendOutData|actionCallback/);
    assert.doesNotMatch(JSON.stringify(template), /calculatedScore|coefficient|managerScore|calibratedGrade/);
    assert.deepEqual(editor.formList, []);
    assert.deepEqual(editor.expList, []);
  }
});

test('generation is deterministic and optional native widgets hide empty data', () => {
  assert.deepEqual(buildTemplates(), buildTemplates());
  const todo = buildTemplates().todo;
  const editor = JSON.parse(todo.editorData);
  const secondary = editor.schema.componentsTree.flatMap(walk).find(n => n.id === 'todo-secondary');
  assert.equal(secondary.props.visible.valueType, 'condition');
  assert.deepEqual(secondary.props.visible.condition.conditions.map(c => c.variable), ['secondaryText', 'secondaryUrl']);
  assert.match(todo.widgetInfo, /visibility="@triple\{/);
});
