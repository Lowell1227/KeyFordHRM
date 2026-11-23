// Script-state tests only; real HTTP, rendering and role acceptance run in the integrated preview.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {parse,compileScript}=require('@vue/compiler-sfc'),vue=require('vue');
const root=path.resolve(__dirname,'../src');
function moduleFrom(filename,source,dependencies={}) {
  const m=new Module(filename,module);m.paths=module.paths;
  m.require=id=>{
    if(Object.hasOwn(dependencies,id))return dependencies[id];
    if(id.endsWith('.vue'))return {};
    if(id.startsWith('./')){
      const file=path.resolve(path.dirname(filename),`${id}.ts`);
      if(fs.existsSync(file))return moduleFrom(file,fs.readFileSync(file,'utf8'),dependencies);
    }
    return require(id);
  };
  m._compile(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);
  return m.exports;
}
const statePath=path.join(root,'views/compensation/payroll/payroll-state.ts');
const state=moduleFrom(statePath,fs.readFileSync(statePath,'utf8'));
const approved=()=>({id:'batch',subjectId:'subject',month:'2035-11',payMonth:'2035-12',purpose:'validation',version:5,status:'approved',versions:[{
  id:'v1',version:1,status:'approved',payDate:'2035-12-10T00:00:00.000Z',sourceHash:'gross',issues:[],approvalPath:['r','a'],approvalStep:2,reviewerCount:1,gross:'100.00',lines:[],decisions:[],exports:[],netPayments:[],
  netSnapshot:{schema:1,payDate:'2035-12-10',sourceHash:'net',rows:[{employeeId:'e',employeeName:'Fictional',employeeNo:'F001',result:{status:'ready',issues:[],gross:'100.00',socialInsurance:'8.00',housingFund:'5.00',incomeTax:'1.00',net:'86.00',evidence:{}}}],totals:{gross:'100.00',socialInsurance:'8.00',housingFund:'5.00',incomeTax:'1.00',net:'86.00'}},
}]});
async function detail(t,{batch=approved(),profiles=[],pay,cancel,calculate,caps=['payroll_edit','payroll_settle','payroll_export'],accessInitiallyMissing=false}={}) {
  const calls=[],reads=[],confirmations=[],access=vue.reactive({enabled:true,subjects:[{id:'subject',capabilities:caps}]}),events=[];
  const viewProps=vue.reactive({access:accessInitiallyMissing?undefined:access,allowExport:true});
  const api={batch:async()=>{reads.push('batch');return batch;},employees:async()=>[],operators:async()=>[],deductionProfiles:async()=>profiles,
    calculate:async(...args)=>{calls.push(['calculate',...args]);return calculate?calculate(...args):batch;},
    cancelNetRemainder:async(...args)=>{calls.push(['cancelNetRemainder',...JSON.parse(JSON.stringify(args))]);return cancel?cancel(...args):batch;},
    netPayment:async(...args)=>{calls.push(['netPayment',...JSON.parse(JSON.stringify(args))]);return pay?pay(...args):batch;}};
  const filename=path.join(root,'views/compensation/payroll/PayrollBatchDetail.vue');
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'));
  const source=compileScript(descriptor,{id:'net-state'}).content.replace(/import\.meta\.env\.VITE_PREVIEW_MODE/g,"'true'");
  const scope=vue.effectScope();t.after(()=>scope.stop());
  const component=moduleFrom(filename,source,{
    vue:{...vue,onBeforeUnmount:()=>{}},'vue-router':{useRoute:()=>({params:{id:'batch'},query:{}}),useRouter:()=>({push:async()=>{}}),onBeforeRouteLeave:()=>{},onBeforeRouteUpdate:()=>{}},
    'element-plus':{ElMessageBox:{confirm:async(...args)=>{confirmations.push(args);}}},'@element-plus/icons-vue':{},
    '@/stores/auth.store':{useAuthStore:()=>({user:{id:'finance'}})},
    '@/api/payroll.api':{payrollApi:api,payrollConflictBatchId:()=>'',payrollError:async error=>error.message},
    './payroll-state':state,'./PayrollDeductionsPreview.vue':{},'./PayrollNetResults.vue':{},
  }).default;
  const vm=scope.run(()=>component.setup(viewProps,{emit:(...args)=>events.push(args),expose:()=>{}}));
  await new Promise(resolve=>setImmediate(resolve));
  return {vm,calls,reads,confirmations,access,events,setAccess:value=>{viewProps.access=value;},setBatch:value=>{batch=value;}};
}

