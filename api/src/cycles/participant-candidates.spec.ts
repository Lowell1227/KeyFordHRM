import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AccountType, SysRole, UserStatus } from '@prisma/client';
import request from 'supertest';
import { CyclesController } from './cycles.controller';
import { CyclesService } from './cycles.service';
import { LaunchService } from './launch.service';
import { CycleScheduleService } from './cycle-schedule.service';
import { CycleManagementGuard } from './cycle-management.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('cycle participant candidates', () => {
  let app: INestApplication;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let role: SysRole;
  let capabilities: string[];
  const id = '11111111-1111-4111-8111-111111111111';
  beforeEach(async () => {
    role = SysRole.hr_user;
    capabilities = ['cycle_plan_edit', 'performance_calibration'];
    findMany = jest.fn().mockResolvedValue([{
      id, name: '候选员工', employeeNo: 'EMP001', deptId: 'dept-1', dept: { name: '人事组' }, position: '专员',
      // Even unexpected fields from a persistence adapter must not enter the response.
      phone: 'private-phone', email: 'private-email', passwordHash: 'private-hash',
    }]);
    count = jest.fn().mockResolvedValue(1);
    const service = new CyclesService({ user: { findMany, count } } as never, {} as never);
    const module = await Test.createTestingModule({
      controllers: [CyclesController],
      providers: [
        { provide: CyclesService, useValue: service },
        { provide: LaunchService, useValue: {} },
        { provide: CycleScheduleService, useValue: {} },
      ],
    })
      .overrideGuard(CycleManagementGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { id: 'viewer', sysRole: role, hrCapabilities: capabilities, canViewAll: false, deptId: null };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterEach(() => app.close());

  it('allows cycle editors to search outside their archive scope and returns only selection identity', async () => {
    const response = await request(app.getHttpServer()).get('/cycles/participant-candidates?keyword=EMP001&page=2&pageSize=20');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ total: 1, page: 2, pageSize: 20, items: [{
      id, name: '候选员工', employeeNo: 'EMP001', deptId: 'dept-1', deptName: '人事组', position: '专员',
    }] });
    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      deletedAt: null, accountType: AccountType.employee, isAssessorOnly: false,
      status: { in: [UserStatus.active, UserStatus.probation] },
      OR: [{ name: { contains: 'EMP001', mode: 'insensitive' } }, { employeeNo: { contains: 'EMP001', mode: 'insensitive' } }],
    });
    expect(query.skip).toBe(20);
    expect(query.take).toBe(20);
    expect(Object.keys(query.select).sort()).toEqual(['dept', 'deptId', 'employeeNo', 'id', 'name', 'position']);
  });

  it('resolves saved labels using the same limited candidate projection and filters', async () => {
    const response = await request(app.getHttpServer()).get(`/cycles/participant-candidates?ids=${id}`);
    expect(response.status).toBe(200);
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: [id] });
    expect(response.body.items[0]).not.toHaveProperty('phone');
  });

  it('previews the final included employees from departments and explicit people while applying exclusions', async () => {
    const departmentId = '22222222-2222-4222-8222-222222222222';
    const excludedId = '33333333-3333-4333-8333-333333333333';
    const response = await request(app.getHttpServer())
      .post('/cycles/participant-preview')
      .send({
        scope: 'custom',
        departmentIds: [departmentId],
        userIds: [id],
        excludedDepartmentIds: [],
        excludedUserIds: [excludedId],
        keyword: 'EMP',
        page: 1,
        pageSize: 20,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 20, departmentCount: 1 });
    expect(findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      accountType: AccountType.employee,
      isAssessorOnly: false,
      status: { in: [UserStatus.active, UserStatus.probation] },
      OR: [{ deptId: { in: [departmentId] } }, { id: { in: [id] } }],
      NOT: { id: { in: [excludedId] } },
      AND: [{ OR: [
        { name: { contains: 'EMP', mode: 'insensitive' } },
        { employeeNo: { contains: 'EMP', mode: 'insensitive' } },
      ] }],
    });
  });

  it.each([SysRole.hr, SysRole.system_admin])('keeps the existing %s cycle-create role authorized', async (allowedRole) => {
    role = allowedRole;
    capabilities = [];
    expect((await request(app.getHttpServer()).get('/cycles/participant-candidates')).status).toBe(200);
  });

  it.each([
    [SysRole.hr_user, ['performance_calibration']],
    [SysRole.hr_user, ['employee_archive_edit']],
    [SysRole.employee, ['cycle_plan_edit']],
  ])('rejects %s without actual cycle planning permission (%s)', async (deniedRole, caps) => {
    role = deniedRole as SysRole;
    capabilities = caps as string[];
    expect((await request(app.getHttpServer()).get('/cycles/participant-candidates')).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(['pageSize=101', 'ids=bad-id', 'phone=private', 'includeTestAccounts=true'])('rejects invalid or broader lookup %s', async (query) => {
    expect((await request(app.getHttpServer()).get(`/cycles/participant-candidates?${query}`)).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });
});
