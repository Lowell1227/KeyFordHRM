import { Test, TestingModule } from '@nestjs/testing';
import { SysRole, UserStatus } from '@prisma/client';
import { DingtalkSyncService } from './dingtalk-sync.service';
import { DingtalkService, DingtalkDepartment, DingtalkUser } from './dingtalk.service';
import { PrismaService } from '@/prisma/prisma.service';

/** 创建 mock PrismaService。 */
function createMockPrisma() {
  const departments: Array<{ id: string; dingtalkDeptId: string | null; name: string; parentId: string | null }> = [];
  const users: Array<{
    id: string;
    dingtalkId: string | null;
    dingtalkUnionId: string | null;
    name: string;
    deptId: string | null;
    position: string | null;
    directManagerId: string | null;
    dingtalkManagerId: string | null;
    status: UserStatus;
    deletedAt?: null;
  }> = [];

  const deptFindMany = jest.fn().mockImplementation(async ({ where }: any) => {
    if (where?.dingtalkDeptId?.not === null) return departments.filter((d) => d.dingtalkDeptId !== null);
    return departments;
  });

  const deptUpsert = jest.fn().mockImplementation(async ({ where, create, update }: any) => {
    const existing = departments.find((d) => d.dingtalkDeptId === where.dingtalkDeptId);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const created = { id: `dept-${create.dingtalkDeptId}`, ...create, parentId: null };
    departments.push(created);
    return created;
  });

  const deptUpdate = jest.fn().mockImplementation(async ({ where, data }: any) => {
    const d = departments.find((x) => x.id === where.id);
    if (d) Object.assign(d, data);
    return d;
  });

  const userFindMany = jest.fn().mockImplementation(async ({ where }: any) => {
    // 离职查询：dingtalkId 非空且不在已见列表，且状态不是 resigned
    if (where?.dingtalkId?.notIn && where?.status?.not !== undefined && where?.deletedAt === null) {
      return users.filter(
        (u) =>
          u.dingtalkId !== null &&
          !where.dingtalkId.notIn.includes(u.dingtalkId) &&
          u.status !== where.status.not &&
          u.deletedAt === undefined,
      );
    }
    if (where?.dingtalkId?.not === null) return users.filter((u) => u.dingtalkId !== null);
    if (where?.directManagerId === null && where?.dingtalkManagerId?.not === null) {
      return users.filter((u) => u.directManagerId === null && u.dingtalkManagerId !== null);
    }
    if (where?.id?.in) {
      return users.filter((u) => where.id.in.includes(u.id));
    }
    return users;
  });

  const userFindUnique = jest.fn().mockImplementation(async ({ where }: any) => {
    if (where.dingtalkId) return users.find((u) => u.dingtalkId === where.dingtalkId) ?? null;
    return users.find((u) => u.id === where.id) ?? null;
  });

  const userUpsert = jest.fn().mockImplementation(async ({ where, create, update }: any) => {
    const existing = users.find((u) => u.dingtalkId === where.dingtalkId);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const created = { id: `user-${create.dingtalkId}`, ...create };
    users.push(created);
    return created;
  });

  const userUpdateMany = jest.fn().mockImplementation(async ({ where, data }: any) => {
    const targets = users.filter((u) => where.id?.in?.includes(u.id));
    for (const u of targets) Object.assign(u, data);
    return { count: targets.length };
  });

  const userUpdate = jest.fn().mockImplementation(async ({ where, data }: any) => {
    const u = users.find((x) => x.id === where.id);
    if (u) Object.assign(u, data);
    return u;
  });

  const auditLogCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });

  return {
    department: {
      findMany: deptFindMany,
      upsert: deptUpsert,
      update: deptUpdate,
    },
    user: {
      findMany: userFindMany,
      findUnique: userFindUnique,
      upsert: userUpsert,
      updateMany: userUpdateMany,
      update: userUpdate,
    },
    auditLog: {
      create: auditLogCreate,
    },
    // 暴露数组供测试断言
    _departments: departments,
    _users: users,
  };
}

/** 创建 mock DingtalkService。 */
function createMockDingtalk(depts: DingtalkDepartment[], usersByDept: Map<number, DingtalkUser[]>) {
  return {
    fetchDepartments: jest.fn().mockResolvedValue(depts),
    fetchUsersByDepartment: jest.fn().mockImplementation(async (deptId: number) => {
      return usersByDept.get(deptId) ?? [];
    }),
  };
}

