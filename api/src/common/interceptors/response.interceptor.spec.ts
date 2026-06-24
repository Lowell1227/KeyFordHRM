import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResponseInterceptor, serializeDecimals } from './response.interceptor';

/** 构造一个最小 ExecutionContext 和 CallHandler。 */
function createMockExecutionContext() {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('serializeDecimals', () => {
  it('应把顶层 Prisma.Decimal 转为 number', () => {
    expect(serializeDecimals(new Prisma.Decimal('12.34'))).toBe(12.34);
  });

  it('应递归处理嵌套对象中的 Decimal', () => {
    const input = {
      total: new Prisma.Decimal('99.99'),
      nested: {
        weight: new Prisma.Decimal('0.3333'),
        ignored: 'string',
      },
      createdAt: new Date('2026-01-01'),
    };
    const result = serializeDecimals(input);
    expect(result.total).toBe(99.99);
    expect(result.nested.weight).toBe(0.3333);
    expect(result.nested.ignored).toBe('string');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('应递归处理数组中的 Decimal', () => {
    const input = [
      { score: new Prisma.Decimal('88.5') },
      { score: new Prisma.Decimal('92.0') },
    ];
    const result = serializeDecimals(input);
    expect(result[0].score).toBe(88.5);
    expect(result[1].score).toBe(92);
  });

  it('应保留 null、undefined 与原始类型', () => {
    expect(serializeDecimals(null)).toBeNull();
    expect(serializeDecimals(undefined)).toBeUndefined();
    expect(serializeDecimals(42)).toBe(42);
    expect(serializeDecimals('foo')).toBe('foo');
    expect(serializeDecimals(true)).toBe(true);
  });
});

describe('ResponseInterceptor', () => {
  it('应包装普通响应并转换 Decimal', async () => {
    const interceptor = new ResponseInterceptor();
    const data = {
      id: 'cycle-1',
      weight: new Prisma.Decimal('0.25'),
      items: [{ maxScore: new Prisma.Decimal('100.00') }],
    };
    const handler = { handle: () => of(data) };

    const result = await lastValueFrom(interceptor.intercept(createMockExecutionContext(), handler as any));

    expect(result).toMatchObject({
      code: 0,
      message: 'success',
      data: {
        id: 'cycle-1',
        weight: 0.25,
        items: [{ maxScore: 100 }],
      },
    });
    expect((result as any).timestamp).toBeDefined();
  });

  it('StreamableFile 应原样透传', async () => {
    const interceptor = new ResponseInterceptor();
    const stream = new StreamableFile(Buffer.from('test'));
    const handler = { handle: () => of(stream) };

    const result = await lastValueFrom(interceptor.intercept(createMockExecutionContext(), handler as any));

    expect(result).toBe(stream);
  });
});
