import { currentArchiveIssues, currentArchiveFactsSelect } from './employee-archive-current-issues';

const day = (v: string) => new Date(v + 'T00:00:00Z');
const contract = (id: string, extra: any = {}) => ({ id, contractType: 'contract', name: '劳动合同', isActive: true,
  effectiveFrom: day('2025-01-01'), expiresAt: day('2027-12-31'), signingCompany: '虚构甲公司', ...extra });
function issue(a: any, b: any): any {
  return currentArchiveIssues({ id: 'synthetic', accountType: 'employee', status: 'active', entryDate: day('2020-01-01'),
    deptId: 'dept', employeeContracts: [a, b] }, { at: day('2026-11-25') }).find(i => i.id === 'current:contract-overlap')!;
}
describe('readable contract overlap explanations without changing decisions', () => {
  it.each(['兼职协议', '实习协议'])('describes %s to labor as a possible replacement, not a date error', name => {
    const result = issue(contract('old', { name }), contract('new', { effectiveFrom: day('2025-09-01') }));
    expect(result.details).toEqual([expect.objectContaining({ title: `${name.includes('兼职') ? '兼职' : '实习'}转劳动合同待核对`,
      records: expect.stringContaining('2025-09-01'), suggestion: expect.stringContaining('替代') })]);
  });
  it('shows retirement replacement separately', () => {
    expect(issue(contract('old'), contract('new', { name: '退休返聘', effectiveFrom: day('2026-01-01') })).details![0].title).toContain('退休返聘');
  });
  it('shows a same-day handover and its exact overlap without guessing a new end date', () => {
    const detail = issue(contract('old', { expiresAt: day('2026-01-01') }), contract('new', { contractType: 'renewal', effectiveFrom: day('2026-01-01') })).details![0];
    expect(detail.title).toContain('衔接'); expect(detail.reason).toContain('1天'); expect(detail.suggestion).toContain('不自动修改');
  });
  it('distinguishes a missing company, mismatched company, and confirmed-shaped transfer', () => {
    const transfer = contract('new', { contractType: 'transfer', effectiveFrom: day('2026-01-01'), originalCompany: '虚构甲公司', newCompany: '虚构乙公司' });
    expect(issue(contract('old', { signingCompany: null }), transfer).details![0].title).toContain('主体待补充');
    expect(issue(contract('old', { signingCompany: '虚构丙公司' }), transfer).details![0].title).toContain('主体关系待核对');
    expect(issue(contract('old'), transfer).details![0].title).toContain('公司转签');
    expect(issue(contract('old'), { ...transfer, newCompany: null }).details![0].reason).toContain('转入公司');
    const prior = contract('old', { contractType: 'transfer', newCompany: null, signingCompany: '虚构甲公司' });
    expect(issue(prior, transfer).details![0].records).toContain('虚构甲公司');
  });
  it('identifies repeated transfers and unmarked company changes', () => {
    const a = contract('a', { contractType: 'transfer', originalCompany: '虚构甲公司', newCompany: '虚构乙公司' });
    const b = { ...a, id: 'b', effectiveFrom: day('2026-01-01') };
    expect(issue(a, b).details![0].title).toContain('重复转签');
    expect(issue(contract('a'), contract('b', { signingCompany: '虚构乙公司', effectiveFrom: day('2026-01-01') })).details![0].title).toContain('公司变更');
  });
  it('includes all pairs, stable contract identities and no sensitive text', () => {
    const a = contract('a', { name: '劳动合同13812345678' }), b = contract('b');
    const result = issue(a, b);
    expect(result.details![0].records).toContain('合同'); expect(JSON.stringify(result.details)).not.toContain('13812345678');
    const originalFingerprint = result.fingerprint;
    b.signingCompany = '更正公司'; expect(issue(a, b).fingerprint).toBe(originalFingerprint);
    const u = { id: 'synthetic', accountType: 'employee', status: 'active', entryDate: day('2020-01-01'), deptId: 'dept', employeeContracts: [a, b, contract('c')] };
    const multiple: any = currentArchiveIssues(u).find(i => i.id === result.id)!;
    expect(multiple.details).toHaveLength(3);
    expect(currentArchiveIssues(u, { exemptions: [{ issueId: multiple.id, fingerprint: multiple.fingerprint, isExempt: true }] })).toEqual([]);
  });
  it('selects company and agreement metadata for list and digest projections too', () => {
    expect(currentArchiveFactsSelect.employeeContracts.select).toMatchObject({ signingCompany: true, originalCompany: true, newCompany: true });
  });
});
