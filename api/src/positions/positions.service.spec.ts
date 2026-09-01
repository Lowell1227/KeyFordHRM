import { PositionsService } from './positions.service';

const submitter = {
  id: '5b11c0c8-8c8e-4d24-b9d0-5dcbf080e5f1',
  name: '普通HR',
  sysRole: 'hr_user',
  deptId: null,
  hrCapabilities: ['organization_edit'],
} as any;

const reviewer = {
  id: '229736a7-f40a-4860-a69c-a3e90577e848',
  name: 'HR管理员',
  sysRole: 'hr',
  deptId: null,
  hrCapabilities: ['employee_archive_review'],
} as any;

describe('PositionsService', () => {
  it('新增岗位只生成待审核申请，不提前创建正式岗位', async () => {
    const tx = {
      position: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      positionChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'fc0dcfff-9891-4e75-85ce-f4f74a04c724',
          action: 'create',
          status: 'pending',
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.create({
      code: 'HRBP',
      name: 'HRBP',
      jobFamily: '人力资源',
    }, submitter)).resolves.toMatchObject({ status: 'pending', action: 'create' });

    expect(tx.positionChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        positionName: 'HRBP',
        action: 'create',
        status: 'pending',
        createdById: submitter.id,
        proposedValue: expect.objectContaining({
          code: 'HRBP',
          name: 'HRBP',
          jobFamily: '人力资源',
          isActive: true,
        }),
      }),
    });
    expect(tx.position.create).not.toHaveBeenCalled();
  });

  it('提交人不能审核自己提交的岗位变更', async () => {
    const tx = {
      positionChangeRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fc0dcfff-9891-4e75-85ce-f4f74a04c724',
          createdById: submitter.id,
          status: 'pending',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.approve('fc0dcfff-9891-4e75-85ce-f4f74a04c724', {
      ...submitter,
      sysRole: 'hr',
    }))
      .rejects.toThrow('不能审核自己提交的变更');
  });

  it('HR管理员通过后才创建正式岗位并记录审核人', async () => {
    const request = {
      id: 'fc0dcfff-9891-4e75-85ce-f4f74a04c724',
      positionId: null,
      positionName: 'HRBP',
      action: 'create',
      status: 'pending',
      baseValue: {},
      proposedValue: { code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true },
      createdById: submitter.id,
    };
    const tx = {
      positionChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...request, ...data })),
      },
      position: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: '1560b58d-f432-4e2e-a98f-e04ca77981d5',
          code: 'HRBP',
          name: 'HRBP',
          jobFamily: '人力资源',
          isActive: true,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.approve(request.id, reviewer)).resolves.toMatchObject({
      status: 'approved',
      positionId: '1560b58d-f432-4e2e-a98f-e04ca77981d5',
    });
    expect(tx.position.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'HRBP', name: 'HRBP', jobFamily: '人力资源' }),
    });
    expect(tx.positionChangeRequest.update).toHaveBeenCalledWith({
      where: { id: request.id },
      data: expect.objectContaining({
        status: 'approved',
        positionId: '1560b58d-f432-4e2e-a98f-e04ca77981d5',
        reviewedById: reviewer.id,
      }),
    });
  });
});
