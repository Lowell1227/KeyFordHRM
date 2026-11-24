import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { EmployeeArchivesController } from '@/employee-archives/employee-archives.controller';
import { EmployeeArchivesService } from '@/employee-archives/employee-archives.service';
import { EmployeeDataReviewsService } from '@/employee-archives/employee-data-reviews.service';
import { EmployeeRosterImportService } from '@/employee-archives/employee-roster-import.service';
import { PersonnelDiagnosticsService } from '@/employee-archives/personnel-diagnostics.service';
import { EmployeeIdentityMatchService } from '@/employee-archives/employee-identity-match.service';
import { EmployeeOnboardingService } from '@/employee-archives/employee-onboarding.service';

type Decision = 'approve' | 'reject';
type Seen = { id: string; requestVersion: number; userId: string | null; talentCandidateId: string | null };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('review versions over HTTP with exclusive disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: PrismaService, writer: PrismaService, observer: PrismaService, app: INestApplication;
  let editor: { id: string }, reviewer: { id: string; name: string; sysRole: 'hr_user'; hrCapabilities: string[] };
  let manager: { id: string }, revisedManager: { id: string };
  const database = `review_version_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:14-alpine')
      .withDatabase(database).withUsername('review_version_test').withPassword(randomBytes(24).toString('hex'))
      .withLabels({ 'hrm.test': 'employee-review-version' }).start();
    const url = new URL(container.getConnectionUri());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== `/${database}`) {
      throw new Error('Refusing a non-exclusive test database');
    }
    // Never use an environment datasource: migration and every connection receive this container URL explicitly.
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe',
    });
    const client = () => new PrismaService({ datasources: { db: { url: url.toString() } } });
    db = client(); writer = client(); observer = client();
    const [{ name }] = await observer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(name).toBe(database);
    editor = await db.user.create({ data: { name: 'Fictional editor', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] } });
    const persistedReviewer = await db.user.create({ data: { name: 'Fictional reviewer', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] } });
    reviewer = { id: persistedReviewer.id, name: persistedReviewer.name, sysRole: 'hr_user', hrCapabilities: persistedReviewer.hrCapabilities };
    manager = await db.user.create({ data: { name: 'Fictional original manager', status: 'active' } });
    revisedManager = await db.user.create({ data: { name: 'Fictional revised manager', status: 'active' } });
    const module = await Test.createTestingModule({
      controllers: [EmployeeArchivesController],
      providers: [
        { provide: EmployeeDataReviewsService, useValue: new EmployeeDataReviewsService(db) },
        ...[EmployeeArchivesService, EmployeeRosterImportService, PersonnelDiagnosticsService,
          EmployeeIdentityMatchService, EmployeeOnboardingService].map(provide => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { ...reviewer, deptId: null, isAssessorOnly: false, canViewAll: false };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
  }, 180000);

  afterAll(async () => {
    try {
      await app?.close();
      await Promise.all([db?.$disconnect(), writer?.$disconnect(), observer?.$disconnect()]);
    } finally { await container?.stop(); }
  });

  async function fixture(version = 1, linked = false) {
    const employee = await db.user.create({ data: { name: `Fictional employee ${randomUUID().slice(0, 8)}`, status: 'active' } });
    const candidate = linked ? await db.talentCandidate.create({ data: {
      name: 'Fictional source candidate', phone: `TEST-${randomUUID().slice(0, 8)}`, sourceChannel: 'other', createdById: editor.id,
    } }) : null;
    return db.employeeDataChangeRequest.create({ data: {
      userId: employee.id, employeeName: employee.name, createdById: editor.id,
      sourceType: 'manual_performance_relation', recordStatus: 'submitted', requestVersion: version,
      profileReviewStatus: 'not_required', performanceReviewStatus: 'pending', talentCandidateId: candidate?.id,
      baseValue: { performance: { managerId: null } }, proposedValue: { performance: { managerId: manager.id } },
    } });
  }

  function decide(action: Decision, rows: Seen[], versions?: Record<string, number>) {
    return request(app.getHttpServer()).post(`/api/v1/employee-archives/reviews/${action}`).send({
      requestIds: rows.map(row => row.id), ...(versions === undefined ? {} : { requestVersions: versions }),
      ...(action === 'approve' ? { scopes: ['performance'] } : { reason: 'Fictional correction required' }),
    });
  }

  async function snapshot(row: Seen) {
    return {
      request: await observer.employeeDataChangeRequest.findUniqueOrThrow({ where: { id: row.id } }),
      employee: await observer.user.findUniqueOrThrow({ where: { id: row.userId! } }),
      audits: await observer.auditLog.findMany({ where: { entityId: row.id }, orderBy: { id: 'asc' } }),
    };
  }

  async function resubmit(tx: Prisma.TransactionClient, row: Seen) {
    return tx.employeeDataChangeRequest.update({ where: { id: row.id, requestVersion: row.requestVersion }, data: {
      requestVersion: { increment: 1 }, performanceReviewStatus: 'pending', rejectedReason: null,
      performanceReviewedById: null, performanceReviewedAt: null,
      proposedValue: { performance: { managerId: revisedManager.id } },
      revisionHistory: [{ version: row.requestVersion, performanceReviewStatus: 'rejected' }],
    } });
  }

  for (const action of ['approve', 'reject'] as const) {
    it.each(['absent', 'missing-id'])(`${action}: a missing seen version returns 409 without writes (%s)`, async missing => {
      const row = await fixture();
      const before = await snapshot(row);
      const response = await decide(action, [row], missing === 'absent' ? undefined : {});
      expect(response.status).toBe(409);
      expect(response.body.message).toContain('刷新后重新核对');
      expect(await snapshot(row)).toEqual(before);
    });

    it(`${action}: A sees v1, B returns and resubmits v2; only a newly seen v2 may be decided`, async () => {
      const seen = await fixture();
      await decide('reject', [seen], { [seen.id]: seen.requestVersion }).expect(201);
      const revised = await writer.$transaction(tx => resubmit(tx, seen));
      const before = await snapshot(revised);
      await decide(action, [seen], { [seen.id]: seen.requestVersion }).expect(409);
      expect(await snapshot(revised)).toEqual(before);
      const fresh = await decide(action, [revised], { [revised.id]: revised.requestVersion }).expect(201);
      expect(fresh.body.failed).toEqual([]);
      expect(fresh.body.succeeded.map((item: any) => item.requestId)).toEqual([revised.id]);
      const after = await snapshot(revised);
      expect(after.request.performanceReviewStatus).toBe(action === 'approve' ? 'approved' : 'rejected');
      expect(after.employee.directManagerId).toBe(action === 'approve' ? revisedManager.id : null);
      expect(after.audits).toHaveLength(before.audits.length + 1);
      expect(after.audits.find(item => item.action === `${action}_employee_data_change` &&
        (item.newValue as any)?.requestVersion === 2)).toBeDefined();
    });

    it(`${action}: a mixed batch uses each ID's own version and commits only the valid row`, async () => {
      const good = await fixture(4), stale = await fixture(2), missing = await fixture(3);
      const beforeStale = await snapshot(stale), beforeMissing = await snapshot(missing);
      const result = await decide(action, [good, stale, missing], { [good.id]: 4, [stale.id]: 1 }).expect(201);
      expect(result.body.succeeded.map((item: any) => item.requestId)).toEqual([good.id]);
      expect(result.body.failed).toEqual([
        { requestId: stale.id, reason: expect.stringContaining('刷新后重新核对') },
        { requestId: missing.id, reason: expect.stringContaining('刷新后重新核对') },
      ]);
      expect(await snapshot(stale)).toEqual(beforeStale);
      expect(await snapshot(missing)).toEqual(beforeMissing);
      const applied = await snapshot(good);
      expect(applied.audits).toHaveLength(1);
      expect(applied.request.performanceReviewStatus).toBe(action === 'approve' ? 'approved' : 'rejected');
      expect(applied.employee.directManagerId).toBe(action === 'approve' ? manager.id : null);
    });

    for (const boundary of ['candidate', 'request'] as const) {
      it(`${action}: a queued ${boundary} lock cannot carry a v1 decision across a committed v2 resubmission`, async () => {
        const seen = await fixture(1, boundary === 'candidate');
        const held = deferred<number>(), release = deferred();
        const writing = writer.$transaction(async tx => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          if (boundary === 'candidate') {
            await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${seen.talentCandidateId}::uuid FOR UPDATE`;
          } else {
            await tx.$queryRaw`SELECT id FROM employee_data_change_requests WHERE id = ${seen.id}::uuid FOR UPDATE`;
          }
          held.resolve(pid);
          await release.promise;
          await tx.employeeDataChangeRequest.update({ where: { id: seen.id }, data: { performanceReviewStatus: 'rejected' } });
          return resubmit(tx, seen);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });
        void writing.catch(held.reject);
        const writerPid = await held.promise;
        const deciding = decide(action, [seen], { [seen.id]: 1 }).then(response => response);
        try {
          const fragment = boundary === 'candidate' ? 'talent_candidates' : 'employee_data_change_requests';
          await waitForBlockedReview(writerPid, fragment);
          release.resolve();
          const revised = await writing;
          const response = await deciding;
          expect(response.status).toBe(409);
          expect(response.body.message).toContain('刷新后重新核对');
          const after = await snapshot(revised);
          expect(after.request).toMatchObject({ requestVersion: 2, performanceReviewStatus: 'pending',
            profileReviewStatus: 'not_required', performanceReviewedById: null, performanceReviewedAt: null,
            proposedValue: { performance: { managerId: revisedManager.id } } });
          expect(after.employee.directManagerId).toBeNull();
          expect(after.audits).toEqual([]);
          await decide(action, [revised], { [revised.id]: 2 }).expect(201);
          expect((await snapshot(revised)).audits).toHaveLength(1);
        } finally {
          release.resolve();
          await Promise.allSettled([writing, deciding]);
        }
      });
    }
  }

  async function waitForBlockedReview(writerPid: number, fragment: string) {
    const deadline = Date.now() + 10000;
    do {
      const blocked = await observer.$queryRaw<Array<{ query: string }>>`
        SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${writerPid}::integer = ANY(pg_blocking_pids(pid))
      `;
      if (blocked.some(row => row.query.includes(fragment))) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Review did not wait on the expected ${fragment} lock`);
  }
});
