import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export function payrollHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function payrollDecimal(value: unknown, nullable = false, signed = false): Prisma.Decimal | null {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d{1,4})?$/.test(value)) throw new BadRequestException('金额或数量须为有效定点小数');
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || (!signed && amount.lt(0))) throw new BadRequestException('金额或数量不正确');
  return amount;
}
export function payrollMonth(value: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || Number(value.slice(0, 4)) < 2000) throw new BadRequestException('请选择有效的自然月');
  const start = new Date(`${value}-01T00:00:00.000Z`);
  return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)) };
}
export function payrollDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('日期格式不正确');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('日期不存在');
  return date;
}
export function assertPayrollVersion(actual: number, expected: number) {
  if (!Number.isInteger(expected) || actual !== expected) throw new ConflictException('记录已更新，请读取最新版本后重试');
}
export async function lockPayrollSubject(tx: Prisma.TransactionClient, subjectId: string, domain: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`payroll:${domain}:${subjectId}`}, 0))`;
}

// Call only after all required subject/domain locks; never from a pre-lock access check.
export async function lockPayrollAuthorization(tx: Prisma.TransactionClient, subjectId: string): Promise<void> {
  try {
    // Parameter reviewers can be direct managers without holding their own payroll grant.
    await tx.$queryRaw`SELECT "u"."id" FROM "users" AS "u"
      WHERE "u"."id" IN (
        SELECT "g"."user_id" FROM "payroll_grants" AS "g" WHERE "g"."subject_id" = ${subjectId}::uuid
        UNION
        SELECT "owner"."direct_manager_id" FROM "users" AS "owner"
          INNER JOIN "payroll_grants" AS "g" ON "g"."user_id" = "owner"."id"
          WHERE "g"."subject_id" = ${subjectId}::uuid
      ) ORDER BY "u"."id" FOR SHARE OF "u"`;
    await tx.$queryRaw`SELECT "id" FROM "payroll_grants" WHERE "subject_id" = ${subjectId}::uuid ORDER BY "id" FOR SHARE`;
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string | number } } | null;
    if (failure?.code === 'P2034' || failure?.code === '40001' || failure?.code === 'P2010' && String(failure.meta?.code) === '40001') {
      throw new ConflictException('薪酬授权或人员状态已变化，请刷新后重试，未保存本次操作');
    }
    throw error;
  }
}
