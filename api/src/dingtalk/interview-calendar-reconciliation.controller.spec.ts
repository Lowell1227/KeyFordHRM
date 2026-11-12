import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { InterviewCalendarReconciliationController } from './interview-calendar-reconciliation.controller';
import { InterviewCalendarReconciliationService } from './interview-calendar-reconciliation.service';

describe('Interview calendar reconciliation HTTP contract (no external providers)', () => {
  let app: INestApplication;
  const reconcile = jest.fn().mockResolvedValue({ status: 'pending', version: 3 });
  const id = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [InterviewCalendarReconciliationController],
      providers: [{ provide: InterviewCalendarReconciliationService, useValue: { reconcile } }] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      const role = req.headers['x-test-role'];
      req.user = { id: 'synthetic-editor', sysRole: role === 'editor' || role === 'reviewer' ? 'hr_user' : role,
        hrCapabilities: role === 'editor' ? ['employee_archive_edit'] : role === 'reviewer' ? ['employee_archive_review'] : [] };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => reconcile.mockClear());
  it.each(['editor', 'hr', 'system_admin'])('allows existing %s maintenance rights without a new capability', async (role) => {
    const result = await request(app.getHttpServer()).post(`/talent-interviews/${id}/reconcile-calendar`)
      .set('x-test-role', role).send({ version: 3, eventId: 'must-not-be-trusted' }).expect(200);
    expect(result.body).toEqual({ status: 'pending', version: 3 });
    expect(reconcile).toHaveBeenCalledWith(id, 3, expect.objectContaining({ id: 'synthetic-editor' }));
  });
  it.each(['employee', 'reviewer'])('denies %s before any reconciliation', async (role) => {
    await request(app.getHttpServer()).post(`/talent-interviews/${id}/reconcile-calendar`)
      .set('x-test-role', role).send({ version: 3 }).expect(403);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it.each([{}, { version: 0 }, { version: 1.5 }, { version: '3' }])('requires a positive integer version', async (body) => {
    await request(app.getHttpServer()).post(`/talent-interviews/${id}/reconcile-calendar`)
      .set('x-test-role', 'editor').send(body).expect(400);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it('rejects a malformed interview ID', async () => {
    await request(app.getHttpServer()).post('/talent-interviews/not-a-uuid/reconcile-calendar')
      .set('x-test-role', 'editor').send({ version: 3 }).expect(400);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
