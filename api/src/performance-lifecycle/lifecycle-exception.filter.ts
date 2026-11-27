import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

export function isLifecycleDatabaseConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; message?: string; meta?: unknown };
  if (value.code === 'P2034') return true;
  if (['40001', '40P01'].includes(String(value.code))) return true;
  const details = `${value.message ?? ''} ${JSON.stringify(value.meta ?? {})}`;
  if (/PERFORMANCE_LIFECYCLE_(ENDED|CONFLICT)/.test(details)) return true;
  return value.code === 'P2010' && Boolean(value.meta && typeof value.meta === 'object'
    && ['40001', '40P01'].includes(String((value.meta as { code?: unknown }).code)));
}

// Applied only to performance controllers; never expose SQL/Prisma diagnostics for a lifecycle race.
@Catch()
export class PerformanceLifecycleExceptionFilter extends HttpExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    return super.catch(isLifecycleDatabaseConflict(error)
      ? new ConflictException('记录状态已变化或正在办理，请刷新后重试；原有结果保持不变') : error, host);
  }
}