describe('DingtalkSyncService', () => {
  let service: DingtalkSyncService;
  let dingtalk: ReturnType<typeof createMockDingtalk>;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    dingtalk = createMockDingtalk([], new Map());
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DingtalkSyncService,
        { provide: DingtalkService, useValue: dingtalk },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DingtalkSyncService>(DingtalkSyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('应新增部门和人员', async () => {
    const dept: DingtalkDepartment = { dept_id: 10, name: '技术部', parent_id: 1 };
    const user: DingtalkUser = {
      userid: 'u10',
      unionid: 'union10',
      name: '张三',
      mobile: '13800000001',
      title: '工程师',
      dept_id_list: [10],
      manager_userid: 'u20',
    };

    dingtalk = createMockDingtalk([dept], new Map([[10, [user]]]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DingtalkSyncService,
        { provide: DingtalkService, useValue: dingtalk },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<DingtalkSyncService>(DingtalkSyncService);

    const job = service.runSync('operator-1');
    expect(job.status).toBe('running');

    // 等待后台同步完成
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = service.getResult(job.syncId)!;
    expect(result.status).toBe('completed');
    expect(result.added).toBe(2); // 1 部门 + 1 人员
    expect(result.updated).toBe(0);
    expect(result.deactivated).toBe(0);
    expect(result.errors).toHaveLength(0);

    expect(prisma._departments).toHaveLength(1);
    expect(prisma._departments[0].dingtalkDeptId).toBe('10');

    expect(prisma._users).toHaveLength(1);
    expect(prisma._users[0].dingtalkId).toBe('u10');
    expect(prisma._users[0].dingtalkManagerId).toBe('u20');
  });

  it('应更新已存在人员的字段', async () => {
    // 预置已存在人员
    prisma._users.push({
      id: 'local-u10',
      dingtalkId: 'u10',
      dingtalkUnionId: 'union10',
      name: '张三旧名',
      deptId: null,
      position: null,
      directManagerId: null,
      dingtalkManagerId: null,
      status: UserStatus.active,
    });

    const dept: DingtalkDepartment = { dept_id: 10, name: '技术部' };
    const user: DingtalkUser = {
      userid: 'u10',
      unionid: 'union10',
      name: '张三新名',
      title: '高级工程师',
      dept_id_list: [10],
    };

    dingtalk = createMockDingtalk([dept], new Map([[10, [user]]]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DingtalkSyncService,
        { provide: DingtalkService, useValue: dingtalk },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<DingtalkSyncService>(DingtalkSyncService);

    const job = service.runSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = service.getResult(job.syncId)!;
    expect(result.added).toBe(1); // 部门新增
    expect(result.updated).toBe(1); // 人员更新
    expect(prisma._users[0].name).toBe('张三新名');
    expect(prisma._users[0].position).toBe('高级工程师');
  });

  it('应将钉钉中已不存在的人标记为 resigned', async () => {
    prisma._users.push({
      id: 'local-u99',
      dingtalkId: 'u99',
      dingtalkUnionId: 'union99',
      name: '离职人员',
      deptId: null,
      position: null,
      directManagerId: null,
      dingtalkManagerId: null,
      status: UserStatus.active,
    });

    const dept: DingtalkDepartment = { dept_id: 10, name: '技术部' };
    const user: DingtalkUser = { userid: 'u10', unionid: 'union10', name: '在职人员', dept_id_list: [10] };

    dingtalk = createMockDingtalk([dept], new Map([[10, [user]]]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DingtalkSyncService,
        { provide: DingtalkService, useValue: dingtalk },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<DingtalkSyncService>(DingtalkSyncService);

    const job = service.runSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = service.getResult(job.syncId)!;
    expect(result.deactivated).toBe(1);

    const resignedUser = prisma._users.find((u) => u.dingtalkId === 'u99');
    expect(resignedUser?.status).toBe(UserStatus.resigned);
  });

  it('已有 direct_manager_id 覆盖时不应被同步冲掉', async () => {
    // 本地已指定直属上级
    prisma._users.push({
      id: 'local-u10',
      dingtalkId: 'u10',
      dingtalkUnionId: 'union10',
      name: '张三',
      deptId: null,
      position: null,
      directManagerId: 'local-boss', // 本地覆盖值
      dingtalkManagerId: null,
      status: UserStatus.active,
    });

    // 钉钉返回的汇报关系
    prisma._users.push({
      id: 'local-u20',
      dingtalkId: 'u20',
      dingtalkUnionId: 'union20',
      name: '李四',
      deptId: null,
      position: null,
      directManagerId: null,
      dingtalkManagerId: null,
      status: UserStatus.active,
    });

    const dept: DingtalkDepartment = { dept_id: 10, name: '技术部' };
    const user: DingtalkUser = {
      userid: 'u10',
      unionid: 'union10',
      name: '张三',
      dept_id_list: [10],
      manager_userid: 'u20', // 钉钉侧汇报给 u20
    };

    dingtalk = createMockDingtalk([dept], new Map([[10, [user]]]));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DingtalkSyncService,
        { provide: DingtalkService, useValue: dingtalk },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<DingtalkSyncService>(DingtalkSyncService);

    const job = service.runSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const localUser = prisma._users.find((u) => u.dingtalkId === 'u10');
    expect(localUser?.directManagerId).toBe('local-boss');
    expect(localUser?.dingtalkManagerId).toBe('u20'); // dingtalk_manager_id 正常写入
  });
});
