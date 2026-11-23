import { effectivePayrollParameters } from './payroll-parameter-timeline';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const old = { id: 'old', effectiveFrom: day('2036-01-01'), effectiveTo: null, value: 'original' };
const next = { id: 'next', effectiveFrom: day('2036-12-01'), effectiveTo: day('2036-12-31'), value: 'revision' };
const links = [{ parameterId: 'next', previousParameterId: 'old' }];

describe('published payroll parameter timeline', () => {
  it('switches only on the effective date without rewriting the old version', () => {
    const before = JSON.stringify([old, next]);
    expect(effectivePayrollParameters([old, next], links, day('2036-11-30'))).toEqual([old]);
    expect(effectivePayrollParameters([old, next], links, day('2036-12-01'))).toEqual([next]);
    expect(JSON.stringify([old, next])).toBe(before);
  });
  it('never revives an old amount when a replacement expires', () => {
    expect(effectivePayrollParameters([old, next], links, day('2037-01-01'))).toEqual([]);
  });
  it('follows replacement chains and permits reviewed same-day revisions', () => {
    const third = { ...next, id: 'third', effectiveTo: null };
    expect(effectivePayrollParameters([old, next, third], [...links, { parameterId: 'third', previousParameterId: 'next' }], day('2036-12-01'))).toEqual([third]);
  });
  it('keeps unrelated overlaps visible as a conflict rather than selecting the newest', () => {
    expect(effectivePayrollParameters([old, next], [], day('2036-12-01'))).toEqual([old, next]);
  });
  it('rejects cyclic or contradictory release links', () => {
    expect(() => effectivePayrollParameters([old, next], [...links, { parameterId: 'old', previousParameterId: 'next' }], day('2036-12-01'))).toThrow();
    expect(() => effectivePayrollParameters([old, next], [...links, { parameterId: 'next', previousParameterId: 'foreign' }], day('2036-12-01'))).toThrow();
  });
});
