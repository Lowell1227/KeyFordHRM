import { PerfGrade } from '@prisma/client';

export function expectCloseTo(actual: number | null | undefined, expected: number, precision = 2) {
  expect(actual).not.toBeNull();
  expect(Number(actual)).toBeCloseTo(expected, precision);
}

export function assertNoCoefficientKey(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoCoefficientKey(obj[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as object);
    expect(keys).not.toContain('coefficient');
    for (const [k, v] of Object.entries(obj as object)) {
      assertNoCoefficientKey(v, `${path}.${k}`);
    }
  }
}

export function gradeFromScore(score: number): PerfGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}
