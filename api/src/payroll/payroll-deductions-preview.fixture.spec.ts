import { calculatePayrollDeductions, PayrollDeductionsInput } from './payroll-deductions-calculator';

const fixture = (month = '2035-11', payDate = '2035-12-10') =>
  require('./payroll-deductions-preview.fixture').fictionalDeductionsInput({
    subjectId: 'fictional-subject', employeeId: 'fictional-employee', month, payDate, gross: '10000.00',
  }) as PayrollDeductionsInput;

describe('fictional deduction preview input (not a payroll policy)', () => {
  it('uses explicit fictional contributions, deductions and confirmed zero opening', () => {
    const input = fixture();
    expect(input.socialInsurance.items).toEqual([{ code: 'fictional-social', base: '1000', rate: '0.1' }]);
    expect(input.housingFund.items).toEqual([{ code: 'fictional-housing', base: '1000', rate: '0.1' }]);
    expect(input.tax.current).toEqual({ exemptIncome: '0', standardDeduction: '0', specialDeduction: '200',
      additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' });
    expect(input.tax.opening).toMatchObject({ subjectId: input.subjectId, employeeId: input.employeeId,
      confirmed: true, year: 2035, income: '0', taxPaid: '0', exemptIncome: '0', standardDeduction: '0',
      specialDeduction: '0', additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' });
    expect(calculatePayrollDeductions(input)).toMatchObject({ status: 'ready', gross: '10000.00',
      socialInsurance: '100.00', housingFund: '100.00', incomeTax: '980.00', net: '8820.00' });
  });

  it.each([['2035-12', '2036-01-10', '2035-12-31', 2036],
    ['2036-02', '2036-03-10', '2036-02-29', 2036]])(
    'keeps contribution month %s independent of explicit pay date %s', (month, payDate, last, year) => {
      const input = fixture(month, payDate);
      expect(input.socialInsurance.contributionDate).toBe(last);
      expect(input.housingFund.contributionDate).toBe(last);
      expect(input.tax.opening.year).toBe(year);
      expect(input.tax.effectiveFrom).toBe(`${year}-01-01`);
      expect(calculatePayrollDeductions(input).status).toBe('ready');
    });

  it('creates independent objects so a missing parameter never contaminates a later calculation', () => {
    const first = fixture();
    delete (first.tax.current as Partial<typeof first.tax.current>).specialDeduction;
    expect(calculatePayrollDeductions(first)).toMatchObject({ status: 'needs_configuration', net: null });
    expect(calculatePayrollDeductions(fixture()).status).toBe('ready');
  });
});
