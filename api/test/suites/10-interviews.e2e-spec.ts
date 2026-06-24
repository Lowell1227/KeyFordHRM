import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { assertNoCoefficientKey } from '../helpers/scoring-assertions';
import { SysRole, TaskStatus, PerfGrade } from '@prisma/client';
import dayjs from 'dayjs';

describe('10-interviews', () => {
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

  async function publishTask(employeeId: string, managerId: string, deptHeadId: string, approverId: string, hrId: string) {
    const task = await factory.createTaskInStatus({
      employeeId,
      managerId,
      deptHeadId,
      approverId,
      status: 'approval',
      calculatedScore: 85,
      rawGrade: PerfGrade.B,
    });

    const approvedAt = new Date('2026-02-10T10:00:00');

    await app.prisma.assessmentTask.update({
      where: { id: task.id },
      data: { approvedAt },
    });

    await app.prisma.gradeResult.updateMany({
      where: { taskId: task.id },
      data: { approvedAt, approverId },
    });

    const hrToken = await login(app.http, { employeeNo: 'HR001', password: 'test123' });
    const publishRes = await app.http
      .post(`/api/v1/cycles/${task.cycleId}/publish`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ taskIds: [task.id], sendDingtalkNotification: false })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Expected 200 or 201, got ${res.status}`);
        }
      });

    return { task, approvedAt, publishRes: publishRes.body.data };
  }

  async function getTokens() {
    return {
      emp: await login(app.http, { employeeNo: 'EMP001', password: 'test123' }),
      mgr: await login(app.http, { employeeNo: 'MGR001', password: 'test123' }),
      head: await login(app.http, { employeeNo: 'DEPT001', password: 'test123' }),
      hr: await login(app.http, { employeeNo: 'HR001', password: 'test123' }),
      approver: await login(app.http, { employeeNo: 'VP001', password: 'test123' }),
    };
  }

  it('公示后自动创建 PerformanceInterview，deadline = approvedAt + 20 天', async () => {
    const { hr, manager, deptHead, approver, employee } = await createRoleSet();
    const { task, approvedAt } = await publishTask(employee.id, manager.id, deptHead.id, approver.id, hr.id);

    const taskAfter = await app.prisma.assessmentTask.findUnique({
      where: { id: task.id },
      include: { performanceInterview: true, gradeResult: true },
    });

    expect(taskAfter?.status).toBe(TaskStatus.published);
    expect(taskAfter?.performanceInterview).not.toBeNull();
    expect(taskAfter?.performanceInterview?.interviewerId).toBe(manager.id);
    expect(taskAfter?.performanceInterview?.employeeId).toBe(employee.id);

    const expectedDeadline = dayjs(approvedAt).add(20, 'day').format('YYYY-MM-DD');
    expect(dayjs(taskAfter?.performanceInterview?.deadline).format('YYYY-MM-DD')).toBe(expectedDeadline);
  });

  it('主管可填写面谈记录，六项内容落库并回显', async () => {
    const { hr, manager, deptHead, approver, employee } = await createRoleSet();
    const { task } = await publishTask(employee.id, manager.id, deptHead.id, approver.id, hr.id);
    const tokens = await getTokens();

    const interview = await app.prisma.performanceInterview.findUnique({ where: { taskId: task.id } });
    if (!interview) throw new Error('interview not found');

    const updateRes = await app.http
      .put(`/api/v1/interviews/${interview.id}`)
      .set('Authorization', `Bearer ${tokens.mgr}`)
      .send({
        interviewTime: '2026-02-20T14:00:00',
        location: '会议室 A',
        method: 'one_on_one',
        scoreInformed: true,
        achievements: '业绩突出',
        weaknesses: '待提升',
        nextGoals: '下周期目标',
        remediation: '改进行动',
        supportNeeded: '资源支持',
        otherMatters: '其他事项',
      })
      .expect(200);

    expect(updateRes.body.data.status).toBe('filled');
    expect(updateRes.body.data.method).toBe('one_on_one');
    expect(updateRes.body.data.achievements).toBe('业绩突出');
    assertNoCoefficientKey(updateRes.body.data);

    const detailRes = await app.http
      .get(`/api/v1/tasks/${task.id}/interview`)
      .set('Authorization', `Bearer ${tokens.emp}`)
      .expect(200);

    expect(detailRes.body.data.method).toBe('one_on_one');
    expect(detailRes.body.data.supportNeeded).toBe('资源支持');
    assertNoCoefficientKey(detailRes.body.data);
  });

  it('非主管无法填写面谈记录，非员工无法签字', async () => {
    const { hr, manager, deptHead, approver, employee } = await createRoleSet();
    const { task } = await publishTask(employee.id, manager.id, deptHead.id, approver.id, hr.id);
    const tokens = await getTokens();

    const interview = await app.prisma.performanceInterview.findUnique({ where: { taskId: task.id } });
    if (!interview) throw new Error('interview not found');

    await app.http
      .put(`/api/v1/interviews/${interview.id}`)
      .set('Authorization', `Bearer ${tokens.emp}`)
      .send({ achievements: '员工越权' })
      .expect(403);

    await app.http
      .post(`/api/v1/interviews/${interview.id}/employee-sign`)
      .set('Authorization', `Bearer ${tokens.mgr}`)
      .expect(403);
  });

  it('双签占位：主管签字后员工签字，signatures 表留痕', async () => {
    const { hr, manager, deptHead, approver, employee } = await createRoleSet();
    const { task } = await publishTask(employee.id, manager.id, deptHead.id, approver.id, hr.id);
    const tokens = await getTokens();

    const interview = await app.prisma.performanceInterview.findUnique({ where: { taskId: task.id } });
    if (!interview) throw new Error('interview not found');

    await app.http
      .put(`/api/v1/interviews/${interview.id}`)
      .set('Authorization', `Bearer ${tokens.mgr}`)
      .send({ achievements: '业绩突出' })
      .expect(200);

    const mgrSignRes = await app.http
      .post(`/api/v1/interviews/${interview.id}/manager-sign`)
      .set('Authorization', `Bearer ${tokens.mgr}`)
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Expected 200 or 201, got ${res.status}`);
        }
      });

    expect(mgrSignRes.body.data.managerSignedAt).not.toBeNull();

    const empSignRes = await app.http
      .post(`/api/v1/interviews/${interview.id}/employee-sign`)
      .set('Authorization', `Bearer ${tokens.emp}`)
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Expected 200 or 201, got ${res.status}`);
        }
      });

    expect(empSignRes.body.data.employeeSignedAt).not.toBeNull();
    expect(empSignRes.body.data.status).toBe('closed');

    const signatures = await app.prisma.signature.findMany({
      where: { businessType: 'interview', businessRecordId: interview.id },
    });
    expect(signatures).toHaveLength(2);
    const roles = signatures.map((s) => s.role).sort();
    expect(roles).toEqual(['assessee', 'assessor']);
  });

  it('面谈响应不含 coefficient（D13）', async () => {
    const { hr, manager, deptHead, approver, employee } = await createRoleSet();
    const { task } = await publishTask(employee.id, manager.id, deptHead.id, approver.id, hr.id);
    const tokens = await getTokens();

    const interview = await app.prisma.performanceInterview.findUnique({ where: { taskId: task.id } });
    if (!interview) throw new Error('interview not found');

    const res = await app.http
      .get(`/api/v1/interviews/${interview.id}`)
      .set('Authorization', `Bearer ${tokens.mgr}`)
      .expect(200);

    assertNoCoefficientKey(res.body.data);
  });
});
