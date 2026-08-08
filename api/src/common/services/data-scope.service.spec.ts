import { Test, TestingModule } from '@nestjs/testing';
import { SysRole } from '@prisma/client';
import { DataScopeService } from './data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth.types';

/** 构造一个测试用 AuthUser。 */
function makeUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    name: 'Test User',
    sysRole: SysRole.employee,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: false,
    ...partial,
  };
}

describe('DataScopeService', () => {
  let service: DataScopeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataScopeService,
        {
          provide: PrismaService,
          useValue: {
            department: {
              findMany: jest.fn(),
            },
            user: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<DataScopeService>(DataScopeService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubDeptIds', () => {
    it('应返回包含自身的部门 id 列表', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([
        { id: 'd1', parentId: null },
        { id: 'd2', parentId: 'd1' },
        { id: 'd3', parentId: 'd1' },
        { id: 'd4', parentId: 'd2' },
      ] as any);

      const result = await service.getSubDeptIds('d1');
      expect(result).toContain('d1');
      expect(result).toContain('d2');
      expect(result).toContain('d3');
      expect(result).toContain('d4');
      expect(result).toHaveLength(4);
    });

    it('部门不存在时只返回自身 id', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([
        { id: 'other', parentId: null },
      ] as any);

      const result = await service.getSubDeptIds('missing');
      expect(result).toEqual(['missing']);
    });
  });

  describe('getVisibleEmployeeFilter', () => {
    it('system_admin 返回全量过滤条件', async () => {
      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.system_admin }));
      expect(filter).toEqual({});
    });

    it('canViewAll=true 返回全量过滤条件', async () => {
      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.employee, canViewAll: true }));
      expect(filter).toEqual({});
    });

    it('hr 返回全量过滤条件', async () => {
      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.hr }));
      expect(filter).toEqual({});
    });

    it('vp 返回其审批部门（含子部门）的成员范围', async () => {
      jest
        .spyOn(prisma.department, 'findMany')
        .mockResolvedValueOnce([
          {
            id: 'd1',
            name: 'Department 1',
            parentId: null,
            leaderId: null,
            approverId: 'vp-1',
          },
        ] as any)
        .mockResolvedValueOnce([
          { id: 'd1', parentId: null },
          { id: 'd2', parentId: 'd1' },
          { id: 'd3', parentId: null },
        ] as any);

      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.vp, id: 'vp-1' }));
      expect(filter).toEqual({ deptId: { in: expect.arrayContaining(['d1', 'd2']) } });
      expect((filter as any).deptId.in).toHaveLength(2);
    });

    it('vp 未担任任何部门审批人时只能看自己', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([] as any);

      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.vp, id: 'vp-1' }));
      expect(filter).toEqual({ id: 'vp-1' });
    });

    it('dept_head 返回其负责部门（含子部门）的成员范围', async () => {
      jest
        .spyOn(prisma.department, 'findMany')
        .mockResolvedValueOnce([{ id: 'd1' }] as any)
        .mockResolvedValueOnce([
          { id: 'd1', parentId: null },
          { id: 'd2', parentId: 'd1' },
        ] as any);

      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.dept_head, id: 'head-1' }));
      expect(filter).toEqual({ deptId: { in: expect.arrayContaining(['d1', 'd2']) } });
      expect((filter as any).deptId.in).toHaveLength(2);
    });

    it('dept_head 未负责任何部门时只能看自己', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([] as any);

      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.dept_head, id: 'head-1' }));
      expect(filter).toEqual({ id: 'head-1' });
    });

    it('manager 返回直接下属及自己', async () => {
      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.manager, id: 'mgr-1' }));
      expect(filter).toEqual({
        OR: [{ directManagerId: 'mgr-1' }, { id: 'mgr-1' }],
      });
    });

    it('普通 employee 只能看自己', async () => {
      const filter = await service.getVisibleEmployeeFilter(makeUser({ sysRole: SysRole.employee, id: 'emp-1' }));
      expect(filter).toEqual({ id: 'emp-1' });
    });

    it('assessor_only 只能看自己', async () => {
      const filter = await service.getVisibleEmployeeFilter(
        makeUser({ sysRole: SysRole.employee, id: 'assessor-1', isAssessorOnly: true }),
      );
      expect(filter).toEqual({ id: 'assessor-1' });
    });
  });

  describe('getAncestorDeptIds', () => {
    it('returns the current department and every ancestor once', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([
        { id: 'd1', parentId: null },
        { id: 'd2', parentId: 'd1' },
        { id: 'd3', parentId: 'd2' },
      ] as any);

      await expect(service.getAncestorDeptIds('d3')).resolves.toEqual(['d3', 'd2', 'd1']);
    });

    it('stops when a department cycle is encountered', async () => {
      jest.spyOn(prisma.department, 'findMany').mockResolvedValue([
        { id: 'd1', parentId: 'd2' },
        { id: 'd2', parentId: 'd1' },
      ] as any);

      await expect(service.getAncestorDeptIds('d1')).resolves.toEqual(['d1', 'd2']);
    });
  });

  describe('getManagerChainIds', () => {
    it('returns the direct manager followed by all higher managers', async () => {
      jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
        { id: 'u1', directManagerId: 'u2' },
        { id: 'u2', directManagerId: 'u3' },
        { id: 'u3', directManagerId: null },
      ] as any);

      await expect(service.getManagerChainIds('u1')).resolves.toEqual(['u2', 'u3']);
    });

    it('stops without returning the viewer when a manager cycle is encountered', async () => {
      jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
        { id: 'u1', directManagerId: 'u2' },
        { id: 'u2', directManagerId: 'u1' },
      ] as any);

      await expect(service.getManagerChainIds('u1')).resolves.toEqual(['u2']);
    });
  });
});
