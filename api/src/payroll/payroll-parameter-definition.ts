import { Prisma } from '@prisma/client';

export type PayrollParameter = Prisma.PayrollStandardGetPayload<{}> | Prisma.PayrollPolicyGetPayload<{}> | Prisma.PayrollDeductionProfileGetPayload<{}>;
export type PayrollParameterKind = 'standard' | 'rule' | 'deduction';
export function payrollParameterDefinition(kind: PayrollParameterKind, row: PayrollParameter): Prisma.InputJsonValue {
  const standard = row as Prisma.PayrollStandardGetPayload<{}>;
  return JSON.parse(JSON.stringify({ id: row.id, kind, subjectId: row.subjectId, domain: row.domain, version: row.version,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    ...(kind === 'standard' ? { employeeId: standard.employeeId, fixedMonthly: standard.fixedMonthly?.toString() ?? null,
      performanceBase: standard.performanceBase?.toString() ?? null, performanceMode: standard.performanceMode, evidence: standard.evidence }
      : kind === 'rule' ? { config: (row as Prisma.PayrollPolicyGetPayload<{}>).config }
      : { employeeId: (row as Prisma.PayrollDeductionProfileGetPayload<{}>).employeeId,
        payDate: (row as Prisma.PayrollDeductionProfileGetPayload<{}>).payDate.toISOString().slice(0, 10),
        settings: (row as Prisma.PayrollDeductionProfileGetPayload<{}>).settings }) }));
}
