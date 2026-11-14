import { PositionsService } from './positions.service';
import { ValidationPipe } from '@nestjs/common';
import { UpdatePositionDto } from './dto/position.dto';

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
          code: expect.stringMatching(/^POS-[0-9A-F-]{36}$/),
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
          proposedValue: { code: 'POS-EXISTING', name: 'HRBP', jobFamily: '人力资源', isActive: true },
        }]),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new PositionsService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any);

    await expect(service.create({
      name: 'HRBP',
      jobFamily: ' 人力资源 ',
    }, submitter)).rejects.toMatchObject({
      response: expect.objectContaining({ message: '相同岗位已有变更审核中，请先处理现有申请' }),
    });
    expect(tx.positionChangeRequest.create).not.toHaveBeenCalled();
  });

  it('岗位名称和岗位族未变化时不生成审核', async () => {
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

describe('explicit position activation stays behind the existing review gate', () => {
  function setup(isActive = false) {
    const position = { id: 'position-owned', code: 'OWNED', name: 'Synthetic position', jobFamily: 'Synthetic family', isActive };
    let request: any = null;
    const tx: any = {
      position: {
        findUnique: jest.fn(async () => ({ ...position })),
        update: jest.fn(async ({ data }) => Object.assign(position, data)),
      },
      positionChangeRequest: {
        findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => request),
        create: jest.fn(async ({ data }) => (request = { id: 'request-owned', ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async ({ data }) => (request = { ...request, ...data })),
      },
      user: { count: jest.fn(async () => 0), update: jest.fn(), updateMany: jest.fn() },
      employmentRecord: { update: jest.fn(), updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const config = { getReviewMode: jest.fn(async () => 'relaxed') };
    const service = new PositionsService({ ...tx, $transaction: (run: any) => run(tx) } as any, config as any);
    return { service, tx, position, config, request: () => request,
      seedUpdate: (proposed: Record<string, unknown>) => {
        request = { id: 'request-owned', positionId: position.id, positionName: position.name,
          action: 'update', status: 'pending', baseValue: { ...position }, proposedValue: { ...position, ...proposed } };
      },
    };
  }

  it('accepts only explicit true in the HTTP DTO and never exposes isActive writes', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const meta = { type: 'body' as const, metatype: UpdatePositionDto };
    expect(await pipe.transform({ activationRequested: true, isActive: false }, meta))
      .toEqual({ activationRequested: true });
    for (const activationRequested of [false, 'true', 'false', 1, 0]) {
      await expect(pipe.transform({ activationRequested }, meta)).rejects.toThrow();
    }
    expect(await pipe.transform({ name: 'Compatible edit', isActive: false }, meta))
      .toEqual({ name: 'Compatible edit' });
  });

  it('submits explicit activation without early writes or relaxed auto-approval', async () => {
    const f = setup();
    const result = await f.service.update(f.position.id, { activationRequested: true } as any, submitter);
    expect(result).toMatchObject({ status: 'pending', action: 'update', baseValue: { isActive: false },
      proposedValue: { activationRequested: true, isActive: true }, warnings: ['申请启用岗位，审核通过后生效'] });
    expect(f.position.isActive).toBe(false);
    expect(f.tx.position.update).not.toHaveBeenCalled();
    expect(f.config.getReviewMode).not.toHaveBeenCalled();
  });

  it('applies explicit activation only on approval and leaves employees and historical employment alone', async () => {
    const f = setup();
    f.seedUpdate({ activationRequested: true, isActive: true });
    await f.service.approve('request-owned', reviewer);
    expect(f.position.isActive).toBe(true);
    expect(f.request()).toMatchObject({ status: 'approved', reviewedById: reviewer.id, appliedAt: expect.any(Date) });
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.user.updateMany).not.toHaveBeenCalled();
    expect(f.tx.employmentRecord.update).not.toHaveBeenCalled();
    expect(f.tx.employmentRecord.updateMany).not.toHaveBeenCalled();
  });

  it('keeps an inactive position inactive for ordinary edits, before and after approval', async () => {
    const f = setup();
    await f.service.update(f.position.id, { name: 'Renamed only' }, submitter);
    expect(f.request().proposedValue).toMatchObject({ name: 'Renamed only', isActive: false });
    expect(f.request().proposedValue.activationRequested).toBeUndefined();
    await f.service.approve('request-owned', reviewer);
    expect(f.position).toMatchObject({ name: 'Renamed only', isActive: false });
  });

  it.each([true, false, undefined])('legacy update isActive=%s without explicit intent retains the current inactive status', async isActive => {
    const f = setup();
    f.seedUpdate({ name: 'Legacy rename', isActive });
    await f.service.approve('request-owned', reviewer);
    expect(f.position).toMatchObject({ name: 'Legacy rename', isActive: false });
  });

  it.each([false, 'true', null])('non-true activation marker %s cannot enable on approval', async activationRequested => {
    const f = setup();
    f.seedUpdate({ activationRequested, isActive: true });
    await f.service.approve('request-owned', reviewer);
    expect(f.position.isActive).toBe(false);
  });

  it.each([false, 'true', null])('rejects malformed activation intent at the service boundary: %s', async activationRequested => {
    const f = setup();
    await expect(f.service.update(f.position.id, { activationRequested, name: 'Changed' } as any, submitter)).rejects.toThrow();
    expect(f.tx.positionChangeRequest.create).not.toHaveBeenCalled();
  });

  it('cannot deactivate through raw PATCH isActive=false or an old update proposal', async () => {
    const f = setup(true);
    await f.service.update(f.position.id, { name: 'Rename without deactivation', isActive: false } as any, submitter);
    expect(f.request().proposedValue.isActive).toBe(true);
    f.request().proposedValue.isActive = false;
    await f.service.approve('request-owned', reviewer);
    expect(f.position.isActive).toBe(true);
  });

  it('does not generate a same-value edit or an activation request for an already active position', async () => {
    const inactive = setup();
    await expect(inactive.service.update(inactive.position.id, {}, submitter)).rejects.toThrow('未检测到实际变更');
    const active = setup(true);
    await expect(active.service.update(active.position.id, { activationRequested: true } as any, submitter)).rejects.toThrow('未检测到实际变更');
  });

  it('keeps reviewer permissions, pending-claim checks and the current snapshot comparison', async () => {
    const f = setup();
    f.seedUpdate({ activationRequested: true, isActive: true });
    await expect(f.service.approve('request-owned', submitter)).rejects.toThrow('仅 HR 管理员可审核');
    expect(f.tx.positionChangeRequest.updateMany).not.toHaveBeenCalled();
    f.tx.positionChangeRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.approve('request-owned', reviewer)).rejects.toThrow('正在处理中');
    f.position.name = 'Changed after submission';
    await expect(f.service.approve('request-owned', reviewer)).rejects.toThrow('正式岗位信息已发生变化');
    expect(f.tx.position.update).not.toHaveBeenCalled();
  });

  it('does not duplicate a pending activation request or reapprove a completed one', async () => {
    const f = setup();
    f.tx.positionChangeRequest.findFirst.mockResolvedValueOnce({ id: 'other-pending' });
    await expect(f.service.update(f.position.id, { activationRequested: true } as any, submitter)).rejects.toThrow('已有变更审核中');
    f.seedUpdate({ activationRequested: true, isActive: true });
    await f.service.approve('request-owned', reviewer);
    await expect(f.service.approve('request-owned', reviewer)).rejects.toThrow('已处理');
    expect(f.tx.position.update).toHaveBeenCalledTimes(1);
  });

  it('keeps deactivation pending until approval and still rejects currently referenced positions', async () => {
    const blocked = setup(true);
    await blocked.service.deactivate(blocked.position.id, submitter);
    expect(blocked.request()).toMatchObject({ action: 'deactivate', status: 'pending', proposedValue: { isActive: false } });
    expect(blocked.position.isActive).toBe(true);
    blocked.tx.user.count.mockResolvedValueOnce(1);
    await expect(blocked.service.approve('request-owned', reviewer)).rejects.toThrow('仍有 1 名在职员工使用');
    expect(blocked.tx.position.update).not.toHaveBeenCalled();
    const allowed = setup(true);
    await allowed.service.deactivate(allowed.position.id, submitter);
    await allowed.service.approve('request-owned', reviewer);
    expect(allowed.position.isActive).toBe(false);
  });
});
