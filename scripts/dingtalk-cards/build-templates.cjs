const fs = require('node:fs');
const path = require('node:path');
const source = require('./editor-defaults.json');
const definitions = {
  todo: { title: '我的绩效待办', keys: ['title', 'subjectName', 'cycleLabel', 'periodLabel', 'stateLabel', 'summary', 'dueLabel', 'primaryText', 'primaryUrl', 'secondaryText', 'secondaryUrl'],
    rows: [['subjectName', '办理对象：'], ['cycleLabel', '周期：', true], ['periodLabel', '期间：', true], ['stateLabel', '状态：'], ['summary', ''], ['dueLabel', '截止：', true]] },
  goal: { title: '绩效目标', keys: ['cycleLabel', 'stateLabel', 'goalCount', 'summary', 'feedbackSummary', 'primaryText', 'primaryUrl', 'updatedLabel'],
    rows: [['cycleLabel', '周期：'], ['stateLabel', '状态：'], ['goalCount', '目标数：'], ['summary', ''], ['feedbackSummary', '审核反馈：', true], ['updatedLabel', '更新：', true]] },
  evaluation: { title: '绩效评价', keys: ['cycleLabel', 'periodLabel', 'reviewRoleLabel', 'stateLabel', 'summary', 'dueLabel', 'primaryText', 'primaryUrl', 'submittedLabel'],
    rows: [['cycleLabel', '周期：'], ['periodLabel', '期间：'], ['reviewRoleLabel', '办理身份：'], ['stateLabel', '状态：'], ['summary', ''], ['dueLabel', '截止：', true], ['submittedLabel', '提交：', true]] },
  result: { title: '绩效结果', keys: ['cycleLabel', 'stateLabel', 'summary', 'primaryText', 'primaryUrl', 'updatedLabel'],
    rows: [['cycleLabel', '周期：'], ['stateLabel', '状态：'], ['summary', ''], ['updatedLabel', '更新：', true]] },
};
const clone = value => structuredClone(value);
const string = content => ({ type: 'dynamicString', content, i18n: false });
const visibility = keys => ({ type: 'dynamicVisible', value: true, valueType: keys.length ? 'condition' : 'fixed',
  condition: { op: 'and', conditions: keys.map(variable => ({ type: 'variable', variable, variableType: 'global',
    op: 'isNotEmpty', value: '', valueType: 'fixed', valueVariableType: 'global' })) } });
const node = (componentName, id, props, title) => ({ componentName, id, props, title,
  hidden: false, isLocked: false, condition: true, conditionGroup: '' });
const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#039;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const data = key => `@data{data.cardData.${key}}`;
const nonempty = key => `@greater{@toLong{@len{@toStr{${data(key)}}}},0}`;

