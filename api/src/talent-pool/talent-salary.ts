import type { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

const MAX_AMOUNT = 2147483647;

export interface StoredTalentSalary {
  expectSalaryMin: number | null;
  expectSalaryMax: number | null;
  expectSalaryUnit?: string;
}

export interface TalentSalaryInput {
  expectSalaryMin?: number | null;
  expectSalaryMax?: number | null;
  expectSalaryMinYuan?: number | null;
  expectSalaryMaxYuan?: number | null;
}

export function serializeTalentSalary<T extends StoredTalentSalary>(row: T) {
  const yuan = row.expectSalaryUnit === 'yuan';
  const salaryNeedsReview = !yuan && (row.expectSalaryMin === 999 || row.expectSalaryMax === 999);
  return { ...row,
    expectSalaryMin: yuan && row.expectSalaryMin != null ? row.expectSalaryMin / 1000 : row.expectSalaryMin,
    expectSalaryMax: yuan && row.expectSalaryMax != null ? row.expectSalaryMax / 1000 : row.expectSalaryMax,
    expectSalaryMinYuan: salaryNeedsReview || row.expectSalaryMin == null ? null : row.expectSalaryMin * (yuan ? 1 : 1000),
    expectSalaryMaxYuan: salaryNeedsReview || row.expectSalaryMax == null ? null : row.expectSalaryMax * (yuan ? 1 : 1000),
    salaryNeedsReview,
  };
}

function assertAmount(amount: number | null | undefined) {
  if (amount != null && (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT)) {
    throw new BadRequestException('期望薪资须为 0 至 2147483647 的整数');
  }
}

function assertRange(min?: number | null, max?: number | null) {
  if (min != null && max != null && min > max) throw new BadRequestException('期望薪资下限不能高于上限');
}

export function salaryWrite(input: TalentSalaryInput, before?: StoredTalentSalary): Partial<StoredTalentSalary> {
  const yuanInput = input.expectSalaryMinYuan !== undefined || input.expectSalaryMaxYuan !== undefined;
  const legacyInput = input.expectSalaryMin !== undefined || input.expectSalaryMax !== undefined;
  if (yuanInput && legacyInput) throw new BadRequestException('不能同时提交元/月与旧版 K/月薪资字段');
  if (before && !yuanInput && !legacyInput) return {};
  const unit = yuanInput || before?.expectSalaryUnit === 'yuan' ? 'yuan' : 'legacy_k';
  const bound = (field: 'expectSalaryMin' | 'expectSalaryMax') => {
    const value = yuanInput ? input[`${field}Yuan`] : input[field];
    if (value !== undefined) {
      assertAmount(value);
      return value == null ? null : value * (!yuanInput && unit === 'yuan' ? 1000 : 1);
    }
    const previous = before?.[field] ?? null;
    if (!yuanInput || before?.expectSalaryUnit === 'yuan' || previous == null) return previous;
    if (previous === 999) throw new BadRequestException('请先核对历史期望薪资，并完整填写或清空薪资区间');
    return previous * 1000;
  };
  const min = bound('expectSalaryMin'), max = bound('expectSalaryMax');
  assertAmount(min); assertAmount(max); assertRange(min, max);
  return { expectSalaryMin: min, expectSalaryMax: max, expectSalaryUnit: unit };
}

export function talentSalaryWhere(query: { salaryMin?: number; salaryMax?: number; salaryMinYuan?: number; salaryMaxYuan?: number }): Prisma.TalentCandidateWhereInput | undefined {
  const yuanInput = query.salaryMinYuan != null || query.salaryMaxYuan != null;
  const legacyInput = query.salaryMin != null || query.salaryMax != null;
  if (yuanInput && legacyInput) throw new BadRequestException('不能同时使用元/月与旧版 K/月薪资筛选');
  if (!yuanInput && !legacyInput) return undefined;
  for (const value of [query.salaryMin, query.salaryMax, query.salaryMinYuan, query.salaryMaxYuan]) assertAmount(value);
  const min = query.salaryMinYuan ?? (query.salaryMin != null ? query.salaryMin * 1000 : undefined);
  const max = query.salaryMaxYuan ?? (query.salaryMax != null ? query.salaryMax * 1000 : undefined);
  assertRange(min, max);
  return { OR: [
    { expectSalaryUnit: 'yuan',
      ...(min != null ? min > MAX_AMOUNT ? { id: { in: [] } } : { expectSalaryMax: { gte: min } } : {}),
      ...(max != null ? { expectSalaryMin: max > MAX_AMOUNT ? { not: null } : { lte: max } } : {}),
    },
    { expectSalaryUnit: 'legacy_k', AND: [
      { OR: [{ expectSalaryMin: null }, { expectSalaryMin: { not: 999 } }] },
      { OR: [{ expectSalaryMax: null }, { expectSalaryMax: { not: 999 } }] },
      ...(min != null ? [{ expectSalaryMax: { gte: Math.ceil(min / 1000) } }] : []),
      ...(max != null ? [{ expectSalaryMin: { lte: Math.floor(max / 1000) } }] : []),
    ] },
  ] };
}
