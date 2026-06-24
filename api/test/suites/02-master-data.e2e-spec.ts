import * as ExcelJS from 'exceljs';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { SysRole, CycleStatus } from '@prisma/client';

describe('02-master-data', () => {
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

  async function hrLogin() {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    return login(app.http, { employeeNo: 'HR001', password: 'test123' });
  }

  async function adminLogin() {
    const dept = await factory.getSeedDept();
    const admin = await factory.createUser({
      employeeNo: 'ADMIN',
      name: '管理员',
      sysRole: SysRole.system_admin,
      deptId: dept.id,
    });
    return login(app.http, { employeeNo: 'ADMIN', password: 'test123' });
  }

  it('指标 CRUD', async () => {
    const hrToken = await hrLogin();

    const createRes = await app.http
      .post('/api/v1/indicators')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: '测试指标KPI',
        type: 'kpi',
        code: 'KPI-TEST-001',
        scoringStandard: '标准',
        targetValue: 100,
        unit: '%',
      })
      .expect(200);
    expect(createRes.body.code).toBe(0);
    expect(createRes.body.data.name).toBe('测试指标KPI');

    const indicatorId = createRes.body.data.id;

    const updateRes = await app.http
      .put(`/api/v1/indicators/${indicatorId}`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: '测试指标KPI-改' })
      .expect(200);
    expect(updateRes.body.data.name).toBe('测试指标KPI-改');

    const listRes = await app.http
      .get('/api/v1/indicators')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(listRes.body.code).toBe(0);
    expect(listRes.body.data.items.length).toBeGreaterThanOrEqual(1);

    const exportRes = await app.http
      .get('/api/v1/indicators/export')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(exportRes.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const templateRes = await app.http
      .get('/api/v1/indicators/import/template')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(templateRes.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('指标导入正常文件返回成功条数', async () => {
    const hrToken = await hrLogin();

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('指标导入模板');
    ws.columns = [
      { header: '编码', key: 'code' },
      { header: '名称', key: 'name' },
      { header: '类型', key: 'type' },
      { header: '分类', key: 'category' },
      { header: '分组', key: 'groupName' },
      { header: '描述', key: 'description' },
      { header: '评分标准', key: 'scoringStandard' },
      { header: '参考目标值', key: 'targetValue' },
      { header: '单位', key: 'unit' },
    ];
    ws.addRow({
      code: 'IMP-001',
      name: '导入指标1',
      type: '量化KPI',
      category: '测试',
      groupName: '测试组',
      description: '描述',
      scoringStandard: '标准',
      targetValue: 100,
      unit: '%',
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const res = await app.http
      .post('/api/v1/indicators/import')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', buffer, 'indicators.xlsx')
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.failed).toHaveLength(0);
  });

  it('指标导入坏文件返回失败行且不写库', async () => {
    const hrToken = await hrLogin();

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('指标导入模板');
    ws.columns = [
      { header: '编码', key: 'code' },
      { header: '名称', key: 'name' },
      { header: '类型', key: 'type' },
    ];
    ws.addRow({ code: 'BAD-001', name: '', type: '不存在的类型' });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const beforeCount = await app.prisma.indicator.count();

    const res = await app.http
      .post('/api/v1/indicators/import')
      .set('Authorization', `Bearer ${hrToken}`)
      .attach('file', buffer, 'bad.xlsx')
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.failed.length).toBeGreaterThan(0);

    const afterCount = await app.prisma.indicator.count();
    expect(afterCount).toBe(beforeCount);
  });

  it('模板权重合法创建成功', async () => {
    const hrToken = await hrLogin();
    const dept = await factory.getSeedDept();

    const res = await app.http
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: '合法模板',
        applicableDepts: [dept.id],
        applicableUsers: [],
        dimensions: [
          {
            name: 'KPI维度',
            type: 'kpi',
            weight: 0.6,
            sortOrder: 0,
            indicators: [
              { name: '指标A', weight: 0.5, sortOrder: 0 },
              { name: '指标B', weight: 0.5, sortOrder: 1 },
            ],
          },
          {
            name: '态度维度',
            type: 'attitude',
            weight: 0.4,
            sortOrder: 1,
            indicators: [{ name: '指标C', weight: 1, sortOrder: 0 }],
          },
        ],
      })
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.data.name).toBe('合法模板');
  });

  it('模板 KPI+态度≠100% 拒绝', async () => {
    const hrToken = await hrLogin();
    const dept = await factory.getSeedDept();

    const res = await app.http
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: '非法模板',
        applicableDepts: [dept.id],
        applicableUsers: [],
        dimensions: [
          {
            name: 'KPI维度',
            type: 'kpi',
            weight: 0.5,
            sortOrder: 0,
            indicators: [{ name: '指标A', weight: 1, sortOrder: 0 }],
          },
          {
            name: '态度维度',
            type: 'attitude',
            weight: 0.3,
            sortOrder: 1,
            indicators: [{ name: '指标C', weight: 1, sortOrder: 0 }],
          },
        ],
      })
      .expect(400);

    expect(res.body.code).toBe(4001);
  });

  it('模板某维度指标权重≠100% 拒绝', async () => {
    const hrToken = await hrLogin();
    const dept = await factory.getSeedDept();

    const res = await app.http
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: '非法维度模板',
        applicableDepts: [dept.id],
        applicableUsers: [],
        dimensions: [
          {
            name: 'KPI维度',
            type: 'kpi',
            weight: 1,
            sortOrder: 0,
            indicators: [
              { name: '指标A', weight: 0.3, sortOrder: 0 },
              { name: '指标B', weight: 0.3, sortOrder: 1 },
            ],
          },
        ],
      })
      .expect(400);

    expect(res.body.code).toBe(4001);
  });

  it('用户设主管成功', async () => {
    const adminToken = await adminLogin();
    const dept = await factory.getSeedDept();
    const mgr = await factory.createUser({ employeeNo: 'MGR001', name: '主管', sysRole: SysRole.manager, deptId: dept.id });
    const emp = await factory.createUser({ employeeNo: 'E010', name: '员工', sysRole: SysRole.employee, deptId: dept.id });

    const res = await app.http
      .patch(`/api/v1/users/${emp.id}/manager`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ directManagerId: mgr.id })
      .expect(200);

    expect(res.body.code).toBe(0);

    const updated = await app.prisma.user.findUnique({ where: { id: emp.id } });
    expect(updated?.directManagerId).toBe(mgr.id);
  });

  it('用户密码<6位拒绝', async () => {
    const adminToken = await adminLogin();
    const dept = await factory.getSeedDept();
    const emp = await factory.createUser({ employeeNo: 'E011', name: '员工', sysRole: SysRole.employee, deptId: dept.id });

    const res = await app.http
      .patch(`/api/v1/users/${emp.id}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: '12345' })
      .expect(400);

    expect(res.body.code).toBe(4001);
  });

  it('部门设审批人仅 system_admin 成功', async () => {
    const adminToken = await adminLogin();
    const hrToken = await hrLogin();
    const dept = await factory.getSeedDept();
    const vp = await factory.createUser({ employeeNo: 'VP001', name: 'VP', sysRole: SysRole.vp, deptId: dept.id });

    const hrRes = await app.http
      .patch(`/api/v1/departments/${dept.id}/approver`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ approverId: vp.id })
      .expect(403);
    expect(hrRes.body.code).toBe(4003);

    const adminRes = await app.http
      .patch(`/api/v1/departments/${dept.id}/approver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approverId: vp.id })
      .expect(200);
    expect(adminRes.body.code).toBe(0);

    const updated = await app.prisma.department.findUnique({ where: { id: dept.id } });
    expect(updated?.approverId).toBe(vp.id);
  });
});
