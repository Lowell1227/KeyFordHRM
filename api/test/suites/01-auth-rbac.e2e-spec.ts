import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { SysRole, CycleStatus } from '@prisma/client';

describe('01-auth-rbac', () => {
  let app: TestApp;
  let factory: FixtureFactory;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  it('本地密码登录成功', async () => {
    const dept = await factory.getSeedDept();
    await factory.createUser({ employeeNo: 'E001', name: '员工', sysRole: SysRole.employee, deptId: dept.id, password: 'test123' });

    const res = await app.http
      .post('/api/v1/auth/login')
      .send({ employeeNo: 'E001', password: 'test123' })
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.sysRole).toBe('employee');
  });

  it('密码错误登录失败', async () => {
    const dept = await factory.getSeedDept();
    await factory.createUser({ employeeNo: 'E002', name: '员工', sysRole: SysRole.employee, deptId: dept.id, password: 'test123' });

    const res = await app.http
      .post('/api/v1/auth/login')
      .send({ employeeNo: 'E002', password: 'wrong' })
      .expect(401);

    expect(res.body.code).toBe(4010);
  });

  it('无 token 访问受限接口返回 401', async () => {
    const res = await app.http.get('/api/v1/auth/me').expect(401);
    expect(res.body.code).toBe(4010);
  });

  it('过期/非法 token 访问受限接口返回 401', async () => {
    const res = await app.http
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
    expect(res.body.code).toBe(4010);
  });

  it('HR 调用 /users/:id/role 返回 403', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const emp = await factory.createUser({ employeeNo: 'E003', name: '员工', sysRole: SysRole.employee, deptId: dept.id });
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const res = await app.http
      .patch(`/api/v1/users/${emp.id}/role`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ sysRole: 'manager' })
      .expect(403);

    expect(res.body.code).toBe(4003);
  });

  it('system_admin 调用 /users/:id/role 成功', async () => {
    const dept = await factory.getSeedDept();
    const admin = await factory.createUser({ employeeNo: 'ADMIN', name: '管理员', sysRole: SysRole.system_admin, deptId: dept.id });
    const emp = await factory.createUser({ employeeNo: 'E004', name: '员工', sysRole: SysRole.employee, deptId: dept.id });
    const adminToken = await login(app.http, { employeeNo: 'ADMIN', password: 'test123' });

    const res = await app.http
      .patch(`/api/v1/users/${emp.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sysRole: 'manager' })
      .expect(200);

    expect(res.body.code).toBe(0);
  });

  it('HR 调用 /departments/:id/approver 返回 403', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR002', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const hrToken = await login(app.http, { employeeNo: 'HR002', password: 'test123' });

    const res = await app.http
      .patch(`/api/v1/departments/${dept.id}/approver`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ approverId: hr.id })
      .expect(403);

    expect(res.body.code).toBe(4003);
  });

  it('非审批人访问 /cycles/:id/approval 返回 403 或空列表', async () => {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR003', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const cycle = await factory.createCycle({ name: '审批权限测试', createdBy: hr.id, status: CycleStatus.approval });
    const hrToken = await login(app.http, { employeeNo: 'HR003', password: 'test123' });

    const res = await app.http
      .get(`/api/v1/cycles/${cycle.id}/approval`)
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(403);

    expect(res.body.code).toBe(4003);
  });

  it('员工访问 /calibration 返回 403', async () => {
    const dept = await factory.getSeedDept();
    const emp = await factory.createUser({ employeeNo: 'E005', name: '员工', sysRole: SysRole.employee, deptId: dept.id });
    const cycle = await factory.createCycle({ name: '校准权限测试', createdBy: emp.id });
    const empToken = await login(app.http, { employeeNo: 'E005', password: 'test123' });

    const res = await app.http
      .get(`/api/v1/cycles/${cycle.id}/calibration`)
      .set('Authorization', `Bearer ${empToken}`)
      .expect(403);

    expect(res.body.code).toBe(4003);
  });
});
