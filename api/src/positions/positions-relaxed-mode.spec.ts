import { SysRole } from '@prisma/client';
import { PositionsService } from './positions.service';

describe('宽松模式：岗位变更提交后自动审核通过', () => {
  const operator = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'HR',
    sysRole: SysRole.hr,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: true,
  };

  const buildService = (mode: 'relaxed' | 'standard' | undefined) => {
    const tx = {
      position: { findFirst: jest.fn().mockResolvedValue(null) },
      positionChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'pos-request-1', ...data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
      position: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
    };
    const personnelConfig = mode === undefined
      ? undefined
      : { getReviewMode: jest.fn().mockResolvedValue(mode) };
    const service = new PositionsService(prisma as any, personnelConfig as any);
    return { service, prisma, personnelConfig };
  };

  it('宽松模式下新建岗位提交后自动审核通过', async () => {
    const { service } = buildService('relaxed');
    const approveSpy = jest.spyOn(service as any, 'approve').mockResolvedValue({});

    const request = await service.create({ name: '新岗位', code: '', jobFamily: '' }, operator);

    expect(request.id).toBe('pos-request-1');
    expect(request.status).toBe('approved');
    expect(approveSpy).toHaveBeenCalledWith('pos-request-1', operator, { autoApproved: true });
  });

  it('标准模式下不自动审核', async () => {
    const { service } = buildService('standard');
    const approveSpy = jest.spyOn(service as any, 'approve').mockResolvedValue({});

    await service.create({ name: '新岗位', code: '', jobFamily: '' }, operator);

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('未注入配置服务时不自动审核', async () => {
    const { service } = buildService(undefined);
    const approveSpy = jest.spyOn(service as any, 'approve').mockResolvedValue({});

    await service.create({ name: '新岗位', code: '', jobFamily: '' }, operator);

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('自动审核失败不阻断提交结果', async () => {
    const { service } = buildService('relaxed');
    jest.spyOn(service as any, 'approve').mockRejectedValue(new Error('并发处理中'));

    const request = await service.create({ name: '新岗位', code: '', jobFamily: '' }, operator);

    expect(request.id).toBe('pos-request-1');
    expect(request.status).toBe('pending');
  });
});
