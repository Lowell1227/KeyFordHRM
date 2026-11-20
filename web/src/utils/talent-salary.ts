export interface TalentSalaryValue {
  expectSalaryMin?: number | null;
  expectSalaryMax?: number | null;
  expectSalaryMinYuan?: number | null;
  expectSalaryMaxYuan?: number | null;
  expectSalaryUnit?: string;
  salaryNeedsReview?: boolean;
}

export function talentSalaryYuan(value: TalentSalaryValue) {
  const needsReview = Boolean(value.salaryNeedsReview)
    || (value.expectSalaryUnit !== 'yuan' && (value.expectSalaryMin === 999 || value.expectSalaryMax === 999));
  if (needsReview) return { min: null, max: null, needsReview };
  const canonical = value.expectSalaryMinYuan !== undefined || value.expectSalaryMaxYuan !== undefined;
  return {
    min: canonical ? value.expectSalaryMinYuan ?? null : value.expectSalaryMin == null ? null : Math.round(value.expectSalaryMin * 1000),
    max: canonical ? value.expectSalaryMaxYuan ?? null : value.expectSalaryMax == null ? null : Math.round(value.expectSalaryMax * 1000),
    needsReview,
  };
}

export function formatTalentSalary(value: TalentSalaryValue, empty = '面议') {
  const { min, max, needsReview } = talentSalaryYuan(value);
  if (needsReview) return '历史薪资待核对';
  if (min == null && max == null) return empty;
  if (min != null && max != null) return `${min}–${max}元/月`;
  return min != null ? `${min}元/月以上` : `${max}元/月以下`;
}
