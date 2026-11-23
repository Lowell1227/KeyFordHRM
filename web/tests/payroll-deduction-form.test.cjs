const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../src/views/compensation/payroll/payroll-deduction-form.ts');
function load(){const m=new Module(filename,module);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);return m.exports;}

test('new ledger values must be entered explicitly, while legacy settings without ledger remain editable',()=>{
  const {emptyDeductionSettings,deductionFormErrors}=load(), settings=emptyDeductionSettings();
  assert.equal(settings.ledger.startDate,'');
  assert.equal(settings.ledger.priorSocialInsurance,'');
  assert.equal(settings.ledger.priorHousingFund,'');
  assert.ok(Object.values(settings.ledger.priorInPayMonth).every(value=>value===''));
  const errors=deductionFormErrors(settings);
  assert.ok(errors['ledger.startDate']); assert.ok(errors['ledger.priorInPayMonth.taxRelief']);
  delete settings.ledger;
  assert.ok(!Object.keys(deductionFormErrors(settings)).some(key=>key.startsWith('ledger.')));
});

test('prior in-month facts are nonzero only in cutoff month and never silently reset',()=>{
  const {emptyDeductionSettings,deductionFormErrors}=load(),settings=emptyDeductionSettings();
  settings.ledger={startDate:'2035-12-05',priorInPayMonth:Object.fromEntries(Object.keys(settings.tax.current).map(key=>[key,'0'])),priorSocialInsurance:'0',priorHousingFund:'0'};
  settings.ledger.priorInPayMonth.additionalDeduction='200';
  assert.ok(!deductionFormErrors(settings,'2035-12-10')['ledger.priorInPayMonth.additionalDeduction']);
  assert.ok(deductionFormErrors(settings,'2036-01-10')['ledger.priorInPayMonth.additionalDeduction']);
  assert.equal(settings.ledger.priorInPayMonth.additionalDeduction,'200');
  settings.ledger.startDate='2035-02-29';
  assert.ok(deductionFormErrors(settings)['ledger.startDate']);
});

test('December contributions paid in January allow external prior withholding; later contribution periods require explicit zero',()=>{
  const {emptyDeductionSettings,deductionFormErrors}=load(),settings=emptyDeductionSettings();
  settings.ledger={startDate:'2036-01-01',priorInPayMonth:Object.fromEntries(Object.keys(settings.tax.current).map(key=>[key,'0'])),priorSocialInsurance:'200',priorHousingFund:'100'};
  settings.socialInsurance.contributionDate='2035-12-31';settings.housingFund.contributionDate='2036-01-01';
  let errors=deductionFormErrors(settings,'2036-01-10');
  for(const key of ['ledger.priorSocialInsurance','ledger.priorHousingFund','socialInsurance.contributionDate','housingFund.contributionDate'])assert.ok(!errors[key],key);
  settings.housingFund.contributionDate='2036-02-01';
  errors=deductionFormErrors(settings,'2036-02-10');assert.ok(errors['ledger.priorHousingFund']);assert.ok(!errors['ledger.priorSocialInsurance']);
  settings.ledger.priorHousingFund='0';
  assert.ok(!deductionFormErrors(settings,'2036-02-10')['ledger.priorHousingFund']);
});
