import type { PayrollParameterRelease } from '@/types/payroll.types';

export interface PayrollDisplayRow { label: string; value: string }
export interface PayrollChangeRow { label: string; before: string; after: string; changed: boolean }
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => value === null || value === undefined || value === '' ? '待配置' : String(value);
const keys = (a: Data, b: Data) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
const performanceMode = (value: unknown) => (({ additional: '固定月薪之外另计', none: '不适用', included: '含薪（历史配置）' } as Record<string, string>)[String(value)] ?? '待配置');
const hourlyLabels: Record<string, string> = { unpaid_leave: '事假', sick_leave: '病假', absence: '确认旷工', late: '迟到', early: '早退' };
const overtimeLabels: Record<string, string> = { hourlyBase: '小时基数', weekday: '工作日倍率', restday: '休息日倍率', holiday: '节假日倍率' };
export const payrollTracePerson = (id: string) => `人员待核（${id.slice(-8)}）`;

export function parameterChanges(release: Pick<PayrollParameterRelease, 'kind' | 'snapshot' | 'previousParameterId' | 'previousSnapshot'>, person: (id: string) => string = payrollTracePerson): PayrollChangeRow[] {
  const before = object(release.previousSnapshot), after = object(release.snapshot);
  const missing = release.previousParameterId ? '原值未提供' : '首次配置';
  const rows: PayrollChangeRow[] = [];
  function add(label: string, old: unknown, next: unknown) {
    const previous = release.previousSnapshot ? text(old) : missing, current = text(next);
    rows.push({ label, before: previous, after: current, changed: previous !== current });
  }
  add('生效日期', before.effectiveFrom, after.effectiveFrom);
  add('结束日期', before.effectiveTo ?? '长期', after.effectiveTo ?? '长期');
  if (release.kind === 'standard') {
    add('固定月薪', before.fixedMonthly, after.fixedMonthly);
    add('个人绩效基数', before.performanceBase, after.performanceBase);
    add('绩效结构', performanceMode(before.performanceMode), performanceMode(after.performanceMode));
    add('确认依据', before.evidence, after.evidence);
  }
  if (release.kind === 'rule') {
    const a = object(before.config), b = object(after.config);
    const oldScope = object(a.employeeScope), nextScope = object(b.employeeScope);
    const oldIds = list(oldScope.employeeIds).map(String), nextIds = list(nextScope.employeeIds).map(String);
    const names = (ids: string[]) => ids.length ? ids.map(person).join('、') : '无';
    add('发薪人员', names(oldIds), names(nextIds));
    add('发薪范围依据', oldScope.evidenceRef, nextScope.evidenceRef);
    if (release.previousSnapshot || !release.previousParameterId) {
      const added = nextIds.filter(id => !oldIds.includes(id)), removed = oldIds.filter(id => !nextIds.includes(id));
      if (added.length) add('发薪人员 · 新增', '无', names(added));
      if (removed.length) add('发薪人员 · 移除', names(removed), '无');
    }
    const basis = (value: unknown) => value === 'monthly_workdays' ? '按当月应出勤工作日' : '待配置';
    add('固定工资折算', basis(a.fixedSalaryBasis), basis(b.fixedSalaryBasis));
    const rounding = (value: unknown) => value === 'item_half_up' ? '工资项汇总后四舍五入到分' : '待配置';
    add('舍入规则', rounding(a.rounding), rounding(b.rounding));
    add('正式启用归属月', a.cutoverMonth, b.cutoverMonth);
    add('正常计薪小时单价', a.normalHourly, b.normalHourly);
    for (const [key, label] of Object.entries(hourlyLabels)) add(`${label}小时待遇`, object(a.paidHourly)[key], object(b.paidHourly)[key]);
    for (const [key, label] of Object.entries(overtimeLabels)) add(`加班 · ${label}`, object(a.overtime)[key], object(b.overtime)[key]);
    const path = (value: unknown) => list(value).map(id => person(String(id))).join(' → ') || '待配置';
    add('工资复核路径（按顺序）', path(a.reviewers), path(b.reviewers));
    add('工资审批路径（按顺序）', path(a.approvers), path(b.approvers));
    for (const month of keys(object(a.monthlyUnits), object(b.monthlyUnits))) add(`${month} 计薪单位`, object(a.monthlyUnits)[month], object(b.monthlyUnits)[month]);
    for (const month of keys(object(a.workCalendars), object(b.workCalendars))) {
      const old = object(object(a.workCalendars)[month]), next = object(object(b.workCalendars)[month]);
      const days = (value: unknown) => list(value).map(day => { const row = object(day); return `${text(row.workDate)}：${text(row.units)}天`; }).join('；');
      add(`${month} 工作日日历`, days(old.days), days(next.days));
      add(`${month} 日历版本与依据`, `${text(old.sourceVersion)} · ${text(old.evidenceRef)}`, `${text(next.sourceVersion)} · ${text(next.evidenceRef)}`);
    }
    for (const month of keys(object(a.performance), object(b.performance))) {
      const old = object(object(a.performance)[month]), next = object(object(b.performance)[month]);
      const source = (value: unknown) => (({ manual: 'HR填写金额', official: '正式公示结果', fictional: '虚构验收来源' } as Record<string, string>)[String(value)] ?? '待配置');
      add(`${month} 绩效来源`, source(old.sourceKind), source(next.sourceKind));
      add(`${month} 绩效确认依据`, old.evidenceRef, next.evidenceRef);
      for (const id of keys(object(old.manualAmounts), object(next.manualAmounts))) add(`${month} 人工绩效 · ${person(id)}`, object(old.manualAmounts)[id], object(next.manualAmounts)[id]);
      for (const grade of keys(object(old.coefficients), object(next.coefficients))) add(`${month} ${grade}等系数`, object(old.coefficients)[grade], object(next.coefficients)[grade]);
      if (old.coefficientVersion || next.coefficientVersion) add(`${month} 系数表版本`, old.coefficientVersion, next.coefficientVersion);
    }
  }
  return rows;
}