test('net calculation requires an explicit valid date and leaves the old gross action available',async t=>{
  const batch={...approved(),status:'draft',versions:[]};
  const {vm,calls}=await detail(t,{batch,profiles:[{status:'active',payDate:'2035-12-10',settings:{ledger:{}}}]});
  assert.equal(vm.calculationMode.value,'net');
  await vm.selectAction('calculate');assert.equal(calls.length,0);
  await vm.run();assert.ok(vm.fields.value.payDate);assert.equal(calls.length,0);
  vm.payDate.value='2035-11-30';await vm.run();assert.match(vm.fields.value.payDate,/2035-12/);
  vm.payDate.value='2035-12-10';await vm.run();assert.deepEqual(calls[0],['calculate','batch',5,'2035-12-10']);
  const old=await detail(t,{batch});assert.equal(old.vm.calculationMode.value,'gross');
  await old.vm.selectAction('calculate');assert.deepEqual(old.calls[0],['calculate','batch',5,undefined]);
});

test('formal calculation defaults to net without profiles; old versions have no actions',async t=>{
  const batch=approved();batch.purpose='formal';batch.status='draft';batch.versions=[];
  const {vm,calls}=await detail(t,{batch});assert.equal(vm.calculationMode.value,'net');
  await vm.selectAction('calculate');await vm.run();assert.equal(calls.length,0);assert.ok(vm.fields.value.payDate);
  const history=approved();history.versions.push({...history.versions[0],id:'v0',version:0});
  const prior=await detail(t,{batch:history});prior.vm.selectedVersion.value=0;
  assert.deepEqual(prior.vm.actions.value,[]);await prior.vm.selectNetPayment('e');assert.equal(prior.vm.action.value,undefined);
});

test('unknown payment response retains UUID and approved date across refresh, never sends browser amounts',async t=>{
  let attempt=0;
  const batch=approved();
  const result=await detail(t,{batch,pay:async()=>{if(++attempt===1)throw new Error('Response unknown');return {...batch,status:'closed'};}});
  const {vm,calls,confirmations}=result;
  await vm.selectNetPayment('e');vm.reference.value='fictional-voucher';await vm.run();
  assert.equal(confirmations.length,1);assert.equal(vm.error.value,'Response unknown');
  assert.equal(vm.actionLabels.value['net-payment'],'确认实发与扣缴');
  assert.equal(confirmations[0][1],'确认实发与扣缴');
  assert.match(confirmations[0][0],/实际发放.*实际扣缴情形与批准一致/);
  const request=JSON.parse(JSON.stringify(vm.netPaymentAttempt.value.body));
  assert.deepEqual(Object.keys(request).sort(),['employeeId','expectedVersion','payDate','reference','requestId']);
  assert.equal(request.payDate,'2035-12-10');assert.match(request.requestId,/^[a-f0-9-]{36}$/);
  result.setBatch({...batch,version:6,status:'closed',versions:[{...batch.versions[0],netPayments:[{employeeId:'e',reference:'fictional-voucher'}]}]});
  await vm.refresh();assert.equal(vm.action.value,'net-payment');assert.deepEqual(vm.netPaymentAttempt.value.body,request);
  await vm.run();assert.deepEqual(calls[0],calls[1]);assert.equal(confirmations.length,1);assert.equal(vm.netPaymentAttempt.value,undefined);
});

test('payment retry still requires current subject settlement access',async t=>{
  const {vm,access,calls}=await detail(t,{pay:async()=>{throw new Error('Unknown');}});
  await vm.selectNetPayment('e');vm.reference.value='fictional-voucher';await vm.run();
  access.subjects[0].capabilities=[];await vm.run();assert.equal(calls.length,1);assert.match(vm.error.value,/授权已变化/);
});

test('net API sends only the supplied immutable payment body and legacy calculate remains unchanged',async()=>{
  const calls=[],filename=path.join(root,'api/payroll.api.ts');
  const api=moduleFrom(filename,fs.readFileSync(filename,'utf8'),{'./http':{default:{post:async(...args)=>{calls.push(args);}}}}).payrollApi;
  await api.calculate('batch/a',7);await api.calculate('batch/a',7,'2035-12-10');
  const body={expectedVersion:7,employeeId:'e',requestId:'same-uuid',reference:'fictional',payDate:'2035-12-10'};
  await api.netPayment('batch/a',body);await api.netPayment('batch/a',body);
  assert.deepEqual(calls[0][1],{expectedVersion:7});assert.deepEqual(calls[1][1],{payDate:'2035-12-10',expectedVersion:7});
  assert.equal(calls[2][0],'/payroll/batches/batch%2Fa/net-payment');assert.deepEqual(calls[2],calls[3]);
  assert.deepEqual(calls[2][1],body);assert.equal(calls[2][2].skipErrorMessage,true);
});

