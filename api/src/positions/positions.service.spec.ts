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
        findMany: jest.fn().mockResolvedValue([]),
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

  it('相同的新建岗位已有待审核申请时不重复生成', async () => {
    const tx = {
      position: { findFirst: jest.fn().mockResolvedValue(null) },
      positionChangeRequest: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'position-create-pending',
          proposedValue: { code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true },
        }]),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new PositionsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.create({
      code: ' hrbp ',
      name: 'HRBP',
      jobFamily: ' 人力资源 ',
    }, submitter)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '相同岗位已有变更审核中，请先处理现有申请' }),
    });
    expect(tx.positionChangeRequest.create).not.toHaveBeenCalled();
  });

  it('岗位编码名称和岗位族未变化时不生成审核', async () => {
    const create = jest.fn();
    const prisma = {
      position: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'position-1', code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true,
        }),
      },
      positionChangeRequest: { create },
    };
    const service = new PositionsService(prisma as any);

    await expect(service.update('position-1', {
      code: ' hrbp ',
      name: 'HRBP',
      jobFamily: ' 人力资源 ',
    }, submitter)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '未检测到实际变更，无需提交审核' }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('同一岗位已有待审核变更时不重复生成申请', async () => {
    const tx = {
      positionChangeRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: 'position-change-pending' }),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      position: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'position-1', code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true,
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.update('position-1', {
      name: '高级 HRBP',
    }, submitter)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '该岗位已有变更审核中，请先处理现有申请' }),
    });
    expect(tx.positionChangeRequest.create).not.toHaveBeenCalled();
  });

  it('HR管理员可以通过自己提交的岗位变更并保留审核记录', async () => {
    const ownReviewer = { ...reviewer, id: submitter.id };
    const request = {
      id: 'fc0dcfff-9891-4e75-85ce-f4f74a04c724',
      positionId: null,
      positionName: 'HRBP',
      action: 'create',
      status: 'pending',
      baseValue: {},
      proposedValue: { code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true },
      createdById: ownReviewer.id,
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
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-own-approve' }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.approve(request.id, ownReviewer)).resolves.toMatchObject({
      status: 'approved',
      reviewedById: ownReviewer.id,
    });
    expect(tx.positionChangeRequest.update).toHaveBeenCalledWith({
      where: { id: request.id },
      data: expect.objectContaining({ status: 'approved', reviewedById: ownReviewer.id }),
    });
  });

  it('HR管理员可以退回自己提交的岗位变更并保留审核记录', async () => {
    const ownReviewer = { ...reviewer, id: submitter.id };
    const request = {
      id: 'fc0dcfff-9891-4e75-85ce-f4f74a04c724',
      positionId: null,
      positionName: 'HRBP',
      action: 'create',
      status: 'pending',
      baseValue: {},
      proposedValue: { code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true },
      createdById: ownReviewer.id,
    };
    const tx = {
      positionChangeRequest: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(request)
          .mockResolvedValueOnce({ ...request, status: 'rejected', reviewedById: ownReviewer.id }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-own-reject' }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.reject(request.id, '岗位信息需调整', ownReviewer)).resolves.toMatchObject({
      status: 'rejected',
      reviewedById: ownReviewer.id,
    });
    expect(tx.positionChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: request.id, status: 'pending' },
      data: expect.objectContaining({
        status: 'rejected',
        reviewedById: ownReviewer.id,
        rejectedReason: '岗位信息需调整',
      }),
    });
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

  it('正式岗位在提交后发生变化时拒绝覆盖新数据', async () => {
    const request = {
      id: 'position-change-stale',
      positionId: 'position-1',
      positionName: 'HRBP',
      action: 'update',
      status: 'pending',
      baseValue: { id: 'position-1', code: 'HRBP', name: 'HRBP', jobFamily: '人力资源', isActive: true },
      proposedValue: { code: 'HRBP', name: '高级 HRBP', jobFamily: '人力资源', isActive: true },
      createdById: submitter.id,
    };
    const tx = {
      positionChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      position: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'position-1', code: 'HRBP', name: '业务 HRBP', jobFamily: '人力资源', isActive: true,
        }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new PositionsService(prisma as any);

    await expect(service.approve(request.id, reviewer)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '正式岗位信息已发生变化，请重新提交审核' }),
    });
    expect(tx.position.update).not.toHaveBeenCalled();
    expect(tx.positionChangeRequest.update).not.toHaveBeenCalled();
  });
});
