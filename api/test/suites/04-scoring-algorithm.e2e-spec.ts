import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { expectCloseTo } from '../helpers/scoring-assertions';
import { SysRole, CycleStatus } from '@prisma/client';
import { LaunchService } from '@/cycles/launch.service';

describe('04-scoring-algorithm', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let launchService: LaunchService;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
    launchService = app.app.get(LaunchService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await factory.resetDataTables();
  });

  async function createRoleSet() {
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'HR001', name: 'HR', sysRole: SysRole.hr, deptId: dept.id });
    const manager = await factory.createUser({ employeeNo: 'MGR001', name: '主管', sysRole: SysRole.manager, deptId: dept.id });
    const deptHead = await factory.createUser({ employeeNo: 'DEPT001', name: '部门负责人', sysRole: SysRole.dept_head, deptId: dept.id });
    const approver = await factory.createUser({ employeeNo: 'VP001', name: '审批人', sysRole: SysRole.vp, deptId: dept.id });
    const employee = await factory.createUser({
      employeeNo: 'EMP001',
      name: '员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });

    await factory.updateDeptLeader(dept.id, deptHead.id);
    await factory.updateDeptApprover(dept.id, approver.id);

    return { dept, hr, manager, deptHead, approver, employee };
  }

  async function launchCycleForEmployee(hrId: string, deptId: string, employeeId: string) {
    await factory.createStandardTemplate({ name: '算分模板', createdBy: hrId, applicableDepts: [deptId] });
    const cycle = await factory.createCycle({ name: '算分周期', createdBy: hrId, status: CycleStatus.draft });
    await launchService.launch(cycle.id, {
      id: hrId,
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });
    const task = await app.prisma.assessmentTask.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId },
      include: { indicatorInstances: true },
    });
    return { cycle, task };
  }

  async function progressToManagerScoring(taskId: string, empToken: string) {
    await app.http
      .post(`/api/v1/tasks/${taskId}/indicators/confirm`)
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);

    const task = await app.prisma.assessmentTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { indicatorInstances: true },
    });

    await app.http
      .post(`/api/v1/tasks/${taskId}/self-eval`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({
        indicators: task.indicatorInstances
          .filter((i) => i.indicatorType !== 'veto')
          .map((i) => ({ id: i.id, selfScore: 80 })),
        summary: {},
      })
      .expect(200);
  }

  it('算分=82：A90 B80 C70 + bonus5 - penalty2', async () => {
    const { hr, manager, employee } = await createRoleSet();
    const { task } = await launchCycleForEmployee(hr.id, (await factory.getSeedDept()).id, employee.id);

    const empToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });
    const mgrToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });

    await progressToManagerScoring(task.id, empToken);
    const managerScoreVersion = await app.prisma.assessmentTask.findUniqueOrThrow({
      where: { id: task.id },
      select: { updatedAt: true },
    });

    const scoreMap: Record<string, number> = {
      指标A: 90,
      指标B: 80,
      指标C: 70,
      加分项: 5,
      减分项: 2,
    };

    const indicators = task.indicatorInstances
      .filter((i) => i.indicatorType !== 'veto')
      .map((i) => ({ id: i.id, managerScore: scoreMap[i.name] ?? 80, managerComment: '评语' }));

    await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(), indicators, evalSummary: {} })
      .expect(200);

    const gradeResult = await app.prisma.gradeResult.findUnique({ where: { taskId: task.id } });
    expect(gradeResult).toBeTruthy();
    expectCloseTo(gradeResult?.calculatedScore?.toNumber(), 82, 2);
    expect(gradeResult?.rawGrade).toBe('B');
  });

  it('一票否决→等级D（不看分）', async () => {
    const { hr, manager, employee } = await createRoleSet();
    const { task } = await launchCycleForEmployee(hr.id, (await factory.getSeedDept()).id, employee.id);

    const empToken = await login(app.http, { employeeNo: 'EMP001', password: 'test123' });
    const mgrToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });

    await progressToManagerScoring(task.id, empToken);
    const managerScoreVersion = await app.prisma.assessmentTask.findUniqueOrThrow({
      where: { id: task.id },
      select: { updatedAt: true },
    });

    const indicators = task.indicatorInstances
      .filter((i) => i.indicatorType !== 'veto')
      .map((i) => ({ id: i.id, managerScore: 95, managerComment: '评语' }));

    await app.http
      .post(`/api/v1/tasks/${task.id}/manager-score`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(),
        indicators,
        evalSummary: {},
        veto: { isVeto: true, vetoReason: '重大失误' },
      })
      .expect(200);

    const gradeResult = await app.prisma.gradeResult.findUnique({ where: { taskId: task.id } });
    expect(gradeResult?.rawGrade).toBe('D');
    expect(gradeResult?.isVeto).toBe(true);
  });

  it('豁免员工不参与算分与分布', async () => {
    const { dept, hr, employee } = await createRoleSet();
    const exemptEmp = await factory.createUser({
      employeeNo: 'EXEMPT001',
      name: '豁免员工',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: employee.directManagerId ?? undefined,
      entryDate: new Date('2026-03-20'),
    });

    await factory.createStandardTemplate({ name: '分布模板', createdBy: hr.id, applicableDepts: [dept.id] });
    const cycle = await factory.createCycle({ name: '分布周期', createdBy: hr.id, status: CycleStatus.draft });
    const launchResult = await launchService.launch(cycle.id, {
      id: hr.id,
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    expect(launchResult.totalTasks).toBeGreaterThanOrEqual(2);
    expect(launchResult.exemptedTasks).toBe(1);

    const distribution = await app.http
      .get(`/api/v1/cycles/${cycle.id}/grade-distribution`)
      .set('Authorization', `Bearer ${await login(app.http, { employeeNo: 'HR001', password: 'test123' })}`)
      .expect(200);

    expect(distribution.body.code).toBe(0);
    expect(distribution.body.data.total).toBe(launchResult.totalTasks - launchResult.exemptedTasks);
  });

  it('强制分布超上限返回 warning 但仍可提交', async () => {
    const { dept, hr, manager, deptHead, approver } = await createRoleSet();

    // 造 5 名员工，让主管评分后都高分，再在校准时全部改为 A（超出 20%）
    const employees: Awaited<ReturnType<typeof factory.createUser>>[] = [];
    for (let i = 101; i <= 105; i++) {
      const emp = await factory.createUser({
        employeeNo: `EMP${String(i).padStart(3, '0')}`,
        name: `员工${i}`,
        sysRole: SysRole.employee,
        deptId: dept.id,
        directManagerId: manager.id,
      });
      employees.push(emp);
    }

    await factory.createStandardTemplate({ name: '分布模板', createdBy: hr.id, applicableDepts: [dept.id] });
    const cycle = await factory.createCycle({
      name: '分布周期',
      createdBy: hr.id,
      status: CycleStatus.draft,
      gradeAMaxRatio: 0.2,
    });
    await launchService.launch(cycle.id, {
      id: hr.id,
      name: 'HR',
      sysRole: SysRole.hr,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    });

    const mgrToken = await login(app.http, { employeeNo: 'MGR001', password: 'test123' });
    const headToken = await login(app.http, { employeeNo: 'DEPT001', password: 'test123' });
    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });

    const tasks = await app.prisma.assessmentTask.findMany({
      where: { cycleId: cycle.id, employeeId: { in: employees.map((e) => e.id) } },
      include: { indicatorInstances: true, employee: { select: { employeeNo: true } } },
    });

    for (const task of tasks) {
      const empToken = await login(app.http, { employeeNo: task.employee.employeeNo ?? '', password: 'test123' });
      await app.http
        .post(`/api/v1/tasks/${task.id}/indicators/confirm`)
        .set('Authorization', `Bearer ${empToken}`)
        .expect(200);
      await app.http
        .post(`/api/v1/tasks/${task.id}/self-eval`)
        .set('Authorization', `Bearer ${empToken}`)
        .send({
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== 'veto')
            .map((i) => ({ id: i.id, selfScore: 80 })),
          summary: {},
        })
        .expect(200);

      const managerScoreVersion = await app.prisma.assessmentTask.findUniqueOrThrow({
        where: { id: task.id },
        select: { updatedAt: true },
      });
      await app.http
        .post(`/api/v1/tasks/${task.id}/manager-score`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({
          expectedUpdatedAt: managerScoreVersion.updatedAt.toISOString(),
          indicators: task.indicatorInstances
            .filter((i) => i.indicatorType !== 'veto')
            .map((i) => ({ id: i.id, managerScore: 95 })),
          evalSummary: {},
        })
        .expect(200);

      await app.http
        .post(`/api/v1/tasks/${task.id}/dept-review`)
        .set('Authorization', `Bearer ${headToken}`)
        .send({ action: 'approve' })
        .expect(200);
    }

    const calibrations = tasks.map((t) => ({ taskId: t.id, calibratedGrade: 'A', calibrationNote: '测试' }));
    const res = await app.http
      .post(`/api/v1/cycles/${cycle.id}/calibration`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ submit: true, calibrations })
      .expect(200);

    expect(res.body.data.submit).toBe(true);
    expect(res.body.data.warnings.length).toBeGreaterThan(0);
    expect(res.body.data.warnings.some((w: string) => w.includes('A 等级比例'))).toBe(true);
  });
});
