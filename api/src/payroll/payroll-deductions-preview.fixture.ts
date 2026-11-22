import type { PayrollContributionRule, PayrollDeductionsInput } from './payroll-deductions-calculator';
import { payrollDate, payrollMonth } from './payroll-transaction';

// Fictional demonstration facts only; never persist these as a payroll policy.
export function fictionalDeductionsInput(input: {
  subjectId: string; employeeId: string; month: string; payDate: string; gross: string;
}): PayrollDeductionsInput {
  const { start, end } = payrollMonth(input.month);
  const year = payrollDate(input.payDate).getUTCFullYear();
  const contribution = (code: string): PayrollContributionRule => ({
    status: 'applicable', ruleVersion: 'fictional-preview-contribution-v1', evidenceRef: 'fictional-preview-contribution-basis',
    contributionDate: end.toISOString().slice(0, 10), effectiveFrom: start.toISOString().slice(0, 10),
    effectiveTo: end.toISOString().slice(0, 10), items: [{ code, base: '1000', rate: '0.1' }],
  });
  return {
    subjectId: input.subjectId, employeeId: input.employeeId, payDate: input.payDate, gross: input.gross,
    rounding: 'component_half_up', socialInsurance: contribution('fictional-social'), housingFund: contribution('fictional-housing'),
    tax: {
      method: 'resident_cumulative_wage', ruleVersion: 'fictional-preview-tax-v1', evidenceRef: 'fictional-preview-tax-policy',
      effectiveFrom: `${year}-01-01`, effectiveTo: `${year}-12-31`, brackets: [{ upTo: null, rate: '0.1', quickDeduction: '0' }],
      opening: {
        subjectId: input.subjectId, employeeId: input.employeeId, year, confirmed: true,
        sourceVersion: 'fictional-preview-zero-opening-v1', evidenceRef: 'fictional-preview-confirmed-zero-opening',
        income: '0', taxPaid: '0', exemptIncome: '0', standardDeduction: '0', specialDeduction: '0',
        additionalDeduction: '0', otherDeduction: '0', taxRelief: '0',
      },
      current: { exemptIncome: '0', standardDeduction: '0', specialDeduction: '200',
        additionalDeduction: '0', otherDeduction: '0', taxRelief: '0' },
    },
  };
}
