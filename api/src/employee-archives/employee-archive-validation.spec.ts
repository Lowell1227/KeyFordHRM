import { normalizeArchiveSubmission } from './employee-archive-validation';

describe('archive submission field validation', () => {
  const base = { employee: {}, profile: {}, contracts: [] };

  it.each(['leading', 'trailing', 'both'])('returns the validated 50-character text after removing %s whitespace', side => {
    const text = 'X'.repeat(50);
    const education = `${side !== 'trailing' ? ' ' : ''}${text}${side !== 'leading' ? ' ' : ''}`;
    const input = { employee: {}, profile: { education } };
    expect(normalizeArchiveSubmission(input, base).profile.education).toBe(text);
    expect(input.profile.education).toBe(education);
    expect(() => normalizeArchiveSubmission({ employee: {}, profile: { education: ` ${text}X ` } }, base))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({
        data: { fieldErrors: { 'profile.education': '最多填写 50 个字符' } },
      }) }));
  });

  it.each([' 2024-02-29 ', ' 2024-02-29T00:00:00.000Z '])('returns the normalized date that was validated: %s', birthDate => {
    expect(normalizeArchiveSubmission({ employee: {}, profile: { birthDate } }, base).profile.birthDate).toBe('2024-02-29');
  });

  it('keeps untouched historical text and equivalent stored dates without normalizing contract proposals', () => {
    const entryDate = new Date('2024-02-29');
    const contract = { contractType: 'contract', name: ` ${'X'.repeat(150)} `, signedAt: '2024-02-29' };
    const input = { employee: { jobFamily: ' Historical ', entryDate: ' 2024-02-29T00:00:00.000Z ' },
      profile: { school: ' Historical college ' }, contracts: [contract] };
    const result = normalizeArchiveSubmission(input, { employee: { jobFamily: ' Historical ', entryDate },
      profile: { school: ' Historical college ' }, contracts: [] });
    expect(result.employee).toEqual({ jobFamily: ' Historical ', entryDate });
    expect(result.profile.school).toBe(' Historical college ');
    expect(result.contracts).toEqual([contract]);
  });

  it.each(['2026', '2026-02', '2026-02-30', '0000-01-01', '2026-11-14T12:00:00Z'])('requires a real complete calendar date: %s', date => {
    expect(() => normalizeArchiveSubmission({ employee: {}, profile: { socialSecurityStartDate: date } }, base))
      .toThrow(expect.objectContaining({ response: { code: 4001, message: expect.any(String),
        data: { fieldErrors: { 'profile.socialSecurityStartDate': expect.any(String) } } } }));
  });

  it('preserves omitted values and historical date representations while normalizing explicit blank counts', () => {
    const date = new Date('2024-02-29');
    const input = { employee: { entryDate: date }, profile: { education: undefined, childrenCount: '', birthDate: '2024-02-29' } };
    const result = normalizeArchiveSubmission(input, { ...base, employee: { entryDate: date }, profile: { education: 'Old', childrenCount: 2 } });
    expect(result.employee.entryDate).toBe(date);
    expect(result.profile).toEqual({ childrenCount: null, birthDate: '2024-02-29' });
    expect(input.profile.childrenCount).toBe('');
  });
});
