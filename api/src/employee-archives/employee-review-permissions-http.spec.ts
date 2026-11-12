import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SysRole } from '@prisma/client';
import request from 'supertest';
import { AuthUser } from '@/common/types/auth.types';
import { RolesGuard } from '@/common/guards/roles.guard';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';

describe('archive review permissions across the route and review service', () => {
  let app: INestApplication;
  let actor: AuthUser;
  let review: Record<string, any>;
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const audited: Record<string, any>[] = [];
  const tx = {
    employeeDataChangeRequest: {
      findUnique: jest.fn(async ({ where }: any) => where.id === reviewId ? { ...review } : null),
      update: jest.fn(async ({ data }: any) => Object.assign(review, data)),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audited.push(data); return data; }) },
  };
  const db = { $transaction: jest.fn(async (run: any) => run(tx)) };
  const service = new EmployeeDataReviewsService(db as any);
  const onboarding = { confirmArrival: jest.fn(async (_id: string, input: any, operator: AuthUser) => ({
    id: reviewId, ...input, arrivalConfirmedById: operator.id, onboardingStatus: 'effective',
  })), reviseArrivalDate: jest.fn(async () => ({ id: reviewId, profileReviewStatus: 'pending' })) };
  const reject = () => request(app.getHttpServer()).post('/employee-archives/reviews/reject')
    .send({ requestIds: [reviewId], reason: '请补充资料' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeeArchivesController],
      providers: [
        { provide: EmployeeArchivesService, useValue: {} },
        { provide: EmployeeRosterImportService, useValue: {} },
        { provide: EmployeeDataReviewsService, useValue: service },
        { provide: PersonnelDiagnosticsService, useValue: {} },
        { provide: EmployeeIdentityMatchService, useValue: {} },
        { provide: EmployeeOnboardingService, useValue: onboarding },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    audited.length = 0;
    actor = { id: 'synthetic-reviewer', name: '审核员', sysRole: SysRole.hr_user,
      deptId: 'reviewer-department', isAssessorOnly: false, canViewAll: false,
      hrCapabilities: ['employee_archive_review'] };
    review = { id: reviewId, userId: 'synthetic-employee-in-other-department', recordStatus: 'submitted',
      archivedAt: null, profileReviewStatus: 'pending', performanceReviewStatus: 'not_required' };
  });

  it.each([SysRole.hr_user, SysRole.hr, SysRole.system_admin])('lets the existing reviewer capability or administrator %s return a pending archive with audit', async role => {
    actor.sysRole = role;
    if (role !== SysRole.hr_user) actor.hrCapabilities = [];
    const response = await reject().expect(201);
    expect(response.body).toEqual({ succeeded: [{ requestId: reviewId, scopes: ['profile', 'performance'] }], failed: [] });
    expect(review).toMatchObject({ profileReviewStatus: 'rejected', profileReviewedById: actor.id,
      performanceReviewStatus: 'not_required', rejectedReason: '请补充资料' });
    expect(audited).toEqual([expect.objectContaining({ userId: actor.id, action: 'reject_employee_data_change',
      entityId: reviewId, newValue: { reason: '请补充资料' } })]);
  });

  it.each([
    { role: SysRole.hr_user, capabilities: [] },
    { role: SysRole.hr_user, capabilities: ['employee_archive_edit'] },
    { role: SysRole.employee, capabilities: ['employee_archive_review'] },
  ])('denies a non-reviewer at the route and service ($role, $capabilities)', async ({ role, capabilities }) => {
    actor.sysRole = role;
    actor.hrCapabilities = capabilities;
    await reject().expect(403);
    await expect(service.rejectBatch([reviewId], '请补充资料', actor)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(review.profileReviewStatus).toBe('pending');
    expect(audited).toEqual([]);
  });

  it('does not grant archive editing to a review-only HR user', async () => {
    await request(app.getHttpServer()).patch('/employee-archives/22222222-2222-4222-8222-222222222222/profile')
      .send({}).expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('exposes arrival confirmation to a review-only actor with strict body validation', async () => {
    const route = `/employee-archives/applications/${reviewId}/confirm-arrival`;
    await request(app.getHttpServer()).post(route).send({ arrivalDate: '2026-11-10', requestVersion: 2 }).expect(201);
    expect(onboarding.confirmArrival).toHaveBeenCalledWith(reviewId, expect.objectContaining({ arrivalDate: '2026-11-10', requestVersion: 2 }), actor);
    await request(app.getHttpServer()).post(route).send({ arrivalDate: '2026-11-10T00:00:00Z', requestVersion: 2 }).expect(400);
    await request(app.getHttpServer()).post(route).send({ arrivalDate: '2026-11-10' }).expect(400);
    await request(app.getHttpServer()).post(route).send({ arrivalDate: '2026-11-10', requestVersion: '2' }).expect(400);
    actor.hrCapabilities = ['employee_archive_edit'];
    await request(app.getHttpServer()).post(route).send({ arrivalDate: '2026-11-10', requestVersion: 2 }).expect(403);
    expect(onboarding.confirmArrival).toHaveBeenCalledTimes(1);
  });

  it('date correction requires edit capability and returns to review', async () => {
    const route = `/employee-archives/applications/${reviewId}/arrival-date`;
    await request(app.getHttpServer()).patch(route).send({ arrivalDate: '2026-11-10', requestVersion: 2 }).expect(403);
    actor.hrCapabilities = ['employee_archive_edit'];
    await request(app.getHttpServer()).patch(route).send({ arrivalDate: '2026-11-10', requestVersion: 2 }).expect(200);
    expect(onboarding.reviseArrivalDate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { recordStatus: 'draft', reason: '草稿尚未提交审核' },
    { recordStatus: 'archived', reason: '该记录已归档' },
    { profileReviewStatus: 'approved', reason: '该记录已处理' },
  ])('keeps record-state restrictions for a capability reviewer ($reason)', async ({ reason, ...state }) => {
    Object.assign(review, state);
    const response = await reject().expect(201);
    expect(response.body).toEqual({ succeeded: [], failed: [{ requestId: reviewId, reason }] });
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
  });
});
