import { CompanyCode, CycleStatus, SysRole, TaskStatus } from '@prisma/client';
import { NotificationsService } from '@/notifications/notifications.service';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Approval completion and concurrent decisions (PostgreSQL)', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let task: { id: string; cycleId: string };
  let approverToken: string;
  let hrToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });
  afterAll(async () => { await closeTestApp(app); });

  beforeEach(async () => {
    await factory.resetDataTables();
    const dept = await factory.getSeedDept();
    const hr = await factory.createUser({ employeeNo: 'APPROVAL-HR', name: 'Approval HR', sysRole: SysRole.hr, deptId: dept.id });
    const approver = await factory.createUser({ employeeNo: 'APPROVAL-OWNER', name: 'Approval Owner', sysRole: SysRole.employee, deptId: dept.id });
    const employee = await factory.createUser({ employeeNo: 'APPROVAL-EMP', name: 'Approval Employee', sysRole: SysRole.employee, deptId: dept.id });
    await app.prisma.employmentRecord.createMany({
      data: [hr, approver, employee].map((user) => ({
        userId: user.id, effectiveFrom: new Date('2020-01-01'), company: CompanyCode.fuede,
        deptId: dept.id, changeType: 'e2e_fixture', sourceType: 'e2e_fixture',
      })),
    });
    const cycle = await factory.createCycle({ name: 'Approval completion fixture', createdBy: hr.id, status: CycleStatus.approval });
    task = await factory.createTaskInStatus({ cycleId: cycle.id, employeeId: employee.id, managerId: hr.id, approverId: approver.id, status: TaskStatus.approval, deptId: dept.id, hasManagerScore: true });
    approverToken = await login(app.http, { employeeNo: 'APPROVAL-OWNER', password: 'test123' });
    hrToken = await login(app.http, { employeeNo: 'APPROVAL-HR', password: 'test123' });
  });

  const approve = () => app.http.post(`/api/v1/cycles/${task.cycleId}/approval`)
    .set('Authorization', `Bearer ${approverToken}`).send({ taskIds: [task.id] });
  const reject = () => app.http.post(`/api/v1/tasks/${task.id}/approval/reject`)
    .set('Authorization', `Bearer ${approverToken}`).send({ comment: 'Please recalibrate' });

  it('removes completed approval from pending, rejects repeat decisions and preserves HR publication', async () => {
    await approve().expect(200);
    const persisted = await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id }, include: { gradeResult: true } });
    expect(persisted.status).toBe('approval');
    expect(persisted.approvedAt).not.toBeNull();
    expect(persisted.gradeResult?.approvedAt).toEqual(persisted.approvedAt);

    const list = await app.http.get(`/api/v1/cycles/${task.cycleId}/approval`).set('Authorization', `Bearer ${approverToken}`).expect(200);
    expect(list.body.data).toEqual([]);
    const overview = await app.http.get(`/api/v1/cycles/${task.cycleId}/approval/overview`).set('Authorization', `Bearer ${approverToken}`).expect(200);
    expect(overview.body.data).toMatchObject({ ownPending: 0, ownTotal: 1, cyclePending: 0 });
    expect(overview.body.data.gradeDistribution.B.count).toBe(1);

    await approve().expect(409);
    await reject().expect(409);
    expect(await app.prisma.flowRecord.count({ where: { taskId: task.id, nodeType: 'approval' } })).toBe(1);
    expect((await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id } })).approvedAt).toEqual(persisted.approvedAt);

    const publishList = await app.http.get(`/api/v1/tasks?cycleId=${task.cycleId}&status=approval`).set('Authorization', `Bearer ${hrToken}`).expect(200);
    expect(publishList.body.data.items.map((row: { id: string }) => row.id)).toContain(task.id);
    const published = await app.http.post(`/api/v1/cycles/${task.cycleId}/publish`).set('Authorization', `Bearer ${hrToken}`).send({ taskIds: [task.id] }).expect(200);
    expect(published.body.data.published).toBe(1);
    expect((await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('published');
  });

  it('concurrent approvals produce exactly one approval and one audit record', async () => {
    const results = await Promise.all([approve(), approve()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await app.prisma.flowRecord.count({ where: { taskId: task.id, nodeType: 'approval', action: 'approve' } })).toBe(1);
    const persisted = await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id }, include: { gradeResult: true } });
    expect(persisted.gradeResult?.approvedAt).toEqual(persisted.approvedAt);
    expect(persisted.approvedAt).not.toBeNull();
  });

  it('approval reminders create a test-channel notification only for an unapproved task', async () => {
    await approve().expect(200);
    const completed = await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id } });
    const employee = await factory.createUser({ employeeNo: 'APPROVAL-PENDING', name: 'Pending Employee', sysRole: SysRole.employee, deptId: completed.deptId! });
    const pending = await factory.createTaskInStatus({
      cycleId: task.cycleId, employeeId: employee.id, managerId: completed.managerId!,
      approverId: completed.approverId!, status: TaskStatus.approval,
      deptId: completed.deptId!, hasManagerScore: true,
    });

    await app.app.get(NotificationsService).sendBatchReminders(task.cycleId, 'approver');

    const notices = await app.prisma.notificationLog.findMany({
      where: { cycleId: task.cycleId, type: 'task_reminder' },
      select: { taskId: true, userId: true, status: true, channel: true },
    });
    expect(notices).toEqual([
      { taskId: pending.id, userId: completed.approverId, status: 'sent', channel: 'test' },
    ]);
  });

  it('approval and rejection racing on one task commit exactly one consistent decision', async () => {
    const results = await Promise.all([approve(), reject()]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await app.prisma.assessmentTask.findUniqueOrThrow({ where: { id: task.id }, include: { gradeResult: true } });
    const records = await app.prisma.flowRecord.findMany({ where: { taskId: task.id, nodeType: 'approval' } });
    expect(records).toHaveLength(1);
    if (results[0].status === 200) {
      expect(persisted.status).toBe('approval');
      expect(persisted.approvedAt).not.toBeNull();
      expect(persisted.gradeResult?.approvedAt).toEqual(persisted.approvedAt);
      expect(records[0].action).toBe('approve');
    } else {
      expect(persisted.status).toBe('hr_calibration');
      expect(persisted.approvedAt).toBeNull();
      expect(persisted.gradeResult?.approvedAt).toBeNull();
      expect(records[0].action).toBe('reject');
    }
  });
});
