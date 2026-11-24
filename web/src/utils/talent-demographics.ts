interface Demographics {
  birthYear?: number | null;
  birthMonth?: number | null;
  reportedAge?: number | null;
}

export function formatTalentBirth(item: Demographics): string {
  if (item.birthYear == null) return '—';
  return `${item.birthYear}年${item.birthMonth == null ? '' : `${item.birthMonth}月`}`;
}
export function formatReportedTalentAge(item: Demographics): string {
  return item.reportedAge == null ? '—' : `${item.reportedAge}岁`;
}
