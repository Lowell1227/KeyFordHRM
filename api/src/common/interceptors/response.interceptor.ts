import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Prisma } from '@prisma/client';
import { ERROR_CODE } from '../constants/error-codes';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
  timestamp: number;
}

/**
 * 递归将 Prisma.Decimal 实例转换为 number，保证前端类型一致。
 * 注意：Date、RegExp 等内置对象保持原样；数组与嵌套对象递归处理。
 */
export function serializeDecimals<T>(value: T): T {
  if (Prisma.Decimal.isDecimal(value)) {
    return (value as Prisma.Decimal).toNumber() as unknown as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = serializeDecimals((value as Record<string, unknown>)[key]);
    }
    return result as T;
  }

  return value;
}

/**
 * 统一响应包装：{ code, message, data, timestamp }。
 * 文件流（StreamableFile，如 Excel 导出）原样透传，不包装。
 * 返回数据中的 Prisma.Decimal 会被递归转换为 number。
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T | StreamableFile> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T | StreamableFile> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          code: ERROR_CODE.SUCCESS,
          message: 'success',
          data: data == null ? null : serializeDecimals(data),
          timestamp: Date.now(),
        };
      }),
    );
  }
}
