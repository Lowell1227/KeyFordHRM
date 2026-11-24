import { contractDeadline, digestBody, digestDay, projectApplication } from './personnel-digest';

const date = (day: string) => new Date(day + 'T00:00:00Z');
const labor = (start: string, end?: string) => ({
  id: start, contractType: 'labor', isActive: true, effectiveFrom: date(start),
  expiresAt: end ? date(end) : null, termType: end ? null : '无固定期限',
});

describe('personnel digest', () => {
  it('uses Shanghai business dates and keeps weekends', () => {
    expect(digestDay(new Date('2026-11-27T23:40:00Z'))).toEqual({ day: '2026-11-28', time: '07:40' });
  });

  it('reminds once per active employee with a contract deadline and respects a continuous renewal', () => {
    const old = labor('2025-01-01', '2026-12-01');
    expect(contractDeadline([old], '2026-11-24', '2026-12-24')).toBe('2026-12-01');
    expect(contractDeadline([old, labor('2026-12-02')], '2026-11-24', '2026-12-24')).toBeNull();
    expect(contractDeadline([old, labor('2026-12-05')], '2026-11-24', '2026-12-24')).toBe('2026-12-01');
    expect(contractDeadline([old], '2026-12-04', '2026-12-31')).toBe('2026-12-01');
    for (const contractType of ['contract', 'renewal', 'transfer']) {
      expect(contractDeadline([{ ...old, contractType }], '2026-11-24', '2026-12-24')).toBe('2026-12-01');
    }
    expect(contractDeadline([{ ...old, contractType: 'attachment' }], '2026-11-24', '2026-12-24')).toBeNull();
  });

  it('requires an approved due arrival and limits returned tasks to their creator', () => {
    const pending = { id: 'request', employeeName: '虚构姓名', createdById: 'hr1', intakeType: 'new_hire',
      requiresArrivalConfirmation: true, onboardingStatus: 'pending_entry', profileReviewStatus: 'approved',
      performanceReviewStatus: 'not_required', arrivalConfirmedAt: null,
      proposedValue: { employee: { entryDate: '2026-11-24' } } };
    expect(projectApplication(pending, 'hr1', '2026-11-23')).toBeNull();
    expect(projectApplication(pending, 'hr1', '2026-11-24')).toMatchObject({ kind: 'arrival', due: '2026-11-24' });
    const returned = { ...pending, profileReviewStatus: 'rejected' };
    expect(projectApplication(returned, 'hr2', '2026-11-24')).toBeNull();
    expect(projectApplication(returned, 'hr1', '2026-11-24')).toMatchObject({ kind: 'returned' });
  });

  it('posts counts and the entry link without employee names, dates, or record IDs', () => {
    const item = { id: 'private-id', employee: '虚构姓名', kind: 'arrival' as const, due: '2026-11-01',
      next: '内部处理说明', link: '/entry-exit?requestId=private-id' };
    const body = digestBody('2026-11-24', [item], 'https://example.com/personnel-digest');
    expect(body.markdown.text).toContain('逾期 1 项');
    expect(body.markdown.text).toContain('到岗待确认 1');
    expect(body.markdown.text).toContain('https://example.com/personnel-digest');
    for (const forbidden of ['虚构姓名', 'private-id', '2026-11-01', '内部处理说明']) {
      expect(body.markdown.text).not.toContain(forbidden);
    }
    expect(digestBody('2026-11-24', [], 'https://example.com/personnel-digest').markdown.text)
      .toContain('今日暂无待办');
  });

  it('separates upcoming, today and overdue reminders and lists time remaining in order', () => {
    const contracts = ['2026-12-17', '2026-11-24', '2026-11-23', '2026-12-01', '2026-12-01'].map(due => ({
      id: 'private-id', employee: '虚构姓名', kind: 'contract' as const, due, next: '', link: '',
    }));
    const { markdown } = digestBody('2026-11-24', contracts, 'https://example.com/personnel-digest');
    expect(markdown.text).toContain('**到期提醒**');
    expect(markdown.text).toContain('**合同** · 即将到期 3 项 · 今日到期 1 项 · 已逾期 1 项');
    expect(markdown.text).toContain('剩 7 天 2 项、剩 23 天 1 项');
    expect(markdown.text).toContain('合同未来 30 天、试用期未来 14 天');
    expect(markdown.text).not.toContain('2026-12-01');
    expect(markdown.text).not.toContain('2026-12-17');
    expect(markdown.text).not.toContain('虚构姓名');
  });
});
