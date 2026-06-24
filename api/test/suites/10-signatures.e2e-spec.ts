import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { SysRole, TaskStatus, PerfGrade, Prisma } from '@prisma/client';

describe('10-signatures', () => {
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

  async function createRoleSet() {
    const dept = await factory.createDept({ name: '签字测试部' });
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const manager = await factory.createUser({
      employeeNo: 'MGR001',
      name: '主管',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const employee = await factory.createUser({
      employeeNo: 'EMP001',
      name: '员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    return { dept, hr, manager, employee };
  }

  async function createMinimalTask(params: {
    cycleId: string;
    employeeId: string;
    managerId: string;
    deptId: string;
  }) {
    const template = await app.prisma.assessmentTemplate.create({
      data: {
        name: '签字用模板',
        createdBy: params.managerId,
        maxScore: new Prisma.Decimal(100),
        applicableDepts: [params.deptId],
        dimensions: {
          create: [
            {
              name: 'KPI维度',
              type: 'kpi',
              weight: new Prisma.Decimal(1),
              indicators: {
                create: [
                  {
                    name: '指标A',
                    weight: new Prisma.Decimal(1),
                    sortOrder: 0,
                  },
                ],
              },
            },
          ],
        },
      },
      include: { dimensions: { include: { indicators: true } } },
    });

    const snapshot = await app.prisma.assessmentTemplateSnapshot.create({
      data: {
        cycleId: params.cycleId,
        templateId: template.id,
        snapshotData: {
          templateId: template.id,
          name: template.name,
          maxScore: 100,
          dimensions: [],
        } as Prisma.InputJsonValue,
      },
    });

    return app.prisma.assessmentTask.create({
      data: {
        cycleId: params.cycleId,
        snapshotId: snapshot.id,
        employeeId: params.employeeId,
        managerId: params.managerId,
        deptId: params.deptId,
        status: TaskStatus.published,
      },
    });
  }

  it('三方各自签字 → 三条 Signature + 三条 AuditLog；重复签字幂等', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '签字周期', createdBy: hr.id });
    const task = await createMinimalTask({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      deptId: dept.id,
    });
    await app.prisma.gradeResult.create({
      data: {
        taskId: task.id,
        calculatedScore: new Prisma.Decimal(82),
        rawGrade: PerfGrade.B,
        calibratedGrade: PerfGrade.B,
      },
    });

    const managerToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });
    const employeeToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    // 考核人签字
    const assessorRes = await app.http
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ businessType: 'assessment_task', businessRecordId: task.id, role: 'assessor' })
      .expect(200);
    expect(assessorRes.body.data.role).toBe('assessor');

    // 被考核人签字
    await app.http
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ businessType: 'assessment_task', businessRecordId: task.id, role: 'assessee' })
      .expect(200);

    // HR 签字
    await app.http
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ businessType: 'assessment_task', businessRecordId: task.id, role: 'hr' })
      .expect(200);

    // 查询列表
    const listRes = await app.http
      .get('/api/v1/signatures')
      .set('Authorization', `Bearer ${managerToken}`)
      .query({ businessType: 'assessment_task', businessRecordId: task.id })
      .expect(200);
    expect(listRes.body.data).toHaveLength(3);
    expect(listRes.body.data.map((s: { role: string }) => s.role).sort()).toEqual([
      'assessee',
      'assessor',
      'hr',
    ]);

    // 签字审计留痕
    const auditCount = await app.prisma.auditLog.count({
      where: { action: 'sign', entityType: 'signature' },
    });
    expect(auditCount).toBe(3);

    // 重复签字幂等
    const duplicateRes = await app.http
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ businessType: 'assessment_task', businessRecordId: task.id, role: 'assessor' })
      .expect(200);
    expect(duplicateRes.body.data.id).toBe(assessorRes.body.data.id);

    const signaturesAfterDuplicate = await app.prisma.signature.count({
      where: { businessType: 'assessment_task', businessRecordId: task.id },
    });
    expect(signaturesAfterDuplicate).toBe(3);

    const auditCountAfterDuplicate = await app.prisma.auditLog.count({
      where: { action: 'sign', entityType: 'signature' },
    });
    expect(auditCountAfterDuplicate).toBe(3);

    // 红线：签字未修改业务数据
    const gradeResult = await app.prisma.gradeResult.findUnique({ where: { taskId: task.id } });
    expect(gradeResult?.calculatedScore?.toNumber()).toBe(82);
    expect(gradeResult?.rawGrade).toBe('B');
    expect(gradeResult?.calibratedGrade).toBe('B');
  });

  it('非本人按该角色签字应被拒绝', async () => {
    const { dept, hr, manager, employee } = await createRoleSet();
    const cycle = await factory.createCycle({ name: '签字周期', createdBy: hr.id });
    const task = await createMinimalTask({
      cycleId: cycle.id,
      employeeId: employee.id,
      managerId: manager.id,
      deptId: dept.id,
    });

    const employeeToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });

    // 员工尝试以考核人身份签字 → 403
    const res = await app.http
      .post('/api/v1/signatures')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ businessType: 'assessment_task', businessRecordId: task.id, role: 'assessor' });
    expect(res.status).toBe(403);
  });
});
