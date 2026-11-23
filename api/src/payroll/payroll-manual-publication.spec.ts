import { Prisma } from '@prisma/client';
import { PayrollParameterReleasesService } from './payroll-parameter-releases.service';
import { payrollDays } from './payroll-data.service';

describe('manual performance parameter publication', () => {
  const service = new PayrollParameterReleasesService({} as any, {} as any);
  const validate = (kind: string, row: unknown) => (service as any).validate(kind, row);
  const person = '00000000-0000-4000-8000-000000000001', month = '2037-01';
  const config = () => ({ fixedSalaryBasis: 'monthly_workdays', rounding: 'item_half_up', cutoverMonth: month,
    workCalendars: { [month]: { sourceVersion: 'fictional', evidenceRef: 'Fictional approval', days: payrollDays(month).map((workDate, index) => ({ workDate, units: index < 20 ? '1' : '0' })) } },
    performance: { [month]: { sourceKind: 'manual', manualAmounts: { [person]: '1234.56' }, evidenceRef: 'HR reviewed monthly wages' } } });
  it('allows additional structure without an unused automatic performance base', () => {
    expect(() => validate('standard', { fixedMonthly: new Prisma.Decimal(10000), performanceMode: 'additional', performanceBase: null, evidence: 'Fictional fixed standard' })).not.toThrow();
  });
  it('allows manual monthly money without a publication cycle or coefficient table', () => {
    expect(() => validate('rule', { domain: 'validation', config: config() })).not.toThrow();
  });
  it('keeps manual basis and explicit amounts required at parameter publication', () => {
    const input = config(); input.performance[month].evidenceRef = '';
    expect(() => validate('rule', { domain: 'validation', config: input })).toThrow();
    input.performance[month].evidenceRef = 'Fictional'; input.performance[month].manualAmounts = {} as any;
    expect(() => validate('rule', { domain: 'validation', config: input })).toThrow();
  });
  it('resolves only identities referenced in visible manual review snapshots', async () => {
    const request = { id: 'release', kind: 'rule', snapshot: { config: config() } };
    const tx = { payrollParameterRelease: { findMany: jest.fn(async ({ where }) => where.status === 'pending' ? [request] : []) },
      user: { findMany: jest.fn(async () => [{ id: person, name: '虚构员工', employeeNo: 'FAKE-1' }]) } };
    const db = { $transaction: async callback => callback(tx) }, access = { assertDomain: async () => 'validation', maintenancePurpose: () => 'validation', assert: jest.fn() };
    const rows = await new PayrollParameterReleasesService(db as any, access as any).list('subject', { id: 'hr' } as any);
    expect((rows[0] as any).manualEmployees).toEqual([{ id: person, name: '虚构员工', employeeNo: 'FAKE-1' }]);
    expect(tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: [person] } }, select: { id: true, name: true, employeeNo: true } });
  });
});
