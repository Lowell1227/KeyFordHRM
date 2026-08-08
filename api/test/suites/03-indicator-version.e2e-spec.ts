import { SysRole, TaskStatus } from '@prisma/client';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Task indicator version token', () => {
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

  it('round-trips a DB timestamp, admits one concurrent save, and accepts the winner version', async () => {
    const dept = await factory.getSeedDept();
    const manager = await factory.createUser({
      employeeNo: 'VERSION-MGR',
      name: 'Version Manager',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const employee = await factory.createUser({
      employeeNo: 'VERSION-EMP',
      name: 'Version Employee',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    const task = await factory.createTaskInStatus({
      employeeId: employee.id,
      managerId: manager.id,
      status: TaskStatus.indicator_reviewing,
      deptId: dept.id,
    });
    const token = await login(app.http, {
      employeeNo: 'VERSION-MGR',
      password: 'test123',
    });
    const authorization = { Authorization: `Bearer ${token}` };

    const detail = await app.http
      .get(`/api/v1/tasks/${task.id}`)
      .set(authorization)
      .expect(200);
    const initialVersion = detail.body.data.updatedAt as string;
    const body = {
      expectedUpdatedAt: initialVersion,
      action: 'save',
      instances: [
        {
          name: 'Round-trip KPI',
          weight: 1,
          indicatorType: 'kpi',
          dimensionName: 'KPI',
          dimensionWeight: 1,
          visibilityScope: 'company',
          visibleDepartmentIds: [],
          visibleUserIds: [],
          alignedObjectiveIds: [],
        },
      ],
    };

    const concurrent = await Promise.all([
      app.http.put(`/api/v1/tasks/${task.id}/indicators`).set(authorization).send(body),
      app.http.put(`/api/v1/tasks/${task.id}/indicators`).set(authorization).send(body),
    ]);
    const successful = concurrent.filter((response) => response.status === 200);
    const conflicted = concurrent.filter((response) => response.status === 409);

    expect(successful).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0].body.code).toBe(4009);

    const winnerVersion = successful[0].body.data.updatedAt as string;
    expect(new Date(winnerVersion).getTime()).toBeGreaterThan(new Date(initialVersion).getTime());

    const subsequent = await app.http
      .put(`/api/v1/tasks/${task.id}/indicators`)
      .set(authorization)
      .send({ ...body, expectedUpdatedAt: winnerVersion })
      .expect(200);
    expect(new Date(subsequent.body.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(winnerVersion).getTime(),
    );
  });
});
