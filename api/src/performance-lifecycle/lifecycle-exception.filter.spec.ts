import { PerformanceLifecycleExceptionFilter } from './lifecycle-exception.filter';

describe('scoped lifecycle database conflict translation', () => {
  it.each([
    { code: 'P2004', message: 'SQL private-fixture PERFORMANCE_LIFECYCLE_ENDED' },
    { code: 'P2010', meta: { code: '23514', message: 'PERFORMANCE_LIFECYCLE_CONFLICT private-fixture' } },
    { code: 'P2034', message: 'private-fixture' },
    { code: 'P2010', meta: { code: '40001', message: 'private-fixture' } },
  ])('returns safe 409 with no database details', (error) => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    new PerformanceLifecycleExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response }) } as any);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/SQL|Prisma|private-fixture|P2004|P2010/);
  });
});
