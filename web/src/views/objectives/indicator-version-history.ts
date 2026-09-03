import type { GoalTrackingChangeRecord } from '@/types/api.types';
import type { IndicatorVisibilityScope } from '@/types/enums';
import { indicatorVisibilitySummary } from '@/views/task/indicator-visibility';

const VERSION_ACTIONS = new Set([
  'indicator_baseline_confirmed',
  'indicator_updated',
]);

const FIELD_LABELS: Record<string, string> = {
  name: '指标名称',
  description: '指标描述',
  scoringStandard: '评分标准',
  dataSource: '数据来源',
  dataCaliber: '数据口径',
  targetValue: '目标值',
  targetValueText: '目标值',
  unit: '单位',
  weight: '权重',
  indicatorType: '指标类型',
  dimensionName: '考核维度',
  dimensionWeight: '维度权重',
  visibilityScope: '可见范围',
  visibilityScopes: '可见范围',
  sortOrder: '排序',
};

const META_FIELDS = new Set(['version', 'reason', 'approvedBy', 'submittedBy']);

export interface IndicatorVersionDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface IndicatorVersionView {
  id: string;
  version: number;
  action: string;
  actorName: string;
  createdAt: string;
  reason: string;
  isBaseline: boolean;
  isCurrent: boolean;
  businessLabel: string;
  currentBasisLabel: string;
  changes: IndicatorVersionDiff[];
  emptyMessage: string;
}

function comparableValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '未设置';
  if (Array.isArray(value)) return value.map(comparableValue).join('、') || '未设置';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function displayValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '未设置';
  if ((field === 'weight' || field === 'dimensionWeight') && typeof value === 'number') {
    return `${Math.round(value * 10_000) / 100}%`;
  }
  if (field === 'visibilityScopes' && Array.isArray(value)) {
    return indicatorVisibilitySummary(value as IndicatorVisibilityScope[], undefined);
  }
  if (field === 'visibilityScope' && typeof value === 'string') {
    return indicatorVisibilitySummary(undefined, value as IndicatorVisibilityScope);
  }
  return comparableValue(value);
}

function resolveVersion(record: GoalTrackingChangeRecord, fallback: number): number {
  const value = record.newValue?.version;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function buildDiffs(record: GoalTrackingChangeRecord): IndicatorVersionDiff[] {
  if (!record.oldValue || !record.newValue) return [];
  const keys = [...new Set([...Object.keys(record.oldValue), ...Object.keys(record.newValue)])]
    .filter((field) => !META_FIELDS.has(field) && field in FIELD_LABELS);
  return keys
    .filter((field) => comparableValue(record.oldValue?.[field]) !== comparableValue(record.newValue?.[field]))
    .map((field) => ({
      field,
      label: FIELD_LABELS[field],
      before: displayValue(field, record.oldValue?.[field]),
      after: displayValue(field, record.newValue?.[field]),
    }));
}

export function buildIndicatorVersionHistory(
  records: GoalTrackingChangeRecord[],
): IndicatorVersionView[] {
  const formalRecords = records
    .filter((record) => VERSION_ACTIONS.has(record.action))
    .sort((left, right) => (
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    ));
  const withVersions = formalRecords.map((record, index) => ({
    record,
    version: resolveVersion(record, index + 1),
  }));
  const currentVersion = Math.max(0, ...withVersions.map((item) => item.version));

  return withVersions.reverse().map(({ record, version }) => {
    const isBaseline = record.action === 'indicator_baseline_confirmed';
    return {
      id: record.id,
      version,
      action: record.action,
      actorName: record.actorName || '系统',
      createdAt: record.createdAt,
      reason: typeof record.newValue?.reason === 'string' ? record.newValue.reason : '',
      isBaseline,
      isCurrent: version === currentVersion,
      businessLabel: isBaseline ? '目标已确认' : `目标已调整（第${Math.max(1, version - 1)}次）`,
      currentBasisLabel: version === 1 ? '当前按已确认目标执行' : `当前按第${version}版目标执行`,
      changes: buildDiffs(record),
      emptyMessage: isBaseline
        ? '目标确认后形成首个正式记录。'
        : '本次正式调整未涉及可展示字段。',
    };
  });
}
