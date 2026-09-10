import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { RolesGuard } from '@/common/guards/roles.guard';
import { InterviewsController } from '@/interviews/interviews.controller';
import { InterviewsService } from '@/interviews/interviews.service';
import { FixtureFactory } from '../fixtures/fixture-factory';

/** Always owns its database; never uses external DATABASE_URL or notification providers. */
describe('Interview ledger HTTP and persistence', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let prisma: PrismaService;
  let app: INestApplication;
  let factory: FixtureFactory;
  let viewer: AuthUser | undefined;
  let hr: AuthUser, employee: AuthUser, manager: AuthUser;
  let deptId: string;
  let recordId: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').withDatabase('hrm_interview_ledger').withStartupTimeout(60000).start();
    const databaseUrl = container.getConnectionUri();
    try {
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60000,
      });
    } catch { throw new Error('Interview ledger migrations failed in disposable database'); }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    factory = new FixtureFactory(prisma);
    deptId = (await factory.createDept({ name: 'Virtual ledger department' })).id;
    async function role(name: string, sysRole: SysRole): Promise<AuthUser> {
      const user = await factory.createUser({ employeeNo: 'LEDGER-' + name, name, sysRole, deptId, password: randomUUID() });
      return { id: user.id, name, sysRole, deptId, isAssessorOnly: false, canViewAll: false };
    }
    hr = await role('HR', SysRole.hr_user);
    employee = await role('Employee', SysRole.employee);
    manager = await role('Manager', SysRole.employee);
    const module = await Test.createTestingModule({
      controllers: [InterviewsController],
      providers: [InterviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalGuards({ canActivate(context) {
      if (!viewer) throw new UnauthorizedException();
      context.switchToHttp().getRequest().user = viewer;
      return true;
    } }, new RolesGuard(new Reflector()));
    await app.init();
  }, 120000);
  afterAll(async () => {
    try { await app?.close(); await prisma?.$disconnect(); } finally { await container?.stop(); }
  }, 30000);

  it('ordinary HR records two interviews for the same employee without any cycle or task', async () => {
    viewer = hr;
    const body = { employeeId: employee.id, interviewerId: manager.id, interviewTime: '2026-09-10T10:30:00+08:00', achievements: 'Private HR notes' };
    const first = await request(app.getHttpServer()).post('/interviews').send(body).expect(201);
    recordId = first.body.id;
    const second = await request(app.getHttpServer()).post('/interviews').send(body).expect(201);
    expect(first.body.cycleId).toBeNull();
    expect(first.body.recordedByName).toBe('HR');
    expect(second.body.id).not.toBe(recordId);
    expect(await prisma.assessmentTask.count()).toBe(0);
    expect(await prisma.flowRecord.count()).toBe(0);
    expect(await prisma.signature.count()).toBe(0);
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'performance_interview', userId: hr.id, action: 'create' } })).toBe(2);
    expect((await prisma.performanceInterview.findUniqueOrThrow({ where: { id: recordId } })).interviewTime?.toISOString()).toBe('2026-09-10T02:30:00.000Z');
  });
  it('validates create input and prevents clients assigning workflow/recorder fields', async () => {
    viewer = hr;
    for (const body of [{ employeeId: employee.id }, { employeeId: employee.id, interviewTime: 'bad' },
      { employeeId: employee.id, interviewTime: '2026-09-10T10:00:00Z', recordedById: employee.id },
      { employeeId: employee.id, interviewTime: '2026-09-10T10:00:00Z', taskId: randomUUID() }]) {
      await request(app.getHttpServer()).post('/interviews').send(body).expect(400);
    }
    expect(await prisma.performanceInterview.count()).toBe(2);
  });
  it('HR can edit and reread a record, with an audit of the previous content', async () => {
    viewer = hr;
    await request(app.getHttpServer()).put('/interviews/' + recordId).send({ achievements: 'Updated notes' }).expect(200);
    const res = await request(app.getHttpServer()).get('/interviews/' + recordId).expect(200);
    expect(res.body.achievements).toBe('Updated notes');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: recordId, action: 'update' } });
    expect(audit.oldValue).toMatchObject({ achievements: 'Private HR notes' });
    expect(audit.newValue).toMatchObject({ achievements: 'Updated notes' });
  });
  it('employee and the named interviewer have no ledger reads or writes', async () => {
    for (const user of [employee, { ...manager, canViewAll: true }]) {
      viewer = user;
      for (const url of ['/interviews', '/interviews/' + recordId, '/interviews/people', '/interviews/cycles']) {
        await request(app.getHttpServer()).get(url).expect(403);
      }
      await request(app.getHttpServer()).post('/interviews').send({ employeeId: employee.id, interviewTime: new Date().toISOString() }).expect(403);
      await request(app.getHttpServer()).put('/interviews/' + recordId).send({ achievements: 'Forbidden' }).expect(403);
    }
    viewer = hr;
    for (const action of ['manager-sign', 'employee-sign']) {
      await request(app.getHttpServer()).post('/interviews/' + recordId + '/' + action).expect(404);
    }
    await request(app.getHttpServer()).get('/tasks/' + randomUUID() + '/interview').expect(404);
  });
  it('filters and pages independent records, and returns only needed identity fields', async () => {
    viewer = hr;
    const res = await request(app.getHttpServer()).get('/interviews').query({ deptId, keyword: 'LEDGER-Employee', pageSize: 1, page: 2 }).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).not.toHaveProperty('achievements');
    const people = await request(app.getHttpServer()).get('/interviews/people').query({ keyword: 'Employee' }).expect(200);
    expect(people.body).toHaveLength(1);
    expect(Object.keys(people.body[0]).sort()).toEqual(['dept', 'employeeNo', 'id', 'name']);
  });
  it('retains legacy notes and signatures while unlinking the ledger from task deletion', async () => {
    const task = await factory.createTaskInStatus({ deptId, employeeId: employee.id, managerId: manager.id, deptHeadId: manager.id, approverId: manager.id, status: 'published' });
    const legacy = await prisma.performanceInterview.create({ data: {
      taskId: task.id, cycleId: task.cycleId, employeeId: employee.id, interviewerId: manager.id,
      achievements: 'Legacy notes', status: 'closed', managerSignedAt: new Date(), employeeSignedAt: new Date(),
    } });
    await prisma.signature.create({ data: { businessType: 'interview', businessRecordId: legacy.id, role: 'assessee', signerId: employee.id } });
    viewer = hr;
    await request(app.getHttpServer()).put('/interviews/' + legacy.id).send({ otherMatters: 'Additional ledger note' }).expect(200);
    const saved = await prisma.performanceInterview.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(saved.achievements).toBe('Legacy notes');
    expect(saved.employeeSignedAt).not.toBeNull();
    await prisma.assessmentTask.delete({ where: { id: task.id } });
    expect((await prisma.performanceInterview.findUniqueOrThrow({ where: { id: legacy.id } })).taskId).toBeNull();
    expect(await prisma.signature.count({ where: { businessRecordId: legacy.id } })).toBe(1);
  });
});
