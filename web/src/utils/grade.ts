import { GRADE_COLORS } from '@/types/enums';
import type { PerfGrade } from '@/types/enums';

import type { CSSProperties } from 'vue';

/** 等级展示样式。 */
export type GradeStyle = CSSProperties;

/** 根据等级获取展示样式。 */
export function getGradeStyle(grade?: PerfGrade | null): GradeStyle {
  const meta = grade ? GRADE_COLORS[grade] : undefined;
  if (meta) {
    return {
      backgroundColor: meta.bg,
      color: meta.text,
      borderColor: meta.border,
    };
  }
  return {
    backgroundColor: '#f5f5f5',
    color: '#999',
    borderColor: '#d9d9d9',
  };
}

/** 等级中文映射。 */
export const GRADE_LABELS: Record<PerfGrade, string> = {
  A: '优秀',
  B: '良好',
  C: '待改进',
  D: '不合格',
};

/** 获取等级中文标签。 */
export function getGradeLabel(grade?: PerfGrade | null): string {
  if (!grade) return '未评级';
  return GRADE_LABELS[grade] ?? grade;
}

/** 根据分数推测等级（按常见阈值，仅用于辅助展示）。 */
export function scoreToGrade(score?: number | null): PerfGrade | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

/** 等级排序权重（A最高）。 */
export const GRADE_ORDER: Record<PerfGrade, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

/** 比较两个等级，返回正数表示 a 优于 b。 */
export function compareGrade(a?: PerfGrade | null, b?: PerfGrade | null): number {
  const av = a ? GRADE_ORDER[a] : 0;
  const bv = b ? GRADE_ORDER[b] : 0;
  return av - bv;
}
