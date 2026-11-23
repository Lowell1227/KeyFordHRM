import { Prisma } from '@prisma/client';

type Parameter = Prisma.PayrollStandardGetPayload<{}> | Prisma.PayrollPolicyGetPayload<{}>;
export function payrollParameterDefinition(kind: 'standard' | 'rule', row: Parameter): Prisma.InputJsonValue {
  const standard = row as Prisma.PayrollStandardGetPayload<{}>;
  return JSON.parse(JSON.stringify({ id: row.id, kind, subjectId: row.subjectId, domain: row.domain, version: row.version,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    ...(kind === 'standard' ? { employeeId: standard.employeeId, fixedMonthly: standard.fixedMonthly?.toString() ?? null,
      performanceBase: standard.performanceBase?.toString() ?? null, performanceMode: standard.performanceMode, evidence: standard.evidence }
      : { config: (row as Prisma.PayrollPolicyGetPayload<{}>).config }) }));
}
