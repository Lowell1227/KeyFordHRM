import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { ConflictException, ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { FlowService } from '@/tasks/flow.service';
import { TasksService } from '@/tasks/tasks.service';
import { TasksController } from '@/tasks/tasks.controller';
import { TeamTasksService } from '@/tasks/team-tasks.service';
import { FinalGradeService } from '@/final-grade/final-grade.service';
import { CalibrationService } from '@/calibration/calibration.service';
import { ApprovalService } from '@/approval/approval.service';
import { AppealsService } from '@/appeals/appeals.service';
import { AppealsModule } from '@/appeals/appeals.module';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PublishService } from '@/publish/publish.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { FixtureFactory } from '../fixtures/fixture-factory';

/** Owns a disposable database; never reads or migrates external DATABASE_URL. */
describe('Prepublication confirmation and HR appeal (isolated PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let factory: FixtureFactory;
  let tasks: TasksService;
  let final: FinalGradeService;
  let calibration: CalibrationService;
  let approval: ApprovalService;
  let appeals: AppealsService;
  let publish: PublishService;
  let app: INestApplication;
  let httpViewer: AuthUser | undefined;
  let manager: AuthUser, head: AuthUser, approver: AuthUser, hr: AuthUser;
  let deptId: string;
  let sequence = 0;
  const notifications = {
    create: jest.fn(async () => undefined),
    sendResultPublished: jest.fn(async () => undefined),
  } as unknown as NotificationsService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('hrm_prepublication_confirmation').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri();
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe', timeout: 60000,
      });
    } catch {
      throw new Error('Migrations failed in the disposable prepublication database');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    factory = new FixtureFactory(prisma);
    const flow = new FlowService(prisma);
    tasks = new TasksService(prisma, {} as any, {} as any, flow, notifications, {} as any, {} as any, {} as any);
    final = new FinalGradeService(prisma, flow, notifications);
    calibration = new CalibrationService(prisma, flow, notifications);
    approval = new ApprovalService(prisma, flow, notifications);
    appeals = new AppealsService(prisma);
    publish = new PublishService(prisma, flow, notifications);
    deptId = (await factory.createDept({ name: 'Virtual prepublication department' })).id;
    [manager, head, approver, hr] = await Promise.all([
      role('MANAGER', SysRole.employee), role('HEAD', SysRole.employee), role('APPROVER', SysRole.employee), role('HR', SysRole.hr),
    ]);
    const module = await Test.createTestingModule({
      controllers: [...Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppealsModule), TasksController],
      providers: [{provide:AppealsService,useValue:appeals}, {provide:TasksService,useValue:tasks}, {provide:TeamTasksService,useValue:{}}],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    // Only authentication is supplied by the fixture; actual controller roles, validation and services run.
    app.useGlobalGuards({canActivate(context) {
      if (!httpViewer) throw new UnauthorizedException();
      context.switchToHttp().getRequest().user = httpViewer;
      return true;
    }}, new RolesGuard(new Reflector()));
    await app.init();
  }, 120000);

  afterAll(async () => {
    try { await app?.close(); await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  async function role(label: string, sysRole: SysRole): Promise<AuthUser> {
    const user = await factory.createUser({ employeeNo: `PREPUB-${label}`, name: `Virtual ${label}`, sysRole, deptId, password: randomUUID() });
    return { id: user.id, name: user.name, sysRole, deptId, isAssessorOnly: false, canViewAll: false };
  }

  async function fixture(combined = false, cycleId?: string) {
    sequence += 1;
    const employee = await role(`EMPLOYEE-${sequence}`, SysRole.employee);
    if (!cycleId) cycleId = (await factory.createCycle({ name: `Virtual publication ${sequence}`, createdBy: hr.id, status: 'manager_score' })).id;
    await prisma.assessmentCycle.update({where:{id:cycleId}, data:{workflowVersion:2,notificationMode:'off'}});
    const task = await factory.createTaskInStatus({cycleId,employeeId:employee.id,managerId:manager.id,
      deptHeadId:combined ? manager.id : head.id,approverId:approver.id,deptId,status:'manager_scoring'});
    const done = new Date('2026-08-31T08:00:00Z');
    const indicator = await prisma.indicatorInstance.findFirstOrThrow({where:{taskId:task.id,indicatorType:'kpi'}});
    const version = await prisma.indicatorVersion.create({data:{taskId:task.id,version:1,status:'active',effectiveFromPeriodKey:'2026-06',createdById:employee.id,activatedAt:done,
      items:{create:{sourceInstanceId:indicator.id,name:indicator.name,weight:1,indicatorType:'kpi',dimensionWeight:1,sortOrder:0}}},include:{items:true}});
    for (let i=0;i<3;i++) {
      await prisma.assessmentPeriod.create({data:{taskId:task.id,periodKey:`2026-0${6+i}`,periodType:'month',sequence:i+1,
        periodStart:new Date(Date.UTC(2026,5+i,1)),periodEnd:new Date(Date.UTC(2026,6+i,0)),managerId:manager.id,indicatorVersionId:version.id,
        status:'completed',selfEvalOpenAt:done,selfEvalDueAt:done,managerDueAt:done,openedAt:done,lockedAt:done,
        employeeSubmittedAt:done,managerSubmittedAt:done,selfScoreTotal:80+i,managerScoreTotal:80+i*5,selfGrade:'B',managerGrade:i===2?'A':'B',
        indicatorReviews:{create:{indicatorVersionItemId:version.items[0].id,selfScore:80+i,managerScore:80+i*5,employeeComment:`Original month ${i+1}`,managerComment:`Original manager opinion ${i+1}`}},
      }});
    }
    return { task, employee, cycleId, combined };
  }

  async function evidence(taskId: string) {
    return prisma.assessmentTask.findUniqueOrThrow({where:{id:taskId},include:{gradeResult:true,appeals:true,flowRecords:{orderBy:{createdAt:'asc'}},periods:{orderBy:{sequence:'asc'},include:{indicatorReviews:true}}}});
  }

  async function approveResult(data: Awaited<ReturnType<typeof fixture>>, grade: 'A'|'B'='B') {
    await final.submitFinalGrade(data.task.id,{grade,comment:'Virtual cycle-grade opinion'},manager);
    if (!data.combined) await tasks.deptReview(data.task.id,{action:'approve',comment:'Virtual department review'},head);
    await calibration.confirm(data.cycleId,{taskIds:[data.task.id]},hr);
    await approval.approveTasks(data.cycleId,{taskIds:[data.task.id],comment:'Virtual frozen approver opinion'},approver);
    expect((await evidence(data.task.id)).status).toBe('approval');
  }

  it.each([false,true])('completes the real review chain, employee objection and reconfirmation with combined review=%s', async combined => {
    const data=await fixture(combined); const originalMonths=(await evidence(data.task.id)).periods;
    await approveResult(data);
    await expect(tasks.employeeConfirm(data.task.id,hr)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(publish.publishCycle(data.cycleId,{taskIds:[data.task.id]},hr)).rejects.toBeInstanceOf(ConflictException);
    await tasks.employeeDisagree(data.task.id,'Virtual objection requiring reevaluation',data.employee);
    const returned=await evidence(data.task.id);
    expect(returned).toMatchObject({status:'manager_scoring',approvedAt:null,employeeConfirmedAt:null,managerScoredAt:null,deptReviewedAt:null,hrCalibratedAt:null});
    expect(returned.gradeResult).toMatchObject({approvedAt:null,employeeConfirmedAt:null,hrCalibratedAt:null,calibratedGrade:null});
    expect(returned.periods).toEqual(originalMonths);
    expect(returned.appeals).toHaveLength(0);
    expect((await final.getFinalGrade(data.task.id,manager)).latestReject).toMatchObject({nodeType:'employee_confirm',comment:'Virtual objection requiring reevaluation'});
    await expect(tasks.employeeConfirm(data.task.id,data.employee)).rejects.toBeInstanceOf(ConflictException);
    await approveResult(data,'A');
    await tasks.employeeConfirm(data.task.id,data.employee);
    const confirmed=await evidence(data.task.id); const confirmation=confirmed.employeeConfirmedAt;
    await publish.publishCycle(data.cycleId,{taskIds:[data.task.id],sendDingtalkNotification:false},hr);
    const published=await evidence(data.task.id);
    expect(published).toMatchObject({status:'published',employeeConfirmedAt:confirmation});
    expect(published.gradeResult).toMatchObject({isPublished:true,rawGrade:'A',employeeConfirmedAt:confirmation});
    expect(published.publishedAt).not.toBeNull(); expect(published.periods).toEqual(originalMonths);
    expect(published.flowRecords.filter(r=>r.nodeType==='employee_confirm')).toHaveLength(2);
    expect(published.flowRecords.filter(r=>r.nodeType==='approval')).toHaveLength(2);
    const notices=await prisma.notificationLog.findMany({where:{taskId:data.task.id}});
    expect(notices.map(n=>n.channel)).toEqual(['system','system','system']);
    expect(notifications.sendResultPublished).not.toHaveBeenCalled();
    console.log(JSON.stringify({case:'objection-reconfirmation-publication',combined,status:published.status,finalGrade:published.gradeResult?.rawGrade,monthsUnchanged:true,approvalRecords:2,confirmationRecords:2,notificationChannels:[...new Set(notices.map(n=>n.channel))]}));
  });

  it('confirms once under concurrent employee submissions and preserves the first timestamp', async () => {
    const data=await fixture(true); await approveResult(data);
    const results=await Promise.allSettled([tasks.employeeConfirm(data.task.id,data.employee),tasks.employeeConfirm(data.task.id,data.employee)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    const stored=await evidence(data.task.id);
    expect(stored.flowRecords.filter(r=>r.nodeType==='employee_confirm')).toHaveLength(1);
    expect(stored.employeeConfirmedAt).toEqual(stored.gradeResult?.employeeConfirmedAt);
  });

  it.each([false,true])('employee objection returns directly to the frozen manager and supports another objection after reapproval; combined=%s', async combined => {
    const data = await fixture(combined);
    await approveResult(data);
    const originalMonths = (await evidence(data.task.id)).periods;
    await tasks.employeeDisagree(data.task.id, '请核实本周期等级依据', data.employee);
    const returned = await evidence(data.task.id);
    expect(returned).toMatchObject({status:'manager_scoring',managerId:manager.id,approvedAt:null,employeeConfirmedAt:null,deptReviewedAt:null,hrCalibratedAt:null});
    expect(returned.periods).toEqual(originalMonths);
    expect(returned.appeals).toHaveLength(0);
    expect((await final.getFinalGrade(data.task.id,manager)).latestReject).toMatchObject({comment:'请核实本周期等级依据'});
    const notice = await prisma.notificationLog.findFirstOrThrow({where:{taskId:data.task.id,type:'employee_result_objection'}});
    expect(notice).toMatchObject({userId:manager.id,senderId:data.employee.id,channel:'system'});
    await expect(publish.publishCycle(data.cycleId,{taskIds:[data.task.id]},hr)).rejects.toBeInstanceOf(ConflictException);
    await approveResult(data,'A');
    await tasks.employeeDisagree(data.task.id, '重新审批后仍需补充说明', data.employee);
    const repeated = await evidence(data.task.id);
    expect(repeated.appeals).toHaveLength(0);
    expect(repeated.flowRecords.filter(r=>r.nodeType==='employee_confirm' && r.action==='reject').map(r=>r.comment)).toEqual(['请核实本周期等级依据','重新审批后仍需补充说明']);
    await approveResult(data,'A');
    await tasks.employeeConfirm(data.task.id,data.employee);
    await publish.publishCycle(data.cycleId,{taskIds:[data.task.id],sendDingtalkNotification:false},hr);
    const published = await evidence(data.task.id);
    expect(published).toMatchObject({status:'published'});
    expect(published.appeals).toHaveLength(0);
    expect(published.periods).toEqual(originalMonths);
  });

  it('employee objection rejects another employee, blank reason, unapproved, confirmed and published results without changing them', async () => {
    const data = await fixture(true);
    await expect(tasks.employeeDisagree(data.task.id,'异议',data.employee)).rejects.toBeInstanceOf(ConflictException);
    await approveResult(data);
    const original = await evidence(data.task.id);
    await expect(tasks.employeeDisagree(data.task.id,'异议',hr)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(tasks.employeeDisagree(data.task.id,'  ',data.employee)).rejects.toThrow();
    expect(await evidence(data.task.id)).toEqual(original);
    await tasks.employeeConfirm(data.task.id,data.employee);
    await expect(tasks.employeeDisagree(data.task.id,'异议',data.employee)).rejects.toBeInstanceOf(ConflictException);
    await publish.publishCycle(data.cycleId,{taskIds:[data.task.id]},hr);
    await expect(tasks.employeeDisagree(data.task.id,'异议',data.employee)).rejects.toBeInstanceOf(ConflictException);
    expect((await evidence(data.task.id)).appeals).toHaveLength(0);
  });

  it('serializes employee confirmation against disagreement and repeated disagreement on the same task', async () => {
    for (const simultaneousConfirm of [false,true]) {
      const data = await fixture(true); await approveResult(data);
      const results = await Promise.allSettled([
        tasks.employeeDisagree(data.task.id,'需要重新评定',data.employee),
        simultaneousConfirm ? tasks.employeeConfirm(data.task.id,data.employee)
          : tasks.employeeDisagree(data.task.id,'重复请求',data.employee),
      ]);
      expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
      const stored = await evidence(data.task.id);
      if (stored.status === 'confirmed') { expect(stored.appeals).toHaveLength(0); }
      else { expect(stored.status).toBe('manager_scoring'); expect(stored.appeals).toHaveLength(0); expect(stored.employeeConfirmedAt).toBeNull(); }
    }
  });

  it('exposes the employee route without granting HR appeal access and validates the request before mutation', async () => {
    const data = await fixture(true); await approveResult(data);
    const endpoint = `/tasks/${data.task.id}/employee-disagree`;
    httpViewer = undefined;
    await request(app.getHttpServer()).post(endpoint).send({reason:'异议'}).expect(401);
    httpViewer = data.employee;
    await request(app.getHttpServer()).post('/appeals').send({taskId:data.task.id,reason:'异议'}).expect(403);
    for (const body of [{}, {reason:42}, {reason:'字'.repeat(2001)}, {reason:'原因',employeeId:hr.id}]) {
      await request(app.getHttpServer()).post(endpoint).send(body).expect(400);
    }
    httpViewer = hr;
    await request(app.getHttpServer()).post(endpoint).send({reason:'代替员工'}).expect(403);
    expect((await evidence(data.task.id)).appeals).toHaveLength(0);
    httpViewer = data.employee;
    const response = await request(app.getHttpServer()).post(endpoint).send({reason:'通过员工结果页直接退回'}).expect(200);
    expect(response.body).toEqual({id:data.task.id,status:'manager_scoring'});
    const returned = await evidence(data.task.id);
    expect(returned.appeals).toHaveLength(0);
    expect(returned.flowRecords).toEqual(expect.arrayContaining([expect.objectContaining({
      nodeType: 'employee_confirm', action: 'reject', comment: '通过员工结果页直接退回',
    })]));
    expect((await final.getFinalGrade(data.task.id, manager)).latestReject).toMatchObject({
      nodeType: 'employee_confirm', comment: '通过员工结果页直接退回',
    });
    await request(app.getHttpServer()).post(endpoint).send({reason:'重复'}).expect(409);
  });

  it('limits the HR appeal ledger API to HR administrators and configured performance specialists', async () => {
    const specialist = { ...await role(`SPECIALIST-${++sequence}`, SysRole.hr_user), hrCapabilities: ['cycle_plan_edit', 'performance_publish'] };
    const ordinaryHr = await role(`ORDINARY-HR-${++sequence}`, SysRole.hr_user);
    const administrator = await role(`SYSTEM-ADMIN-${++sequence}`, SysRole.system_admin);
    for (const [viewer, expectedStatus] of [[hr, 200], [specialist, 200], [ordinaryHr, 403], [administrator, 403], [manager, 403]] as const) {
      httpViewer = viewer;
      await request(app.getHttpServer()).get('/appeals').expect(expectedStatus);
    }
  });

  it('HR ledger entry and later conclusion leave the assessment task unchanged', async () => {
    const data=await fixture(true); await approveResult(data);
    const before=await evidence(data.task.id);
    const record=await appeals.create({employeeId:data.employee.id,cycleId:data.cycleId,
      receivedAt:'2026-09-14',subject:'周期评定依据',content:'希望核实评定依据'},hr);
    expect(record).toMatchObject({employeeId:data.employee.id,cycleId:data.cycleId,subject:'周期评定依据',recordedByName:hr.name});
    expect((await appeals.findAll({cycleId:data.cycleId} as any,hr)).items.map(item=>item.id)).toContain(record.id);
    const updated=await appeals.update(record.id,{handlingNote:'已核查沟通',conclusion:'记录完成'},hr);
    expect(updated).toMatchObject({handlingNote:'已核查沟通',conclusion:'记录完成'});
    expect(await evidence(data.task.id)).toEqual(before);
    expect((await prisma.hrAppealRecord.count({where:{employeeId:data.employee.id}}))).toBe(1);
    expect((await prisma.auditLog.findMany({where:{entityType:'hr_appeal_record',entityId:record.id}})).map(log=>log.action)).toEqual(['create','update']);
  });

  it('allows other confirmed employees to publish while one employee is in reassessment', async () => {
    const data=await fixture(true); const other=await fixture(true,data.cycleId);
    await approveResult(data);await approveResult(other);
    await tasks.employeeConfirm(other.task.id,other.employee);
    await tasks.employeeDisagree(data.task.id,'Only this employee needs reassessment',data.employee);
    await publish.publishCycle(data.cycleId,{taskIds:[other.task.id]},hr);
    expect((await evidence(other.task.id)).status).toBe('published');expect((await evidence(data.task.id)).status).toBe('manager_scoring');
    expect((await prisma.assessmentCycle.findUniqueOrThrow({where:{id:data.cycleId}})).status).not.toBe('published');
  });
});
