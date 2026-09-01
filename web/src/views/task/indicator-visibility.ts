import type { IndicatorVisibilityScope } from '@/types/enums';

export const indicatorVisibilityGroups: Array<{
  label: string;
  options: Array<{ value: IndicatorVisibilityScope; label: string }>;
}> = [
  {
    label: '汇报关系',
    options: [
      { value: 'supervisors', label: '绩效直属上级可见' },
      { value: 'direct_reports', label: '直属下属可见' },
      { value: 'all_reports', label: '全部下属可见' },
    ],
  },
  {
    label: '组织范围',
    options: [
      { value: 'department', label: '本部门可见' },
      { value: 'department_tree', label: '本部门及下级部门可见' },
    ],
  },
  {
    label: '指定范围',
    options: [{ value: 'custom', label: '自定义部门或员工' }],
  },
  {
    label: '全员',
    options: [{ value: 'company', label: '全公司可见' }],
  },
];

export const indicatorVisibilityLabels: Record<IndicatorVisibilityScope, string> = Object.fromEntries(
  indicatorVisibilityGroups.flatMap((group) => group.options.map((option) => [option.value, option.label])),
) as Record<IndicatorVisibilityScope, string>;

export function normalizeIndicatorVisibilityScopes(
  scopes: IndicatorVisibilityScope[] | null | undefined,
  legacyScope: IndicatorVisibilityScope | null | undefined,
): IndicatorVisibilityScope[] {
  const values = [
    ...new Set((scopes?.length ? scopes : [legacyScope ?? 'supervisors']).filter(Boolean)),
  ] as IndicatorVisibilityScope[];
  if (values.includes('company')) return ['company'];
  return values.length ? values : ['supervisors'];
}

export function primaryIndicatorVisibilityScope(scopes: IndicatorVisibilityScope[]): IndicatorVisibilityScope {
  return normalizeIndicatorVisibilityScopes(scopes, 'supervisors')[0];
}

export function indicatorVisibilitySummary(
  scopes: IndicatorVisibilityScope[] | null | undefined,
  legacyScope?: IndicatorVisibilityScope | null,
): string {
  return normalizeIndicatorVisibilityScopes(scopes, legacyScope)
    .map((scope) => indicatorVisibilityLabels[scope])
    .join('、');
}
