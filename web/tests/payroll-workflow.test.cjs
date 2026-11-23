const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/views/compensation/payroll/payroll-state.ts');
function load() { assert.ok(fs.existsSync(filename), 'payroll state module must exist'); const m = new Module(filename, module); m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename); return m.exports; }
test('actions bind approval actor, version, subject, stale source, and trial export', () => {
  const { batchActions } = load();
  const batch = { subjectId: 'a', status: 'pending', purpose: 'validation', version: 7, versions: [{ version: 2, approvalPath: ['r', 'p'], reviewerCount: 1, approvalStep: 0, status: 'pending' }] };
  const caps = ['payroll_edit', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle'];
  assert.ok(batchActions(batch, caps, 'r').includes('approve'));
  assert.ok(!batchActions(batch, caps, 'p').includes('approve'));
  assert.ok(!batchActions({ ...batch, needsUpdate: true }, caps, 'r').includes('approve'));
  assert.ok(batchActions({ ...batch, needsUpdate: true }, caps, 'r').includes('return'));
  const approved = { ...batch, status: 'approved', versions: [{ ...batch.versions[0], status: 'approved' }] };
  assert.ok(batchActions(approved, caps, 'r').includes('export'));
  assert.ok(!batchActions({ ...approved, purpose: 'trial' }, caps, 'r').includes('export'));
  assert.deepEqual(batchActions(approved, ['attendance_edit'], 'r'), []);
});
test('calculation version differs from batch optimistic token; pending role follows approval step', () => {
  const { currentVersion, batchActions, batchStatus } = load();
  const b = { status: 'pending', version: 8, versions: [{ version: 2, status: 'pending', approvalPath: ['r','p'], reviewerCount: 1, approvalStep: 1 }, { version: 1, status: 'returned' }] };
  assert.equal(currentVersion(b).version, 2);
  assert.equal(batchStatus(b), '待审批');
  assert.ok(batchActions(b, ['payroll_approve'], 'p').includes('approve'));
  assert.ok(!batchActions(b, ['payroll_review'], 'p').includes('approve'));
});
test('subject capability never leaks from a different subject or disabled switch', () => {
  const { subjectCapabilities } = load();
  const access = { enabled: true, subjects: [{ id: 'a', capabilities: ['attendance_edit'] }, { id: 'b', capabilities: ['payroll_edit'] }] };
  assert.deepEqual(subjectCapabilities(access, 'a'), ['attendance_edit']);
  assert.deepEqual(subjectCapabilities({ ...access, enabled: false }, 'b'), []);
  assert.deepEqual(subjectCapabilities(access, 'missing'), []);
});
test('freshness on latest version blocks approval and trial/incomplete batches do not submit', () => {
  const { batchActions } = load();
  const b = { status: 'pending', purpose: 'validation', version: 9, versions: [{ version: 2, status: 'pending', needsUpdate: true, approvalPath: ['r'], approvalStep: 0, reviewerCount: 1 }] };
  assert.ok(!batchActions(b, ['payroll_review'], 'r').includes('approve'));
  const trial = { ...b, purpose: 'trial', status: 'calculated' };
  assert.ok(!batchActions(trial, ['payroll_edit'], 'r').includes('submit'));
  const missing = { ...trial, purpose: 'validation', versions: [{ ...b.versions[0], status: 'calculated', needsUpdate: false, gross: null, issues: ['待配置'], lines: [] }] };
  assert.ok(!batchActions(missing, ['payroll_edit'], 'r').includes('submit'));
});
test('submitted-by self cannot decide and cancelled payment arrangements do not export again', () => {
  const { batchActions } = load();
  const b = { status: 'pending', purpose: 'validation', version: 5, versions: [{ version: 1, status: 'pending', approvalPath: ['r'], approvalStep: 0, reviewerCount: 1, submittedById: 'r' }] };
  assert.ok(!batchActions(b, ['payroll_review'], 'r').includes('approve'));
  const cancelled = { ...b, status: 'approved', versions: [{ ...b.versions[0], status: 'approved' }], events: [{ action: 'remainder_cancelled', version: 1 }] };
  assert.ok(!batchActions(cancelled, ['payroll_export'], 'r').includes('export'));
});

test('void requires settlement authority, not only payroll editing', () => {
  const { batchActions } = load();
  const batch = { status: 'approved', purpose: 'validation', versions: [{ status: 'approved', version: 1, approvalPath: [], approvalStep: 0 }] };
  assert.ok(!batchActions(batch, ['payroll_edit'], 'operator').includes('void'));
  assert.ok(batchActions(batch, ['payroll_settle'], 'finance').includes('void'));
});

test('default payroll month follows Beijing business time across month boundary', () => {
  const { payrollBusinessMonth } = load();
  assert.equal(payrollBusinessMonth(new Date('2026-10-31T16:01:00Z')), '2026-11');
  assert.equal(payrollBusinessMonth(new Date('2026-10-31T15:59:00Z')), '2026-10');
});

test('a held partially paid version permits stopping the remaining arrangement but not new money or export', () => {
  const { batchActions } = load();
  const version = { version: 1, status: 'approved', approvalPath: ['r', 'p'], reviewerCount: 1, approvalStep: 2,
    lines: [{ status: 'ready', amount: '200.00', reservation: { lineId: 'line' }, settlements: [{ amount: '150.00' }] }] };
  const batch = { status: 'approved', purpose: 'validation', needsUpdate: true, versions: [version] };
  const actions = batchActions(batch, ['payroll_settle', 'payroll_export'], 'finance');
  assert.ok(actions.includes('cancel-remainder'));
  assert.ok(!actions.includes('settle'));
  assert.ok(!actions.includes('export'));
  assert.ok(!batchActions(batch, ['payroll_view'], 'reader').includes('cancel-remainder'));
  assert.ok(!batchActions({ ...batch, purpose: 'trial' }, ['payroll_settle'], 'finance').includes('cancel-remainder'));
  assert.ok(!batchActions({ ...batch, versions: [{ ...version, lines: [{ ...version.lines[0], reservation: null }] }] }, ['payroll_settle'], 'finance').includes('cancel-remainder'));
});

function netBatch() {
  const result = {status:'ready',issues:[],gross:'100.00',socialInsurance:'8.00',housingFund:'5.00',incomeTax:'1.00',net:'86.00',evidence:{}};
  return {id:'batch',month:'2035-11',status:'approved',purpose:'formal',payMonth:'2035-12',version:5,versions:[{
    id:'v1',version:1,status:'approved',payDate:'2035-12-10',gross:'100.00',issues:[],approvalPath:['reviewer','approver'],reviewerCount:1,approvalStep:2,
    lines:[{employeeId:'e',status:'ready',amount:'100.00',reservation:{id:'r'}}],netPayments:[],
    netSnapshot:{schema:1,payDate:'2035-12-10',sourceHash:'hash',rows:[{employeeId:'e',employeeName:'Fictional',employeeNo:'F001',result}],totals:result},
  }]};
}

test('net versions use whole-row payments only after all approvals and remain read-only when held or paid', () => {
  const {batchActions} = load(), batch = netBatch(), caps = ['payroll_settle','payroll_export'];
  assert.ok(batchActions(batch,caps,'finance').includes('net-payment'));
  assert.ok(!batchActions(batch,caps,'finance').includes('settle'));
  assert.ok(!batchActions(batch,caps,'finance').includes('cancel-remainder'));
  for (const changed of [{needsUpdate:true},{status:'pending'},{purpose:'trial'},{status:'closed'}]) {
    assert.ok(!batchActions({...batch,...changed},caps,'finance').includes('net-payment'));
  }
  assert.ok(!batchActions(batch,['payroll_view'],'reader').includes('net-payment'));
  batch.versions[0].approvalStep=1;
  assert.ok(!batchActions(batch,caps,'finance').includes('net-payment'));
  assert.ok(!batchActions(batch,caps,'finance').includes('export'));
  batch.versions[0].approvalStep=2;
  batch.versions[0].netPayments=[{employeeId:'e',id:'payment'}];
  assert.ok(!batchActions(batch,caps,'finance').includes('net-payment'));
  assert.ok(!batchActions(batch,caps,'finance').includes('void'));
});

test('formal gross-only or incomplete net versions never submit; legacy test gross batches still do', () => {
  const {batchActions} = load(), batch=netBatch(); batch.status='calculated'; batch.versions[0].status='calculated';
  assert.ok(batchActions(batch,['payroll_edit'],'editor').includes('submit'));
  batch.versions[0].netSnapshot=null;
  assert.ok(!batchActions(batch,['payroll_edit'],'editor').includes('submit'));
  assert.ok(batchActions({...batch,purpose:'validation'},['payroll_edit'],'editor').includes('submit'));
  batch.versions[0].netSnapshot=netBatch().versions[0].netSnapshot;
  batch.versions[0].netSnapshot.totals=null;
  assert.ok(!batchActions(batch,['payroll_edit'],'editor').includes('submit'));
});

test('pay dates are explicit calendar dates in pay month, and net export names distinguish tests', () => {
  const {payrollPayDateError,payrollDownloadName}=load();
  assert.match(payrollPayDateError('','2035-12'),/发薪日/);
  for(const date of ['2035-12-32','2035-02-29','2035-12-10T00:00:00Z']) assert.ok(payrollPayDateError(date,'2035-12'));
  assert.match(payrollPayDateError('2035-11-30','2035-12'),/2035-12/);
  assert.equal(payrollPayDateError('2036-02-29','2036-02'),'');
  assert.equal(payrollDownloadName(netBatch()),'实发工资-2035-11-V1.xlsx');
  assert.match(payrollDownloadName({...netBatch(),month:'2035-11',purpose:'validation'}),/^测试环境-实发工资-2035-11-V1/);
});

test('serialized server dates retain net actions, but mismatched snapshot dates fail closed',()=>{
  const {batchActions}=load(),batch=netBatch();
  batch.versions[0].payDate='2035-12-10T00:00:00.000Z';
  assert.ok(batchActions(batch,['payroll_settle'],'finance').includes('net-payment'));
  batch.versions[0].payDate='2035-12-11T00:00:00.000Z';
  assert.ok(!batchActions(batch,['payroll_settle','payroll_export'],'finance').includes('net-payment'));
  assert.ok(!batchActions(batch,['payroll_settle','payroll_export'],'finance').includes('export'));
});

test('held partially paid net versions can cancel only unpaid uncancelled people, never export the old whole file',()=>{
  const {batchActions,cancelledNetEmployeeIds}=load(), batch=netBatch(), version=batch.versions[0];
  version.netSnapshot.rows.push({...version.netSnapshot.rows[0],employeeId:'paid'}, {...version.netSnapshot.rows[0],employeeId:'next'});
  version.netPayments=[{id:'p',employeeId:'paid'}];
  batch.needsUpdate=true;
  let actions=batchActions(batch,['payroll_settle','payroll_export'],'finance');
  assert.ok(actions.includes('cancel-net-remainder'));assert.ok(!actions.includes('net-payment'));assert.ok(!actions.includes('export'));
  assert.ok(!actions.includes('void'));assert.ok(!actions.includes('settle'));assert.ok(!actions.includes('cancel-remainder'));
  batch.events=[{action:'remainder_cancelled',version:1,metadata:{employeeId:'e',versionId:'v1',sourceHash:'hash',reference:'fictional'}}];
  assert.deepEqual(cancelledNetEmployeeIds(batch,version),['e']);
  batch.needsUpdate=false;
  actions=batchActions(batch,['payroll_settle','payroll_export'],'finance');
  assert.ok(actions.includes('net-payment'));assert.ok(actions.includes('cancel-net-remainder'));assert.ok(!actions.includes('export'));
  batch.events.push({action:'remainder_cancelled',version:1,metadata:{employeeId:'next',versionId:'v1'}});
  actions=batchActions(batch,['payroll_settle','payroll_export'],'finance');
  assert.ok(!actions.includes('net-payment'));assert.ok(!actions.includes('cancel-net-remainder'));
});

test('net cancellation event identities bind both selected calculation number and version id, never another version',()=>{
  const {cancelledNetEmployeeIds,batchActions}=load(),batch=netBatch(),version=batch.versions[0];
  batch.events=[
    {action:'net_paid',version:1,metadata:{employeeId:'e',versionId:'v1'}},
    {action:'remainder_cancelled',version:2,metadata:{employeeId:'e',versionId:'v1'}},
    {action:'remainder_cancelled',version:1,metadata:{employeeId:'e',versionId:'other'}},
    {action:'remainder_cancelled',version:1,metadata:{employeeId:'unknown',versionId:'v1'}},
    {action:'remainder_cancelled',version:1,metadata:{lineId:'old-gross-line'}},
  ];
  assert.deepEqual(cancelledNetEmployeeIds(batch,version),[]);
  batch.events.push({action:'remainder_cancelled',version:1,metadata:{employeeId:'e',versionId:'v1'}});
  batch.events.push(batch.events.at(-1));
  assert.deepEqual(cancelledNetEmployeeIds(batch,version),['e']);
  assert.deepEqual(cancelledNetEmployeeIds(batch,{...version,id:'old',version:0}),[]);
  for(const more of [{status:'pending'},{purpose:'trial'},{status:'closed'}]) {
    assert.ok(!batchActions({...netBatch(),...more},['payroll_settle'],'finance').includes('cancel-net-remainder'));
  }
  assert.ok(!batchActions(netBatch(),['payroll_view'],'reader').includes('cancel-net-remainder'));
});
