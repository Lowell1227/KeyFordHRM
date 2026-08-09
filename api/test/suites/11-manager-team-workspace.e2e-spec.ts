import { ObjectiveLevel, SysRole, TaskStatus } from '@prisma/client';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { authHeader, login } from '../helpers/auth-helper';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';

describe('Manager team performance workspace', () => {
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

  it('closes the direct-manager goal review and manager evaluation workflow', async () => {
    const dept = await factory.createDept({ name: 'Workspace Team Dept' });
    const foreignDept = await factory.createDept({ name: 'Workspace Foreign Dept' });
    const manager = await factory.createUser({
      employeeNo: 'TEAM-MGR',
      name: 'Team Manager',
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    const deptHead = await factory.createUser({
      employeeNo: 'TEAM-HEAD',
      name: 'Department Head',
      sysRole: SysRole.dept_head,
      deptId: dept.id,
    });
    const employeeA = await factory.createUser({
      employeeNo: 'TEAM-EMP-A',
      name: 'Team Employee A',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    const employeeB = await factory.createUser({
      employeeNo: 'TEAM-EMP-B',
      name: 'Team Employee B',
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: manager.id,
    });
    const foreignManager = await factory.createUser({
      employeeNo: 'TEAM-FOREIGN-MGR',
      name: 'Foreign Manager',
      sysRole: SysRole.manager,
      deptId: foreignDept.id,
    });
    const foreignEmployee = await factory.createUser({
      employeeNo: 'TEAM-FOREIGN-EMP',
      name: 'Foreign Employee',
      sysRole: SysRole.employee,
      deptId: foreignDept.id,
      directManagerId: foreignManager.id,
    });
    const cycle = await factory.createCycle({
      name: 'Manager workspace acceptance cycle',
      createdBy: manager.id,
    });
    const objective = await app.prisma.objective.create({
      data: {
        title: 'Employee A objective',
        level: ObjectiveLevel.individual,
        ownerId: employeeA.id,
        deptId: dept.id,
        cycleId: cycle.id,
        createdBy: employeeA.id,
      },
    });
    const taskA = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employeeA.id,
      managerId: manager.id,
      deptHeadId: deptHead.id,
      status: TaskStatus.indicator_setting,
      deptId: dept.id,
    });
    const taskB = await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: employeeB.id,
      managerId: manager.id,
      deptHeadId: deptHead.id,
      status: TaskStatus.indicator_setting,
      deptId: dept.id,
    });
    await factory.createTaskInStatus({
      cycleId: cycle.id,
      employeeId: foreignEmployee.id,
      managerId: foreignManager.id,
      deptHeadId: foreignManager.id,
      status: TaskStatus.indicator_reviewing,
      deptId: foreignDept.id,
    });

    const [managerToken, headToken, employeeAToken, employeeBToken] = await Promise.all([
      login(app.http, { employeeNo: manager.employeeNo!, password: 'test123' }),
      login(app.http, { employeeNo: deptHead.employeeNo!, password: 'test123' }),
      login(app.http, { employeeNo: employeeA.employeeNo!, password: 'test123' }),
      login(app.http, { employeeNo: employeeB.employeeNo!, password: 'test123' }),
    ]);

    const submitIndicators = async (
      taskId: string,
      token: string,
      custom: boolean,
      alignedObjectiveIds: string[] = [],
    ) => {
      const detail = await app.http.get(`/api/v1/tasks/${taskId}`).set(authHeader(token)).expect(200);
      const response = await app.http
        .put(`/api/v1/tasks/${taskId}/indicators`)
        .set(authHeader(token))
        .send({
          expectedUpdatedAt: detail.body.data.updatedAt,
          action: 'submit',
          instances: [
            {
              name: custom ? 'Custom visibility KPI' : 'Team KPI',
              weight: 1,
              indicatorType: 'kpi',
              dimensionName: 'KPI',
              dimensionWeight: 1,
              visibilityScope: custom ? 'custom' : 'company',
              visibleDepartmentIds: custom ? [dept.id] : [],
              visibleUserIds: custom ? [employeeA.id] : [],
              alignedObjectiveIds,
            },
          ],
        });
      if (response.status !== 200) throw new Error(JSON.stringify(response.body));
      return response;
    };

    const submittedA = await submitIndicators(taskA.id, employeeAToken, true, [objective.id]);
    expect(submittedA.body.data.status).toBe(TaskStatus.indicator_reviewing);
    expect(submittedA.body.data.indicatorInstances[0]).toMatchObject({
      visibilityScope: 'custom',
      visibleDepartmentIds: [dept.id],
      visibleUserIds: [employeeA.id],
      alignedObjectives: [expect.objectContaining({ id: objective.id })],
    });
    await submitIndicators(taskB.id, employeeBToken, false);

    const team = await app.http
      .get(`/api/v1/tasks/team?cycleId=${cycle.id}&stage=goal-review&page=1&pageSize=20`)
      .set(authHeader(managerToken))
      .expect(200);
    expect(team.body.data.items.map((item: { employeeId: string }) => item.employeeId).sort()).toEqual(
      [employeeA.id, employeeB.id].sort(),
    );
    expect(team.body.data.facets.employees.map((item: { id: string }) => item.id).sort()).toEqual(
      [employeeA.id, employeeB.id].sort(),
    );
    expect(team.body.data.items).not.toContainEqual(expect.objectContaining({ employeeId: foreignEmployee.id }));

    const reviewA = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    const staleB = await app.http.get(`/api/v1/tasks/${taskB.id}`).set(authHeader(managerToken)).expect(200);
    const currentB = await app.http
      .put(`/api/v1/tasks/${taskB.id}/indicators`)
      .set(authHeader(managerToken))
      .send({
        expectedUpdatedAt: staleB.body.data.updatedAt,
        action: 'save',
        instances: staleB.body.data.indicatorInstances.map((indicator: any) => ({
          name: indicator.name,
          description: indicator.description ?? undefined,
          scoringStandard: indicator.scoringStandard ?? undefined,
          targetValue: indicator.targetValue ?? undefined,
          unit: indicator.unit ?? undefined,
          weight: indicator.weight,
          indicatorType: indicator.indicatorType,
          dimensionName: indicator.dimensionName,
          dimensionWeight: indicator.dimensionWeight,
          visibilityScope: indicator.visibilityScope,
          visibleDepartmentIds: indicator.visibleDepartmentIds ?? [],
          visibleUserIds: indicator.visibleUserIds ?? [],
          alignedObjectiveIds: indicator.alignedObjectiveIds ?? [],
        })),
      })
      .expect(200);
    expect(new Date(currentB.body.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(staleB.body.data.updatedAt).getTime(),
    );

    const batch = await app.http
      .post('/api/v1/tasks/team/indicator-review/batch-approve')
      .set(authHeader(managerToken))
      .send({
        tasks: [
          { taskId: taskA.id, updatedAt: reviewA.body.data.updatedAt },
          { taskId: taskB.id, updatedAt: staleB.body.data.updatedAt },
        ],
      })
      .expect(200);
    expect(batch.body.data.succeeded).toEqual([{ taskId: taskA.id, status: TaskStatus.indicator_confirming }]);
    expect(batch.body.data.failed).toEqual([expect.objectContaining({ taskId: taskB.id })]);
    const approvedFlow = await app.prisma.flowRecord.findFirstOrThrow({
      where: { taskId: taskA.id, nodeType: 'indicator_setting', action: 'submit' },
      orderBy: { createdAt: 'desc' },
    });
    expect((approvedFlow.extraData as { batchId?: string }).batchId).toEqual(expect.any(String));

    await app.http.post(`/api/v1/tasks/${taskA.id}/indicators/confirm`).set(authHeader(employeeAToken)).expect(200);
    let detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(employeeAToken)).expect(200);
    await app.http
      .post(`/api/v1/tasks/${taskA.id}/self-eval`)
      .set(authHeader(employeeAToken))
      .send({
        indicators: detail.body.data.indicatorInstances.map((indicator: { id: string }) => ({
          id: indicator.id,
          selfScore: 82,
          selfComment: 'Employee self evaluation',
        })),
        summary: { achievements: 'Delivered committed objectives' },
      })
      .expect(200);

    detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    const draftPayload = {
      expectedUpdatedAt: detail.body.data.updatedAt,
      indicators: detail.body.data.indicatorInstances.map((indicator: { id: string }) => ({
        id: indicator.id,
        managerScore: 88,
        managerComment: 'Manager draft comment',
        extraScores: [{ label: 'Collaboration', value: 1 }],
      })),
      evalSummary: { strengths: 'Strong delivery', improvements: 'Broader sharing', developmentPlan: 'Lead a review' },
    };
    const draft = await app.http
      .put(`/api/v1/tasks/${taskA.id}/manager-evaluation-draft`)
      .set(authHeader(managerToken))
      .send(draftPayload)
      .expect(200);
    expect(draft.body.data.status).toBe(TaskStatus.manager_scoring);

    detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    expect(detail.body.data.indicatorInstances[0]).toMatchObject({ managerScore: 88, managerComment: 'Manager draft comment' });
    expect(detail.body.data.managerEvalSummary).toMatchObject({ strengths: 'Strong delivery', submittedAt: null });

    const submitEvaluation = async (expectedUpdatedAt: string) =>
      app.http
        .post(`/api/v1/tasks/${taskA.id}/manager-score`)
        .set(authHeader(managerToken))
        .send({
          expectedUpdatedAt,
          indicators: detail.body.data.indicatorInstances.map((indicator: { id: string }) => ({
            id: indicator.id,
            managerScore: 89,
            managerComment: 'Final manager comment',
            extraScores: [{ label: 'Collaboration', value: 1 }],
          })),
          evalSummary: draftPayload.evalSummary,
        });

    expect((await submitEvaluation(detail.body.data.updatedAt)).status).toBe(200);
    detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    expect(detail.body.data.status).toBe(TaskStatus.dept_review);
    const withdrawn = await app.http
      .post(`/api/v1/tasks/${taskA.id}/manager-score/withdraw`)
      .set(authHeader(managerToken))
      .send({ expectedUpdatedAt: detail.body.data.updatedAt })
      .expect(200);
    expect(withdrawn.body.data.status).toBe(TaskStatus.manager_scoring);
    expect(
      await app.prisma.flowRecord.count({ where: { taskId: taskA.id, nodeType: 'manager_score', action: 'withdraw' } }),
    ).toBe(1);

    detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    expect((await submitEvaluation(detail.body.data.updatedAt)).status).toBe(200);
    const reviewed = await app.http
      .post(`/api/v1/tasks/${taskA.id}/dept-review`)
      .set(authHeader(headToken))
      .send({ action: 'approve', comment: 'Department review complete' })
      .expect(200);
    expect(reviewed.body.data.status).toBe(TaskStatus.hr_calibration);

    detail = await app.http.get(`/api/v1/tasks/${taskA.id}`).set(authHeader(managerToken)).expect(200);
    const conflict = await app.http
      .post(`/api/v1/tasks/${taskA.id}/manager-score/withdraw`)
      .set(authHeader(managerToken))
      .send({ expectedUpdatedAt: detail.body.data.updatedAt })
      .expect(409);
    expect(conflict.body.code).toBe(4009);
  });
});
