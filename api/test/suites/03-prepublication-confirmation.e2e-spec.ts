import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { FlowService } from '@/tasks/flow.service';
import { TasksService } from '@/tasks/tasks.service';
import { FinalGradeService } from '@/final-grade/final-grade.service';
import { CalibrationService } from '@/calibration/calibration.service';
import { ApprovalService } from '@/approval/approval.service';
import { AppealsService } from '@/appeals/appeals.service';
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
    appeals = new AppealsService(prisma, calibration, flow);
    publish = new PublishService(prisma, flow, notifications);
    deptId = (await factory.createDept({ name: 'Virtual prepublication department' })).id;
    [manager, head, approver, hr] = await Promise.all([
      role('MANAGER', SysRole.employee), role('HEAD', SysRole.employee), role('APPROVER', SysRole.employee), role('HR', SysRole.hr),
    ]);
  }, 120000);

  afterAll(async () => {
    try { await prisma?.$disconnect(); } finally { await container?.stop(); }
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

  it.each([false,true])('completes the real review chain, HR appeal and reconfirmation with combined review=%s', async combined => {
    const data=await fixture(combined); const originalMonths=(await evidence(data.task.id)).periods;
    await approveResult(data);
    await expect(tasks.employeeConfirm(data.task.id,hr)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(publish.publishCycle(data.cycleId,{taskIds:[data.task.id]},hr)).rejects.toBeInstanceOf(ConflictException);
    await tasks.employeeConfirm(data.task.id,data.employee);
    const first=(await evidence(data.task.id)); expect(first.employeeConfirmedAt).not.toBeNull(); expect(first.publishedAt).toBeNull();
    expect((await appeals.findCandidates({cycleId:data.cycleId},new PaginationDto())).items.map(t=>t.id)).toContain(data.task.id);
    const appeal=await appeals.create({taskId:data.task.id,reason:'Virtual offline objection requiring reevaluation'},hr);
    const returned=await evidence(data.task.id);
    expect(returned).toMatchObject({status:'manager_scoring',approvedAt:null,employeeConfirmedAt:null,managerScoredAt:null,deptReviewedAt:null,hrCalibratedAt:null});
    expect(returned.gradeResult).toMatchObject({approvedAt:null,employeeConfirmedAt:null,hrCalibratedAt:null,calibratedGrade:null});
    expect(returned.periods).toEqual(originalMonths);
    expect((await final.getFinalGrade(data.task.id,manager)).latestReject).toMatchObject({nodeType:'appeal',comment:'Virtual offline objection requiring reevaluation'});
    const appealDetail=await appeals.findOne(appeal.id);
    expect(appealDetail).toMatchObject({workflowType:'prepublication',canResolve:false,originalResult:{calculatedScore:85}});
    await expect(appeals.resolve(appeal.id,{result:'modified',newGrade:'A',resolution:'Forbidden shortcut'},hr)).rejects.toBeInstanceOf(ConflictException);
    await expect(tasks.employeeConfirm(data.task.id,data.employee)).rejects.toBeInstanceOf(ConflictException);
    await approveResult(data,'A');
    await tasks.employeeConfirm(data.task.id,data.employee);
    expect((await appeals.findOne(appeal.id))).toMatchObject({status:'resolved',finalResult:'modified',canResolve:false});
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
    console.log(JSON.stringify({case:'appeal-reconfirmation-publication',combined,status:published.status,finalGrade:published.gradeResult?.rawGrade,monthsUnchanged:true,approvalRecords:2,confirmationRecords:2,notificationChannels:[...new Set(notices.map(n=>n.channel))]}));
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

  it('serializes publication against HR appeal on the same real row', async () => {
    const data=await fixture(true);await approveResult(data);await tasks.employeeConfirm(data.task.id,data.employee);
    const results=await Promise.allSettled([
      publish.publishCycle(data.cycleId,{taskIds:[data.task.id]},hr),
      appeals.create({taskId:data.task.id,reason:'Concurrent offline objection'},hr),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const stored=await evidence(data.task.id);
    if(stored.status==='published') { expect(stored.appeals).toHaveLength(0);expect(stored.gradeResult?.isPublished).toBe(true); }
    else { expect(stored.status).toBe('manager_scoring');expect(stored.appeals).toHaveLength(1);expect(stored.publishedAt).toBeNull(); }
    console.log(JSON.stringify({case:'publication-appeal-race',winner:stored.status,pendingAppeals:stored.appeals.length}));
  });

  it('allows other confirmed employees to publish while one employee is in reassessment', async () => {
    const data=await fixture(true); const other=await fixture(true,data.cycleId);
    await approveResult(data);await approveResult(other);
    await tasks.employeeConfirm(data.task.id,data.employee);await tasks.employeeConfirm(other.task.id,other.employee);
    await appeals.create({taskId:data.task.id,reason:'Only this employee needs reassessment'},hr);
    await publish.publishCycle(data.cycleId,{taskIds:[other.task.id]},hr);
    expect((await evidence(other.task.id)).status).toBe('published');expect((await evidence(data.task.id)).status).toBe('manager_scoring');
    expect((await prisma.assessmentCycle.findUniqueOrThrow({where:{id:data.cycleId}})).status).not.toBe('published');
  });
});
