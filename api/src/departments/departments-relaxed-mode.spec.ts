import { SysRole } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

describe('固定审核：历史宽松配置不能自动批准部门变更', () => {
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
      departmentChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'dept-request-1', ...data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: unknown) => unknown) => run(tx)),
      department: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const personnelConfig = mode === undefined
      ? undefined
      : { getReviewMode: jest.fn().mockResolvedValue(mode) };
    const service = new DepartmentsService(prisma as any, personnelConfig as any);
    return { service, prisma, personnelConfig };
  };

  const createDto = {
    name: '新部门',
    parentId: null,
    company: 'fuede' as const,
  };

  it('旧自动批准参数不能绕过审核权限', async () => {
    const { service, prisma } = buildService('relaxed');
    await expect((service as any).approveChange('r1', { ...operator, sysRole: SysRole.employee }, { autoApproved: true }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('即使历史配置为宽松，新建部门也保持待审核', async () => {
    const { service } = buildService('relaxed');
    const approveSpy = jest.spyOn(service as any, 'approveChange').mockResolvedValue({});

    const request = await service.create(createDto, operator);

    expect(request.id).toBe('dept-request-1');
    expect(request.status).toBe('pending');
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('标准模式下不自动审核', async () => {
    const { service } = buildService('standard');
    const approveSpy = jest.spyOn(service as any, 'approveChange').mockResolvedValue({});

    await service.create(createDto, operator);

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('未注入配置服务时不自动审核', async () => {
    const { service } = buildService(undefined);
    const approveSpy = jest.spyOn(service as any, 'approveChange').mockResolvedValue({});

    await service.create(createDto, operator);

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('自动审核失败不阻断提交结果', async () => {
    const { service } = buildService('relaxed');
    jest.spyOn(service as any, 'approveChange').mockRejectedValue(new Error('并发处理中'));

    const request = await service.create(createDto, operator);

    expect(request.id).toBe('dept-request-1');
    expect(request.status).toBe('pending');
  });

  it('部门合并即使在宽松模式下也保留人工审核', async () => {
    const { service } = buildService('relaxed');
    const approveSpy = jest.spyOn(service, 'approveChange');
    const request = await (service as any).submitChangeRequest(
      'merge', 'source-dept', '来源部门', {}, { targetId: 'target-dept' }, operator,
    );
    expect(request).toMatchObject({ status: 'pending', reviewOutcome: 'pending' });
    expect(approveSpy).not.toHaveBeenCalled();
  });
});
