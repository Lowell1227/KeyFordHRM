// Offline component/browser evidence with substituted HTTP, not real-backend acceptance.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const web = path.resolve(__dirname, '..');
let browser, script, styles;

before(async () => {
  const css = [fs.readFileSync(path.join(web, 'node_modules/element-plus/dist/index.css'), 'utf8')];
  const result = await build({ absWorkingDir: web, bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    stdin: { resolveDir: web, contents: `
      import {createApp, reactive, h, ref} from 'vue';
      import ElementPlus from 'element-plus';
      import Task from './src/views/task/TaskDetailView.vue';
      import Employee from './src/views/task/components/EmployeePeriodReviewWorkspace.vue';
      import Manager from './src/views/task/components/ManagerPeriodReviewWorkspace.vue';
      const scenario = window.scenario;
      const goal = {id:'goal',name:'已保存目标',weight:1,dimensionWeight:1,indicatorType:'quantitative',dimensionName:'业绩',
        description:'已保存描述',scoringStandard:'评分标准',visibilityScope:'supervisors',visibilityScopes:['supervisors'],
        visibleDepartmentIds:[],visibleUserIds:[],alignedObjectives:[],alignedParentIndicators:[],sortOrder:0};
      const task = {id:'A',cycleId:'cycle',cycleName:'虚构周期',employeeId:'employee',employeeName:'虚构员工',managerId:'manager',
        status:scenario.mode === 'self' ? 'self_eval' : 'indicator_drafting',goalWorkflowVersion:2,lifecycleStatus:'active',
        updatedAt:'2038-01-01',indicatorInstances:[goal],periods:[],flowRecords:[]};
      const review = {period:{id:'period-A',taskId:'A',periodKey:'2038-01',periodEnd:'2038-01-31',selfEvalDueAt:'2038-02-01',draftVersion:2,
        selfGrade:null,managerGrade:null,employeeSubmittedAt:'2038-02-01',attachments:[]},context:{cycleName:'虚构周期',statusLabel:'填写中'},
        permissions:{canEditEmployee:true,canEditManager:true},indicators:[{...goal,indicatorVersionItemId:'goal',isScoreRequired:true,
          selfScore:80,managerScore:null,progress:40,healthStatus:null,employeeComment:'已保存',managerComment:'',history:[]}]};
      window.fixture = {
        auth:reactive({user:{id:'employee',sysRole:'employee',businessCapabilities:{}}}),
        route:reactive({name:'TaskDetail',params:{id:'A'},query:{stage:scenario.mode === 'self' ? 'self-eval' : 'goal-setting'},
          fullPath:'/tasks/A?stage='+ (scenario.mode === 'self' ? 'self-eval' : 'goal-setting')}),
        calls:[], events:[],
        store:reactive({loading:false,detail:null,clear(){this.detail=null;}, async fetchDetail(id){
          fixture.calls.push(['detail',id]); this.detail = task; return this.detail;
        }}),
        async http(method,url,body){
          fixture.calls.push([method,url,body]);
          if (method !== 'get') throw {response:{status:scenario.status ?? 409}};
          if(url.startsWith('/performance-lifecycle/')) return {lifecycleStatus:scenario.lifecycle ?? 'terminated',terminationReason:'虚构终止原因'};
          if(url.endsWith('/review')) return review;
          if(url === '/cycles/cycle') return {id:'cycle',name:'虚构周期',goalWorkflowVersion:2};
          if(url.includes('alignment-candidates')) return {items:[],owners:[]};
          if(url.includes('objectives') || url.includes('indicators') || url.includes('templates')) return {items:[],total:0};
          return [];
        }
      };
      const component = scenario.mode === 'employee' ? Employee : scenario.mode === 'manager' ? Manager : Task;
      createApp({setup:()=>()=>h(component,{periodId:'period-A',taskId:'A',onSubmitted:()=>fixture.events.push('submitted')})})
        .use(ElementPlus).mount('#app');
    ` },
    plugins: [{ name: 'offline-component-fixture', setup(b) {
      b.onResolve({ filter: /^@\// }, args => {
        if (/^@\/(stores\/(auth|task)\.store|composables\/(usePermission|useTaskFlow))$/.test(args.path)) return;
        return { path: path.join(web, 'src', args.path.slice(2)) + (/\.(vue|ts|css)$/.test(args.path) ? '' : '.ts') };
      });
      b.onResolve({ filter: /^(\.\/http|@\/stores\/(auth|task)\.store|vue-router|@\/composables\/(usePermission|useTaskFlow))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: id }) => {
        const contents = id === './http' ? `export default Object.fromEntries(['get','post','put','delete','patch'].map(m=>[m,(url,body)=>fixture.http(m,url,body)]));`
          : id.includes('auth.store') ? 'export const useAuthStore=()=>fixture.auth;'
          : id.includes('task.store') ? 'export const useTaskStore=()=>fixture.store;'
          : id === 'vue-router' ? 'export const useRoute=()=>fixture.route; export const useRouter=()=>({push(){},replace(){}});'
          : id.includes('useTaskFlow') ? `import {ref} from 'vue'; export const useTaskFlow=()=>({actions:ref({})});`
          : `import {ref} from 'vue'; export const usePermission=()=>Object.fromEntries(['isTaskSelf','canEditSelfEval',
              'isTaskManager','isTaskDeptHead','isAdminLike','canConfirmResult','isPublished','canViewTotalScore','canViewCalibration',
              'canViewManagerComment','isResultAvailable'].map(key=>[key,ref(['isTaskSelf','canEditSelfEval'].includes(key))]));`;
        return { contents, loader: 'js', resolveDir: web };
      });
      b.onLoad({ filter: /\.vue$/ }, ({ path: file }) => {
        const { descriptor } = parse(fs.readFileSync(file, 'utf8'));
        const id = `data-v-${createHash('sha1').update(file).digest('hex').slice(0, 8)}`;
        for (const style of descriptor.styles) css.push(compileStyle({ source: style.content, filename: file, id, scoped: style.scoped }).code);
        return { contents: compileScript(descriptor, { id, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(file) };
      });
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
    } }],
  });
  script = result.outputFiles[0].text;
  styles = css.join('\n');
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function open(t, scenario, viewport) {
  const context = await browser.newContext({ viewport }); t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>' }) : route.abort());
  await page.goto('http://task-preservation.invalid/tasks/A');
  await page.evaluate(value => { window.scenario = value; }, scenario);
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  return { page, errors };
}

for (const viewport of [{ width: 1440, height: 950 }, { width: 390, height: 844 }]) {
  for (const mode of ['goal', 'self', 'employee', 'manager']) test(`${mode} preserves actual input DOM and blocks writes after termination at ${viewport.width}px, without a server`, async t => {
    const { page, errors } = await open(t, { mode }, viewport);
    const form = page.getByTestId(mode === 'goal' || mode === 'self' ? 'task-preserved-form' : `${mode}-period-preserved-form`);
    await expect(form).toBeVisible();
    let input;
    if (mode === 'goal') input = page.getByPlaceholder('请输入目标', { exact: true });
    if (mode === 'self') input = page.getByPlaceholder('概括 1-3 项关键成果');
    if (mode === 'employee') input = page.getByPlaceholder('简要说明本月进展和结果');
    if (mode === 'manager') input = page.getByPlaceholder('填写评价依据或反馈建议');
    await expect(input, `render errors: ${errors.join('; ')}`).toBeVisible();
    await input.fill('尚未保存的本地输入');
    await input.evaluate(node => { node.dataset.retainedNode = 'original'; });
    if (mode === 'self') {
      await page.getByPlaceholder('0-100', { exact: true }).fill('85');
      await page.getByRole('button', { name: '检查并提交', exact: true }).click();
      await page.getByRole('button', { name: '确认提交', exact: true }).click();
    } else await form.getByRole('button', { name: '保存草稿', exact: true }).click();
    const notice = page.getByTestId(mode === 'goal' || mode === 'self' ? 'task-write-notice' : `${mode}-period-write-notice`);
    await expect(notice).toContainText('已终止');
    await expect(input).toHaveValue('尚未保存的本地输入');
    await expect(input).toHaveAttribute('data-retained-node', 'original');
    await expect(input).toBeDisabled();
    await expect(page.getByRole('link', { name: '另页查看已保存记录' })).toHaveAttribute('target', '_blank');
    const evidence = await page.evaluate(() => ({ calls: fixture.calls, events: fixture.events,
      drafts: Object.keys(localStorage).filter(key => key.startsWith('kayford.self-eval-draft.')).map(key => localStorage.getItem(key)) }));
    assert.equal(evidence.calls.filter(row => ['put', 'post'].includes(row[0])).length, 1);
    assert.equal(evidence.calls.filter(row => row[1]?.startsWith('/performance-lifecycle/')).length, 1);
    assert.equal(evidence.calls.filter(row => row[0] === 'detail' || row[1]?.endsWith('/review')).length, 1);
    assert.deepEqual(evidence.events, []);
    if (mode === 'self') assert.ok(evidence.drafts.some(draft => draft.includes('尚未保存的本地输入')));
    assert.deepEqual(errors, []);
  });
}