function buildTemplates() {
  return Object.fromEntries(Object.entries(definitions).map(([kind, definition]) => {
    const children = [];
    const widgets = [];
    function textRow(key, prefix = '', optional = false, header = false, literal) {
      const text = literal ?? `${prefix}\${${key}}`;
      const props = { ...clone(source.defaults.BaseText), text: string(text), marginLeft: 16, marginRight: 16,
        marginTop: header ? 14 : 6, marginBottom: header ? 8 : 0, margin: -2, enableIcon: false,
        maxLine: { type: 'dynamicNumber', valueType: 'fixed', value: header ? 2 : 6, variable: '', variableType: 'global' },
        autoWidth: false, color: header ? 'blue' : 'black', bold: header,
        visible: visibility(optional ? [key] : []) };
      children.push(node('BaseText', `${kind}-${key}`, props, header ? definition.title : prefix || key));
      const expression = literal ? `@toStr{'${literal}'}` : prefix ? `@concat{'${prefix}',${data(key)}}` : data(key);
      widgets.push(`<FastTextView width="match_parent" height="match_content" marginLeft="16np" marginRight="16np" marginTop="${header ? 14 : 6}np" marginBottom="${header ? 8 : 0}np" textSize="${header ? 16 : 14}np" maxLines="${header ? 2 : 6}" lineBreakMode="end" textColor="${xml(header ? "@dtDarkModeAdapter{'#007FFF','#58A6FF'}" : "@dtDarkModeAdapter{'#171A1D','#F5FFFFFF'}")}" text="${xml(expression)}"${optional ? ` visibility="${xml(`@triple{${nonempty(key)},'visible','gone'}`)}"` : ''} />`);
    }
    function button(which, optional) {
      const textKey = `${which}Text`, urlKey = `${which}Url`;
      const props = { ...clone(source.defaults.SingleButton), text: string(`\${${textKey}}`),
        actionType: 'url', enableClickEvent: true, transformToEventChain: false, disabledWhileForward: true,
        urlType: 'all', url: { type: 'dynamicLink', valueType: 'variable', variable: urlKey, variableType: 'global', value: '' },
        actionId: string(''), params: [], events: [], enableIcon: false, enableCornerMark: false,
        status: { type: 'dynamicSelect', valueType: 'fixed', value: 'normal', variable: '', variableType: 'global' },
        marginLeft: 16, marginRight: 16, marginTop: 12, marginBottom: 4,
        visible: visibility(optional ? [textKey, urlKey] : []) };
      children.push(node('SingleButton', `${kind}-${which}`, props, optional ? '次要入口（无值隐藏）' : '主要办理入口'));
      const visible = optional ? ` visibility="${xml(`@triple{@and{${nonempty(textKey)},${nonempty(urlKey)}},'visible','gone'}`)}"` : '';
      widgets.push(`<LinearLayout width="match_parent" height="match_content" marginLeft="16np" marginRight="16np" marginTop="12np" marginBottom="4np" cornerRadius="6np" backgroundColor="${xml("@dtDarkModeAdapter{'#E5F1FF','#18304B'}")}" onTap="${xml(`@dtOpenLink{${data(urlKey)}}`)}"${visible}><FastTextView width="match_parent" height="44np" textGravity="center" textSize="14np" maxLines="1" textColor="${xml("@dtDarkModeAdapter{'#007FFF','#58A6FF'}")}" text="${xml(data(textKey))}" /></LinearLayout>`);
    }
    textRow('title', '', false, true, kind === 'todo' ? undefined : definition.title);
    for (const row of definition.rows) textRow(...row);
    button('primary', false);
    if (kind === 'todo') button('secondary', true);
    textRow('snapshotNote', '', false, false, '查询时状态 · 打开页面查看最新进度');
    const rootProps = { ...clone(source.defaults.Card), enableClickEvent: false, params: [], events: [],
      url: { type: 'dynamicLink', value: '', valueType: 'fixed', variable: '', variableType: 'global' },
      summaryContent: { type: 'variableValue', variableType: 'global', variable: 'summary' },
      autoFoldConfig: { needFold: false, heightLimit: 480, foldStatusLocalDataKey: '_cardFoldStatusLocalDataKey' } };
    const root = { ...node('Card', `${kind}-card`, rootProps, definition.title), fileName: kind,
      dataSource: { list: [] }, state: {}, lifeCycles: {}, methods: {}, children };
    const cardData = Object.fromEntries(definition.keys.map(key => [key, '']));
    Object.assign(cardData, { title: definition.title, cycleLabel: '合成示例周期（非真实员工）', stateLabel: '查询时状态',
      summary: '请打开 HRM 查看本人实际事项和当前办理状态。', primaryText: '查看我的绩效', primaryUrl: 'https://hrm.example/tasks' });
    // Only declared contract variables enter mock data; static headings are not extra backend variables.
    for (const key of Object.keys(cardData)) if (!definition.keys.includes(key)) delete cardData[key];
    if (kind === 'goal') cardData.goalCount = '1';
    if (kind === 'todo') cardData.subjectName = '合成人员';
    if (kind === 'evaluation') Object.assign(cardData, { periodLabel: '2026-09', reviewRoleLabel: '员工本人自评' });
    const editor = { schemaVersion: source.schemaVersion, editVersion: 0,
      schema: { version: '1.0.0', componentsMap: ['Card', 'BaseText', 'SingleButton'].map(componentName => ({
        package: '@ali/dxComponent', version: '1.0.0', exportName: componentName, main: './src/index.tsx',
        destructuring: false, subName: '', componentName })), componentsTree: [root], i18n: {} },
      variableList: definition.keys.map(name => ({ name, private: false, type: 'string', id: name,
        description: name, editorVarType: 'variables' })),
      mockData: { cardData, cardPrivateData: {}, localData: {}, richTextData: {} },
      formList: [], expList: [], localList: [], hsfList: [], lwpList: [], customWidgetInfo: '', useCustomWidgetInfo: false,
      extension: { extendType: 'NORMAL', fileTypeList: [] } };
    return [kind, { editorData: JSON.stringify(editor),
      widgetInfo: `<LinearLayout width="@data{width}" height="match_content" orientation="vertical" cornerRadius="12np" paddingBottom="14np" backgroundColor="${xml("@dtDarkModeAdapter{'#FFFFFF','#1E1E1E'}")}">${widgets.join('')}</LinearLayout>`,
      type: 'im', mode: 'card' }];
  }));
}
module.exports = { buildTemplates };

if (require.main === module) {
  const directory = path.resolve(__dirname, '../../docs/dingtalk/cards');
  fs.mkdirSync(directory, { recursive: true });
  for (const [kind, template] of Object.entries(buildTemplates())) {
    fs.writeFileSync(path.join(directory, `${kind}.json`), JSON.stringify(template, null, 2) + '\n');
  }
  process.stdout.write('Generated four DingTalk message-card imports. Native import/render verification remains required.\n');
}