test('detail initialization waits for props.access, then selects reviewed ledger mode on the initial load',async t=>{
  const batch={...approved(),status:'draft',versions:[]};
  const {vm,access,reads,setAccess}=await detail(t,{batch,accessInitiallyMissing:true,profiles:[{status:'active',payDate:'2035-12-10',settings:{ledger:{}}}]});
  assert.deepEqual(reads,[]);assert.equal(vm.batch.value,undefined);
  setAccess(access);await vue.nextTick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(reads,['batch']);assert.equal(vm.batch.value.id,'batch');assert.equal(vm.calculationMode.value,'net');
});

test('cancel unpaid net arrangement validates exact employee and evidence, confirms scope and refreshes cancellation state',async t=>{
  const batch=approved(),version=batch.versions[0];
  version.netSnapshot.rows.push({...version.netSnapshot.rows[0],employeeId:'paid',employeeName:'Fictional Paid'});
  version.netPayments=[{id:'p',employeeId:'paid'}];batch.needsUpdate=true;
  const {vm,calls,confirmations}=await detail(t,{batch,cancel:async()=>({...batch,version:6,events:[{action:'remainder_cancelled',version:1,metadata:{employeeId:'e',versionId:'v1',sourceHash:'net',reference:'fictional-cancel'}}]})});
  assert.ok(vm.actions.value.includes('cancel-net-remainder'));
  await vm.selectAction('cancel-net-remainder');await vm.run();
  assert.ok(vm.fields.value.employeeId);assert.ok(vm.fields.value.reference);assert.equal(calls.length,0);
  vm.employeeId.value='paid';vm.reference.value='fictional-cancel';await vm.run();assert.ok(vm.fields.value.employeeId);assert.equal(calls.length,0);
  vm.employeeId.value='e';await vm.run();
  assert.equal(confirmations[0][1],'撤销未付安排');assert.match(confirmations[0][0],/Fictional.*未付|Fictional.*未.*发放/);
  assert.deepEqual(calls[0],['cancelNetRemainder','batch',{expectedVersion:5,employeeId:'e',reference:'fictional-cancel'}]);
  assert.deepEqual(vm.cancelledNetIds.value,['e']);assert.equal(vm.netCandidates.value.length,0);
  assert.ok(!vm.actions.value.includes('cancel-net-remainder'));assert.ok(!vm.actions.value.includes('export'));
  assert.equal(vm.version.value.netPayments[0].employeeId,'paid');
});

test('cancellation API uses only expectedVersion, exact employee and reference without browser amounts',async()=>{
  const calls=[],filename=path.join(root,'api/payroll.api.ts');
  const api=moduleFrom(filename,fs.readFileSync(filename,'utf8'),{'./http':{default:{post:async(...args)=>calls.push(args)}}}).payrollApi;
  const input={expectedVersion:5,employeeId:'unpaid',reference:'fictional-cancel'};
  await api.cancelNetRemainder('batch/a',input);
  assert.deepEqual(calls,[['/payroll/batches/batch%2Fa/cancel-net-remainder',input,{skipErrorMessage:true}]]);
});

test('net results keep one historical row per person and use the same paid/cancelled eligibility on PC and mobile',()=>{
  const filename=path.join(root,'views/compensation/payroll/PayrollNetResults.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'));
  const component=moduleFrom(filename,compileScript(descriptor,{id:'net-rows'}).content,{'@/components/common/MobileResultCard.vue':{}}).default;
  const row=approved().versions[0].netSnapshot.rows[0],snapshot={...approved().versions[0].netSnapshot,rows:[row,{...row,employeeId:'next'},{...row,employeeId:'paid'}]};
  const vm=component.setup({snapshot,payments:[{employeeId:'paid'}],cancelledIds:['e'],canPay:true,disabled:false},{expose:()=>{},emit:()=>{}});
  assert.equal(vm.rowStatus(row),'已撤销未付安排');assert.equal(vm.canPayRow(row),false);
  assert.equal(vm.canPayRow(snapshot.rows[1]),true);assert.equal(vm.rowStatus(snapshot.rows[2]),'已确认实发与扣缴');assert.equal(vm.canPayRow(snapshot.rows[2]),false);
  assert.equal(snapshot.rows.length,3);assert.equal(new Set(snapshot.rows.map(value=>value.employeeId)).size,3);
});