export function payrollTime(value: unknown): string {
  if (typeof value !== 'string' || !value || !Number.isFinite(new Date(value).getTime())) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function payrollEvidenceRows(value: unknown): PayrollDisplayRow[] {
  const evidence = object(value), rows: PayrollDisplayRow[] = [];
  const add = (label: string, value: unknown) => { if (value !== undefined && value !== null) rows.push({ label, value: text(value) }); };
  const manual = object(evidence.manualPerformance);
  add('人工绩效工资（元）', manual.amount); add('绩效确认依据', manual.evidenceRef);
  add('本工资项调整（元）', evidence.adjustment);
  if ('openingBalanceId' in evidence) add('历史入薪依据', evidence.openingBalanceId ? '已关联期初记录' : '未关联期初记录');
  const calculated = object(evidence.calculated), calculation = object(calculated.evidence);
  for (const [index, entry] of list(calculation.entries).entries()) {
    const row = object(entry), input = object(row.input), prefix = `分段 ${index + 1}`;
    if ('fixedMonthly' in input) {
      add(`${prefix} 期间`, `${text(input.from)} 至 ${text(input.to)}`);
      add(`${prefix} 固定月薪（元）`, input.fixedMonthly);
      add(`${prefix} 应出勤 / 完整月工作日`, `${text(input.units)} / ${text(input.monthUnits)}`);
    }
    if ('performanceBase' in row) {
      add(`${prefix} 绩效基数 / 系数`, `${text(input.performanceBase)} / ${text(input.coefficient)}`);
    }
    if ('hours' in input) {
      add(`${prefix} 时长（小时）`, input.hours);
      if ('normalHourly' in input) add(`${prefix} 正常单价 / 假勤待遇`, `${text(input.normalHourly)} / ${text(input.paidHourly)}`);
      if ('hourlyBase' in input) add(`${prefix} 加班基数 / 倍率`, `${text(input.hourlyBase)} / ${text(input.multiplier)}`);
    }
    add(`${prefix} 计算金额（元）`, row.amount);
  }
  add('工资项合计（元）', calculated.amount);
  const input = object(evidence.input), parameter = object(evidence.parameter);
  if (parameter.version !== undefined) add('已审扣缴资料版本', `V${parameter.version}`);
  for (const [key, label] of [['socialInsurance', '个人社保'], ['housingFund', '个人公积金']] as const) {
    const contribution = object(evidence[key]);
    const rule = object(input[key]);
    add(`${label}规则版本`, rule.ruleVersion); add(`${label}确认依据`, rule.evidenceRef); add(`${label}缴费日期`, rule.contributionDate);
    add(`${label}合计（元）`, contribution.amount);
    for (const [index, entry] of list(contribution.entries).entries()) add(`${label}项目 ${index + 1}（元）`, object(entry).amount);
  }
  const tax = object(evidence.tax), cumulative = object(tax.cumulative);
  const taxRule = object(input.tax), opening = object(taxRule.opening);
  add('个税规则版本', taxRule.ruleVersion); add('个税确认依据', taxRule.evidenceRef);
  add('累计期初来源版本', opening.sourceVersion); add('累计期初确认依据', opening.evidenceRef);
  const taxLabels: Record<string, string> = { income: '累计收入', exemptIncome: '累计免税收入', standardDeduction: '累计减除费用', specialDeduction: '累计专项扣除', additionalDeduction: '累计专项附加扣除', otherDeduction: '累计其他扣除', taxRelief: '累计减免税额', taxPaid: '累计已扣个税' };
  for (const [key, label] of Object.entries(taxLabels)) add(`${label}（元）`, cumulative[key]);
  add('累计应纳税所得额（元）', tax.taxableIncome);
  add('结转抵减（不自动退款）（元）', tax.carryForwardCredit);
  return rows;
}

const eventLabels: Record<string, string> = { created: '创建核算批次', calculated: '完成工资核算', submitted: '提交工资复核', reviewed: '工资复核通过', approved: '工资审批通过', returned: '退回经办', withdrawn: '撤回重算', voided: '作废未付款版本', settled: '确认税前入薪', net_paid: '确认实发与扣缴', remainder_cancelled: '撤销未付安排', approve: '当前环节通过', return: '退回经办', exported: '下载批准工资表（不代表付款）' };
export function payrollTimeline(records: unknown[], person: (id: string) => string = payrollTracePerson) {
  return records.map(value => {
    const row = object(value), metadata = object(row.metadata);
    return { title: `${eventLabels[String(row.action)] ?? '其他业务记录'}${row.version !== null && row.version !== undefined ? ` · V${row.version}` : ''}`,
      time: payrollTime(row.createdAt), actor: row.actorId ? person(String(row.actorId)) : '办理人未记录',
      note: String(row.note ?? metadata.note ?? metadata.reference ?? '') };
  });
}
