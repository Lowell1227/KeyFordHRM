import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { map } from 'rxjs/operators';

export function serializePayroll(value: unknown): unknown {
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Date || value instanceof StreamableFile || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(serializePayroll);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializePayroll(child)]));
  return value;
}

@Injectable()
export class PayrollResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) { return next.handle().pipe(map(serializePayroll)); }
}
