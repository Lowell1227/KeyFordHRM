import { BadRequestException } from '@nestjs/common';
import { IndicatorVisibilityScope, Prisma } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';

export interface IndicatorVisibilityScopeSelection {
  visibilityScope?: IndicatorVisibilityScope;
  visibilityScopes?: IndicatorVisibilityScope[];
}

const VISIBILITY_SCOPE_ORDER = Object.values(IndicatorVisibilityScope);

export function normalizeIndicatorVisibilityScopes(
  selection: IndicatorVisibilityScopeSelection,
): IndicatorVisibilityScope[] {
  const submitted = selection.visibilityScopes?.length
    ? selection.visibilityScopes
    : selection.visibilityScope
      ? [selection.visibilityScope]
      : [];
  const supported = new Set(VISIBILITY_SCOPE_ORDER);
  const scopes = [...new Set(submitted)].filter((scope): scope is IndicatorVisibilityScope => supported.has(scope));

  if (scopes.length === 0) {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '请至少选择一个可见范围',
    });
  }
  if (scopes.length !== new Set(submitted).size) {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '可见范围无效',
    });
  }
  if (scopes.includes(IndicatorVisibilityScope.company) && scopes.length > 1) {
    throw new BadRequestException({
      code: ERROR_CODE.PARAM_INVALID,
      message: '全公司可见不能与其他范围同时选择',
    });
  }

  return VISIBILITY_SCOPE_ORDER.filter((scope) => scopes.includes(scope));
}

export function legacyVisibilityScope(scopes: IndicatorVisibilityScope[]): IndicatorVisibilityScope {
  return scopes[0] ?? IndicatorVisibilityScope.supervisors;
}

export function buildVisibilityScopeWhere(
  scope: IndicatorVisibilityScope,
): Prisma.IndicatorInstanceWhereInput {
  return {
    OR: [
      { visibilityRules: { some: { scope } } },
      {
        AND: [
          { visibilityRules: { none: {} } },
          { visibilityScope: scope },
        ],
      },
    ],
  };
}
