import { Prisma } from '@prisma/client';
import { readReviewedDeductions } from './payroll-reviewed-deductions';
import { fictionalDeductionsInput } from './payroll-deductions-preview.fixture';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollHash } from './payroll-transaction';

const input = { subjectId: 'subject', employeeId: 'employee', domain: 'validation', payDate: '2035-12-10', gross: '10000' };
function fixture() {
  const facts = fictionalDeductionsInput({ ...input, month: '2035-11' });
  const { subjectId, employeeId, year, ...opening } = facts.tax.opening;
  const { gross, payDate, subjectId: s, employeeId: e, ...settings } = facts;
  const row: any = { id: 'profile', ...input, payDate: new Date(input.payDate), effectiveFrom: new Date(input.payDate), effectiveTo: new Date(input.payDate),
    version: 1, status: 'active', settings: { ...settings, tax: { ...settings.tax, opening } } };
  row.releases = [{ id: 'release', submittedById: 'hr', reviewerId: 'manager', parameterVersion: 1, snapshotHash: payrollHash(payrollParameterDefinition('deduction', row)) }];
  const model = { findFirst: jest.fn(async () => row as Prisma.PayrollDeductionProfileGetPayload<any>) };
  const read = () => readReviewedDeductions({ payrollDeductionProfile: model } as any, input);
  return { row, model, read };
}
describe('saved deduction calculations require a reviewed exact payment identity', () => {
  it('calculates from reviewed settings and server gross, with immutable parameter references', async () => {
    const { read, model } = fixture(), result = await read();
    expect(result).toMatchObject({ status: 'ready', gross: '10000.00', socialInsurance: '100.00', housingFund: '100.00', incomeTax: '980.00', net: '8820.00' });
    expect(result.evidence.parameter).toMatchObject({ id: 'profile', version: 1, releaseId: 'release' });
    expect(model.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { subjectId: input.subjectId, employeeId: input.employeeId, domain: input.domain, payDate: new Date(input.payDate), status: 'active' } }));
  });
  it('does not fall back to fictional defaults for missing, unreviewed or changed records', async () => {
    const a = fixture(); a.model.findFirst.mockResolvedValue(null as never);
    expect((await a.read()).net).toBeNull();
    const b = fixture(); b.row.releases = [];
    expect((await b.read()).net).toBeNull();
    const c = fixture(); c.row.settings.tax.current.specialDeduction = '0';
    expect((await c.read()).net).toBeNull();
  });
});
