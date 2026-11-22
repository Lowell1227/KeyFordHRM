import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export function payrollHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll:${domain}:${subjectId}`}, 0))`;
}
