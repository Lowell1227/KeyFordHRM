import { calculatePayroll, PayrollCalculationInput } from './payroll-calculator';
import { calculatePayrollDeductions } from './payroll-deductions-calculator';

const subjectId = 'fictional-subject', employeeId = 'fictional-employee';
const calculate = (input: unknown) => calculatePayrollDeductions(input as Parameters<typeof calculatePayrollDeductions>[0]);
function grossInput(fixedMonthly: string | null = '10000'): PayrollCalculationInput {
  return { segments: [{ from: '2035-11-01', to: '2035-11-30', units: '20', monthUnits: '20',
    fixedMonthly, performanceBase: '0', performanceMode: 'additional', coefficient: '1' }],
    absences: [{ hours: '0', normalHourly: '1', paidHourly: '0' }],
    overtime: [{ hours: '0', hourlyBase: '1', multiplier: '1' }],
    adjustments: [{ amount: '0', reason: 'fictional-zero-adjustment' }] };
}
function deductions(gross: string | null) {
  const contribution = (code: string) => ({ status: 'applicable', ruleVersion: 'fictional-contribution-v1',
    evidenceRef: 'fictional-contribution-basis', contributionDate: '2035-11-30', effectiveFrom: '2035-11-01', effectiveTo: '2035-11-30',
    items: [{ code, base: '1000', rate: '0.1' }] });
  return { subjectId, employeeId, payDate: '2035-12-10', gross, rounding: 'component_half_up',
    socialInsurance: contribution('pension'), housingFund: contribution('housing'),
    tax: { method: 'resident_cumulative_wage', ruleVersion: 'fictional-tax-v1', evidenceRef: 'fictional-tax-policy',
      effectiveFrom: '2035-01-01', effectiveTo: '2035-12-31', brackets: [{ upTo: null, rate: '0.1', quickDeduction: '0' }],
      opening: { subjectId, employeeId, year: 2035, confirmed: true, sourceVersion: 'fictional-cumulative-v1', evidenceRef: 'fictional-confirmed-opening',
        income: '0', exemptIncome: '0', standardDeduction: '0', specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0', taxPaid: '0' },
      current: { exemptIncome: '0', standardDeduction: '0', specialDeduction: '200', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' } } };
}

describe('tax-before and deduction calculator composition with fictional policies only', () => {
  it('uses the existing gross calculation without rewriting its five-item result or mixing contribution and pay dates', () => {
    const value = grossInput(), gross = calculatePayroll(value), frozen = JSON.stringify(gross);
    expect(gross.status).toBe('ready'); expect(gross.gross).toBe('10000.00');
    const net = calculate(deductions(gross.gross));
    expect(net).toMatchObject({ status: 'ready', gross: '10000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '980.00', net: '8820.00' });
    expect(JSON.stringify(gross)).toBe(frozen); expect(gross.items.map(item => item.code).sort()).toEqual(['fixed', 'absence', 'overtime', 'performance', 'adjustment'].sort());
    expect(value).toEqual(grossInput());
  });

  it('does not turn an unresolved existing salary standard into a zero-gross or payable result', () => {
    const gross = calculatePayroll(grossInput(null));
    expect(gross.status).toBe('needs_configuration'); expect(gross.gross).toBeNull();
    expect(calculate(deductions(gross.gross))).toMatchObject({ status: 'needs_configuration', gross: null,
      socialInsurance: null, housingFund: null, incomeTax: null, net: null });
  });

  it('recalculates only tax and net when an explicit cumulative-tax source changes, preserving the gross result', () => {
    const gross = calculatePayroll(grossInput()), first = deductions(gross.gross), next = JSON.parse(JSON.stringify(first)) as ReturnType<typeof deductions>;
    next.tax.opening.sourceVersion = 'fictional-cumulative-v2'; next.tax.opening.taxPaid = '500';
    const before = calculate(first), after = calculate(next);
    expect(before).toMatchObject({ status: 'ready', incomeTax: '980.00', net: '8820.00' });
    expect(after).toMatchObject({ status: 'ready', incomeTax: '480.00', net: '9320.00' });
    expect(before.evidence.sourceHash).not.toBe(after.evidence.sourceHash);
    expect(gross.gross).toBe('10000.00'); expect(first.tax.opening.taxPaid).toBe('0');
  });
});
