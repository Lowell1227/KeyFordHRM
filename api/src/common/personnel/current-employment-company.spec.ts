import { findCurrentEmploymentCompanies } from './current-employment-company';

const at = new Date('2026-11-14T16:30:00Z'); // Shanghai is already on November 15.
const row = (id: string, userId: string, contractSubjectId: string | null, extra: Record<string, unknown> = {}) => ({
  id, userId, contractSubjectId, effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
  createdAt: new Date('2026-01-01'), sourceRequestId: null, sourceRequest: null, ...extra,
});

// Interpret the query in isolated fixtures so boundary/filter mistakes change the result.
function matches(value: any, where: any): boolean {
  if (where === null || typeof where !== 'object') return value === where;
  if (where instanceof Date) return value instanceof Date && value.getTime() === where.getTime();
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === 'AND') return condition.every((part: any) => matches(value, part));
    if (key === 'OR') return condition.some((part: any) => matches(value, part));
    if (key === 'in') return condition.includes(value);
    if (key === 'lte') return value != null && value <= condition;
    if (key === 'gte') return value != null && value >= condition;
    if (key === 'not') return value != null && !matches(value, condition);
    return value != null && matches(value[key], condition);
  });
}

function fixture(records: ReturnType<typeof row>[]) {
  const findMany = jest.fn(async ({ where, orderBy, select }) => records.filter(record => matches(record, where))
    .sort((a, b) => {
      for (const ordering of orderBy) {
        const [field, direction] = Object.entries(ordering)[0];
        const left = a[field]; const right = b[field];
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        if (comparison) return direction === 'asc' ? comparison : -comparison;
      }
      return 0;
    }).map(record => Object.fromEntries(Object.keys(select).map(field => [field, record[field]]))));
  return { client: { employmentRecord: { findMany } } as any, findMany };
}

describe('current employment company identity', () => {
  it('uses the Shanghai day inclusively and excludes unapproved, cancelled and unconfirmed arrival records', async () => {
    const approved = { profileReviewStatus: 'approved', onboardingStatus: null, requiresArrivalConfirmation: false };
    const f = fixture([
      row('past', 'employee', 'past-company', { effectiveTo: new Date('2026-11-14') }),
      row('future', 'employee', 'future-company', { effectiveFrom: new Date('2026-11-16') }),
      row('valid', 'employee', 'current-company', { effectiveFrom: new Date('2026-11-15'), effectiveTo: new Date('2026-11-15'),
        sourceRequestId: 'approved', sourceRequest: approved }),
      ...[
        { profileReviewStatus: 'pending' }, { onboardingStatus: 'cancelled' },
        { onboardingStatus: 'pending_entry', requiresArrivalConfirmation: true, arrivalConfirmedAt: null },
      ].map((source, index) => row(`unqualified-${index}`, 'employee', 'wrong-company', {
        effectiveFrom: new Date('2026-11-15'), createdAt: new Date('2026-11-14'),
        sourceRequestId: `source-${index}`, sourceRequest: { ...approved, ...source },
      })),
    ]);
    expect(await findCurrentEmploymentCompanies(f.client, undefined, at))
      .toEqual(new Map([['employee', 'current-company']]));
  });

  it('chooses one overlap winner by effective date, creation time, then ID before comparing companies', async () => {
    const f = fixture([
      row('z-old-start', 'employee', 'wrong-old-company', { createdAt: new Date('2026-11-10') }),
      row('z-old-created', 'employee', 'wrong-older-created', { effectiveFrom: new Date('2026-11-01') }),
      row('a-new-created', 'employee', 'wrong-lower-id', { effectiveFrom: new Date('2026-11-01'), createdAt: new Date('2026-11-02') }),
      row('b-new-created', 'employee', 'winning-company', { effectiveFrom: new Date('2026-11-01'), createdAt: new Date('2026-11-02') }),
    ]);
    expect(await findCurrentEmploymentCompanies(f.client, undefined, at))
      .toEqual(new Map([['employee', 'winning-company']]));
  });

  it('retains a current null ID instead of falling back to old IDs, names or company codes', async () => {
    const f = fixture([
      row('older', 'hr', 'old-company'),
      row('current', 'hr', null, { effectiveFrom: new Date('2026-11-01'), company: 'fuede', companyText: 'Old company name' }),
    ]);
    expect(await findCurrentEmploymentCompanies(f.client, undefined, at)).toEqual(new Map([['hr', null]]));
  });

  it('allows legacy formal rows and completed-arrival rows, and restricts the requested user IDs', async () => {
    const f = fixture([
      row('legacy', 'legacy-user', 'company-a'),
      row('arrived', 'arrived-user', 'company-b', { sourceRequestId: 'arrived', sourceRequest: {
        profileReviewStatus: 'approved', onboardingStatus: 'effective', requiresArrivalConfirmation: true,
        arrivalConfirmedAt: new Date('2026-10-01'),
      } }),
      row('other', 'other-user', 'company-a'),
    ]);
    expect(await findCurrentEmploymentCompanies(f.client, ['legacy-user', 'arrived-user', 'legacy-user'], at))
      .toEqual(new Map([['arrived-user', 'company-b'], ['legacy-user', 'company-a']]));
  });

  it('does not query the table for an empty user list', async () => {
    const f = fixture([row('any', 'employee', 'company')]);
    expect(await findCurrentEmploymentCompanies(f.client, [], at)).toEqual(new Map());
    expect(f.findMany).not.toHaveBeenCalled();
  });
});
