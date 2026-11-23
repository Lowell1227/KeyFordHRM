import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculatePayroll, PayrollAbsence, PayrollOvertime, PayrollSegment } from './payroll-calculator';
import { readPayrollPerformance, PayrollPerformanceSource } from './payroll-performance-source';
import { PayrollCapture, PayrollCapturedLine, PayrollDomain, PayrollPolicyConfig, PayrollSourceReader, PAYROLL_ITEM_CODES } from './payroll-contracts';
import { isPayrollEmployment, payrollAttendanceConflicts, payrollDays, payrollEmployments, payrollJson } from './payroll-data.service';
import { selectEmploymentAt } from '@/employee-archives/employment-timeline';
import { payrollDate, payrollHash, payrollMonth } from './payroll-transaction';
import { normalizePayrollWorkCalendar, PayrollWorkCalendar } from './payroll-work-calendar';
import { effectivePayrollParameters } from './payroll-parameter-timeline';
import { payrollParameterDefinition } from './payroll-parameter-definition';

type AttendanceDay = { employeeId: string; workDate: string; units: string | null; required: boolean | null;
  records: Array<{ type: string; state: string; hours: string; effectiveHours: string | null; resolution: string; unit: string; overtimeKind?: string }>; issues: string[] };
const D = Prisma.Decimal.clone({ precision: 40 });
function quantity(value: unknown, nonzero = false): string | null {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,4})?$/.test(value)) return null;
  const amount = new D(value); return amount.isFinite() && (nonzero ? amount.gt(0) : amount.gte(0)) ? value : null;
}
@Injectable()
export class PayrollSourcesService implements PayrollSourceReader {
  async capture(tx: Prisma.TransactionClient, subjectId: string, month: string, domain: PayrollDomain): Promise<PayrollCapture> {
    const { start, end } = payrollMonth(month), issues: string[] = [], lines: PayrollCapturedLine[] = [];
    const attendance = await tx.payrollAttendanceSnapshot.findFirst({ where: { subjectId, month, domain }, orderBy: { version: 'desc' } });
    const attendanceConflicts = await payrollAttendanceConflicts(tx, subjectId, domain, month, attendance?.payload);
    if (attendanceConflicts.length) issues.push('考勤来源存在跨月归属冲突，请先核对原月、更正及已入薪差异');
    const policies = await tx.payrollPolicy.findMany({ where: { subjectId, domain, status: 'active', effectiveFrom: { lte: end } }, orderBy: { id: 'asc' } });
    const employments = await payrollEmployments(tx, subjectId, month);
    const employees = [...new Set(employments.filter(row => row.contractSubjectId === subjectId).map(row => row.userId))].sort();
    const standards = await tx.payrollStandard.findMany({ where: { subjectId, domain, employeeId: { in: employees }, status: 'active', effectiveFrom: { lte: end } }, orderBy: { id: 'asc' } });
    const releases = await tx.payrollParameterRelease.findMany({ where: { subjectId, domain, status: 'approved', OR: [
      { rule: { is: { effectiveFrom: { lte: end } } } },
      { standard: { is: { employeeId: { in: employees }, effectiveFrom: { lte: end } } } },
    ] }, select: { id: true, standardId: true, ruleId: true, previousParameterId: true, snapshotHash: true }, orderBy: { id: 'asc' } });
    const ruleLinks = releases.filter(row => row.ruleId).map(row => ({ parameterId: row.ruleId!, previousParameterId: row.previousParameterId }));
    const standardLinks = releases.filter(row => row.standardId).map(row => ({ parameterId: row.standardId!, previousParameterId: row.previousParameterId }));
    for (const release of releases) {
      const kind = release.standardId ? 'standard' : 'rule';
      const row = release.standardId ? standards.find(value => value.id === release.standardId) : policies.find(value => value.id === release.ruleId);
      if (!row || payrollHash(payrollParameterDefinition(kind, row)) !== release.snapshotHash) issues.push('已发布参数的状态或内容与审核快照不一致，请核对版本');
    }
    const openings = await tx.payrollOpeningBalance.findMany({ where: { subjectId, domain, attributionMonth: month, employeeId: { in: employees } }, orderBy: { id: 'asc' } });
    const settlements = await tx.payrollSettlement.findMany({ where: { line: { employeeId: { in: employees }, attributionMonth: month, version: { batch: { subjectId, purpose: domain } } } },
      include: { line: { select: { employeeId: true, itemCode: true } } }, orderBy: { id: 'asc' } });
    const adjustments = await tx.payrollAdjustment.findMany({ where: { subjectId, domain, month, employeeId: { in: employees } }, orderBy: { id: 'asc' } });
    const performanceFacts: Array<{ employeeId: string; cycleId: string; result: PayrollPerformanceSource }> = [];
    const manualPerformance: Array<{ employeeId: string; month: string; workDates: string[];
      entries: Array<{ policyId: string; amount: string; evidenceRef: string }> }> = [];
    const payload = attendance?.payload as { days?: AttendanceDay[]; issues?: unknown[]; sync?: { complete?: boolean } } | undefined;
    if (!attendance || attendance.status !== 'sealed' || !attendance.sealedHash || payload?.sync?.complete !== true
      || !Array.isArray(payload?.days) || !Array.isArray(payload?.issues) || payload.issues.length) issues.push('考勤尚未完成核对封账');
    if (!employees.length) issues.push('当月没有已生效的本主体任职范围');
    const effectivePolicyIds = new Set(payrollDays(month).flatMap(date => effectivePayrollParameters(policies, ruleLinks, payrollDate(date)).map(row => row.id)));
    const configs = policies.filter(row => effectivePolicyIds.has(row.id)).map(row => row.config as unknown as PayrollPolicyConfig);
    const paths = configs.map(config => ({ reviewers: Array.isArray(config?.reviewers) ? config.reviewers : [], approvers: Array.isArray(config?.approvers) ? config.approvers : [] }));
    const first = paths[0];
    if (!first || !first.reviewers.length || !first.approvers.length || paths.some(path => JSON.stringify(path) !== JSON.stringify(first))) issues.push('复核与审批路径未配置或存在冲突');
    const approvalPath = first ? [...first.reviewers, ...first.approvers] : [];
    if (new Set(approvalPath).size !== approvalPath.length) issues.push('复核与审批身份存在重复，需核对回避规则');
    const cache = new Map<string, PayrollPerformanceSource>();
    const calendars = new Map<string, PayrollWorkCalendar | null>();
    for (const employeeId of employees) {
      const personal: string[] = [], segments: PayrollSegment[] = [], absences: PayrollAbsence[] = [], overtime: PayrollOvertime[] = [];
      const history = employments.filter(row => row.userId === employeeId);
      const employmentNumbers = new Set<string>();
      const days = Array.isArray(payload?.days) ? payload.days.filter(row => row.employeeId === employeeId) : [];
      const denominators = new Set<string>();
      const calendarVersions = new Set<string>(), bases = new Set<string>(), coefficientTables = new Set<string>();
      const modes = new Set<string>(), manualEntries = new Map<string, { policyId: string; amount: string; evidenceRef: string }>();
      const manualDates: string[] = [];
      let employedDates = 0;
      for (const date of payrollDays(month)) {
        const selection = selectEmploymentAt(history, payrollDate(date));
        if (selection.matches.length > 1) { personal.push('任职时间重叠'); continue; }
        if (!isPayrollEmployment(selection.current, subjectId, date)) continue;
        employedDates++;
        if (selection.current?.employeeNo?.trim()) employmentNumbers.add(selection.current.employeeNo.trim());
        else personal.push('当期任职工号待核对');
        const dayMatches = days.filter(row => row.workDate === date);
        if (dayMatches.length !== 1) { personal.push('自然月考勤覆盖缺失或重复'); continue; }
        const day = dayMatches[0];
        if (day.issues?.length) personal.push('考勤仍有待核对项目');
        const matches = effectivePayrollParameters(standards.filter(row => row.employeeId === employeeId), standardLinks, payrollDate(date));
        const ruleMatches = effectivePayrollParameters(policies, ruleLinks, payrollDate(date));
        if (matches.length !== 1 || ruleMatches.length !== 1) { personal.push('工资标准或规则缺失/生效区间冲突'); continue; }
        const standard = matches[0], policy = ruleMatches[0], config = policy.config as unknown as PayrollPolicyConfig;
        const strict = domain === 'formal' || config?.fixedSalaryBasis === 'monthly_workdays';
        bases.add(strict ? 'monthly_workdays' : 'legacy_validation');
        let denominator = quantity(config?.monthlyUnits?.[month], true), units = quantity(day.units);
        if (strict) {
          if (config?.fixedSalaryBasis !== 'monthly_workdays') { personal.push('固定工资须配置已确认的工作日折算依据'); continue; }
          if (!calendars.has(policy.id)) {
            try { calendars.set(policy.id, normalizePayrollWorkCalendar(month, config.workCalendars?.[month])); }
            catch { calendars.set(policy.id, null); }
          }
          const calendar = calendars.get(policy.id);
          if (!calendar) { personal.push('完整月工作日日历、来源版本或确认依据待配置'); continue; }
          calendarVersions.add(payrollHash(calendar));
          const fullMonth = calendar.days.reduce((sum, row) => sum.plus(row.units), new D(0));
          if (config.monthlyUnits?.[month] !== undefined && (!denominator || !fullMonth.eq(denominator))) {
            personal.push('计薪分母须等于同一日历的完整月应出勤工作日'); continue;
          }
          denominator = fullMonth.toString();
          const scheduled = calendar.days.find(row => row.workDate === date)!;
          if (units === null || !new D(units).eq(scheduled.units) || day.required !== new D(scheduled.units).gt(0)) {
            personal.push('考勤应出勤单位与工作日日历不一致，请核对，不能按实打卡折算'); continue;
          }
          units = scheduled.units;
        }
        if (!denominator || units === null || config?.rounding !== 'item_half_up' || !config.cutoverMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(config.cutoverMonth)) {
          personal.push('当月计薪单位、启用切点或舍入规则待配置'); continue;
        }
        denominators.add(new D(denominator).toString());
        let coefficient: string | null = null;
        const manual = config.performance?.[month]?.sourceKind === 'manual';
        modes.add(standard.performanceMode === 'none' ? 'none' : manual ? 'manual' : 'automatic');
        if (manual && standard.performanceMode !== 'none') {
          const mapping = config.performance[month], amount = mapping.manualAmounts?.[employeeId];
          manualDates.push(date);
          if (standard.performanceMode !== 'additional') personal.push('人工绩效须在固定月薪之外另计');
          if (typeof amount !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(amount) || !mapping.evidenceRef?.trim()) personal.push('人工绩效工资金额或确认依据待补充');
          else manualEntries.set(policy.id, { policyId: policy.id, amount: new D(amount).toFixed(2), evidenceRef: mapping.evidenceRef.trim() });
        } else if (manual && config.performance[month].manualAmounts?.[employeeId] !== undefined) {
          personal.push('该员工绩效结构为不适用，请核对人工金额与工资标准');
        } else if (standard.performanceMode !== 'none') {
          const mapping = config.performance?.[month];
          if (strict) {
            if (!mapping?.coefficientVersion?.trim() || !mapping.evidenceRef?.trim()) personal.push('统一绩效系数表版本与确认依据待配置');
            else coefficientTables.add(payrollHash({ version: mapping.coefficientVersion, evidenceRef: mapping.evidenceRef,
              coefficients: mapping.coefficients }));
            if (standard.performanceMode !== 'additional') personal.push('首版个人绩效须在固定月薪之外另计');
          }
          if (!mapping || !Array.isArray(mapping.cycleIds) || mapping.cycleIds.length !== 1
            || mapping.sourceKind !== (domain === 'validation' ? 'fictional' : 'official')) personal.push('个人绩效计薪周期未登记或存在多个来源');
          else {
            const cycleId = mapping.cycleIds[0], key = `${employeeId}:${cycleId}:${strict ? month : 'legacy_validation'}`;
            let source = cache.get(key);
            if (!source) {
              source = await readPayrollPerformance(tx, { employeeId, cycleId, registeredCycleIds: mapping.cycleIds,
                ...(strict ? { requiredMonth: month } : {}) });
              cache.set(key, source); performanceFacts.push({ employeeId, cycleId, result: source });
            }
            if (source.status !== 'ready') {
              const labels: Partial<Record<PayrollPerformanceSource['status'], string>> = {
                unsupported_cycle: '须使用正式月度考核结果，不能使用季度过程评分', wrong_period: '考核期间与工资归属月不一致',
                pending_publication: '个人结果尚未公示', in_review: '个人结果仍在审核或申诉中',
                fact_conflict: '个人公示记录不一致', not_found: '未找到该员工的考核结果',
                not_applicable: '该考核结果不适用于计薪', unregistered: '考核来源尚未登记',
              };
              personal.push(`个人绩效来源待核对：${labels[source.status] ?? source.status}`);
            }
            else {
              if (!strict || mapping.coefficientVersion?.trim() && mapping.evidenceRef?.trim()) coefficient = quantity(mapping.coefficients?.[source.snapshot.grade]);
              if (coefficient === null) personal.push('薪酬侧等级系数待配置');
            }
          }
        }
        if (!['included', 'additional', 'none'].includes(standard.performanceMode ?? '')) personal.push('工资结构待配置');
        segments.push({ from: date, to: date, units, monthUnits: denominator, fixedMonthly: standard.fixedMonthly?.toString() ?? null,
          performanceBase: manual ? null : standard.performanceBase?.toString() ?? null,
          performanceMode: manual ? 'none' : standard.performanceMode as PayrollSegment['performanceMode'], coefficient });
        for (const record of day.records ?? []) {
          if (record.state !== 'effective' || record.resolution !== 'usable') continue;
          const hours = quantity(record.effectiveHours);
          if (record.unit !== 'hour' || hours === null) { personal.push('原始时长单位或数量待核对'); continue; }
          if (['unpaid_leave', 'sick_leave', 'absence'].includes(record.type)) {
            const paidHourly = quantity(config.paidHourly?.[record.type as keyof PayrollPolicyConfig['paidHourly']]), normalHourly = quantity(config.normalHourly);
            if (paidHourly === null || normalHourly === null) personal.push('假勤待遇或正常计薪单位价待配置');
            else absences.push({ hours, normalHourly, paidHourly });
          }
          if (record.type === 'overtime') {
            const kind = record.overtimeKind;
            const rate = kind && ['weekday', 'restday', 'holiday'].includes(kind) ? quantity(config.overtime?.[kind as 'weekday' | 'restday' | 'holiday']) : null;
            const base = quantity(config.overtime?.hourlyBase);
            if (rate === null || base === null) personal.push('加班性质、应付小时基数或倍率待配置');
            else overtime.push({ hours, hourlyBase: base, multiplier: rate });
          }
        }
      }
      if (calendarVersions.size > 1 || bases.size > 1) personal.push('当月固定工资折算依据或工作日日历存在冲突');
      if (coefficientTables.size > 1) personal.push('当月统一绩效系数表版本存在冲突');
      if (performanceFacts.filter(row => row.employeeId === employeeId).length > 1) personal.push('同一归属月存在多个考核来源，请登记唯一的个人月度结果');
      if (modes.has('manual') && modes.size > 1) personal.push('同一归属月不能混用人工绩效与自动绩效或不适用结构');
      const entries = [...manualEntries.values()].sort((a, b) => a.policyId.localeCompare(b.policyId));
      if (new Set(entries.map(entry => JSON.stringify([entry.amount, entry.evidenceRef]))).size > 1) personal.push('当月人工绩效金额或确认依据存在冲突');
      if (modes.has('manual')) manualPerformance.push({ employeeId, month, workDates: manualDates, entries });
      if (bases.has('monthly_workdays') && segments.some(segment => segment.performanceMode !== 'none')
        && (employedDates !== payrollDays(month).length || new Set(segments.map(segment =>
          JSON.stringify([segment.performanceMode, segment.performanceBase]))).size > 1)) {
        personal.push('月中入离职或绩效基数变更的绩效计发比例待确认');
        for (const segment of segments) if (segment.performanceMode !== 'none') segment.coefficient = null;
      }
      if (denominators.size !== 1) personal.push('当月计薪单位缺失或规则间不一致');
      if (employmentNumbers.size !== 1) personal.push('当期任职工号缺失或存在多个值');
      const calculated = calculatePayroll({ segments, absences, overtime, adjustments: [] });
      if (calculated.status !== 'ready') personal.push('分段计算依据不完整或存在冲突');
      for (const code of PAYROLL_ITEM_CODES) {
        const item = calculated.items.find(row => row.code === code);
        const manualAmount = code === 'performance' && modes.has('manual') ? entries[0]?.amount : undefined;
        const notApplicable = calculated.status === 'ready' && !item && (
          (code === 'performance' && !modes.has('manual') && segments.every(segment => segment.performanceMode === 'none'))
          || (code === 'absence' && !absences.length) || (code === 'overtime' && !overtime.length) || code === 'adjustment');
        const authorized = adjustments.filter(row => row.employeeId === employeeId && row.itemCode === code);
        const adjustment = authorized.reduce((sum, row) => sum.plus(row.amount), new D(0));
        let entitlement = manualAmount !== undefined || item || notApplicable ? new D(manualAmount ?? item?.amount ?? '0').plus(adjustment).toDecimalPlaces(2, D.ROUND_HALF_UP) : null;
        if (entitlement && entitlement.abs().gt('99999999999999.99')) { entitlement = null; personal.push('金额超出核算范围'); }
        const opening = openings.find(row => row.employeeId === employeeId && row.itemCode === code);
        const confirmed = Boolean(opening?.confirmedAt && opening.confirmedById && opening.reference?.trim() && opening.amount !== null);
        const paid = confirmed ? settlements.filter(row => row.line.employeeId === employeeId && row.line.itemCode === code)
          .reduce((sum, row) => sum.plus(row.amount), new D(opening!.amount!)) : null;
        const pending = !confirmed;
        if (pending) personal.push('期初入薪金额待确认（包括明确的零）');
        const complete = !personal.length && entitlement !== null && paid !== null;
        lines.push({ employeeId, attributionMonth: month, itemCode: code, status: !complete ? 'needs_configuration' : notApplicable && entitlement!.eq(0) && paid!.eq(0) ? 'not_applicable' : 'ready',
          entitlement: entitlement?.toFixed(2) ?? null, paidBefore: paid?.toFixed(2) ?? null,
          amount: complete ? entitlement!.minus(paid!).toFixed(2) : null,
          evidence: payrollJson({ employeeName: history[0]?.user.name, employeeNo: employmentNumbers.size === 1 ? [...employmentNumbers][0] : null, calculated: item ?? null,
            ...(manualAmount !== undefined ? { manualPerformance: { amount: manualAmount, evidenceRef: entries[0].evidenceRef, policyIds: entries.map(entry => entry.policyId) } } : {}),
            applicability: notApplicable ? 'not_applicable' : 'applicable', adjustment: adjustment.toFixed(2), adjustmentIds: authorized.map(row => row.id), openingBalanceId: opening?.id ?? null,
            settlementIds: settlements.filter(row => row.line.employeeId === employeeId && row.line.itemCode === code).map(row => row.id) }) });
      }
      if (personal.length) issues.push(`${employeeId}：${[...new Set(personal)].join('；')}`);
    }
    if (issues.length) for (const line of lines) if (line.status === 'ready' || line.status === 'not_applicable') { line.status = 'blocked_batch'; line.amount = null; }
    const sources = payrollJson({ subjectId, month, domain, attendance, ...(attendanceConflicts.length ? { attendanceConflicts } : {}), policies, standards,
      ...(releases.length ? { parameterReleases: releases } : {}),
      employments: employments.filter(row => row.contractSubjectId === subjectId).map(row => ({ ...row,
        user: { id: row.user.id, name: row.user.name } })), scopeIssues: [...new Set(issues)], openings,
      settlements, adjustments, ...(manualPerformance.length ? { manualPerformance } : {}),
      performance: performanceFacts.sort((a, b) => `${a.employeeId}:${a.cycleId}`.localeCompare(`${b.employeeId}:${b.cycleId}`)) });
    return { sourceHash: payrollHash(sources), sources, issues: [...new Set(issues)], lines, approvalPath,
      reviewerCount: first?.reviewers.length ?? 0, gross: issues.length ? null : lines.reduce((sum, row) => sum.plus(row.amount ?? '0'), new D(0)).toFixed(2) };
  }
}
