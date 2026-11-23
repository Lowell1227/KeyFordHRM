import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { PayrollAttendanceSyncController } from './payroll-attendance-sync.controller';
import { PayrollAttendanceSyncService } from './payroll-attendance-sync.service';

describe('server-only DingTalk attendance synchronization HTTP contract', () => {
  let app: INestApplication;
  const subjectId = '30000000-0000-4000-8000-000000000001', id = '30000000-0000-4000-8000-000000000002';
  const requestId = '30000000-0000-4000-8000-000000000003', actor = { id: 'fictional-current-actor' };
  const service = { list: jest.fn(), start: jest.fn(), cancel: jest.fn(), retry: jest.fn() };
  const root = '/api/v1/payroll/attendance/dingtalk/jobs';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PayrollAttendanceSyncController], providers: [{ provide: PayrollAttendanceSyncService, useValue: service }] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor()); await app.init();
  });
  beforeEach(() => { jest.clearAllMocks(); service.list.mockResolvedValue([]); service.start.mockResolvedValue({ id }); service.cancel.mockResolvedValue({ id, status: 'cancelled' }); service.retry.mockResolvedValue({ id }); });
  afterAll(async () => { await app?.close(); });
  it('only accepts server-owned scope and idempotent request identity, not client completion', async () => {
    await request(app.getHttpServer()).post(root).send({ subjectId, month: '2035-11', requestId }).expect(201);
    expect(service.start).toHaveBeenCalledWith({ subjectId, month: '2035-11', requestId }, actor);
    for (const extra of [{ complete: true }, { input: {} }, { employeeIds: [id] }, { operatorId: id }, { workflowInstanceRead: true }]) {
      await request(app.getHttpServer()).post(root).send({ subjectId, month: '2035-11', requestId, ...extra }).expect(400);
    }
    expect(service.start).toHaveBeenCalledTimes(1);
  });
  it('validates list, cancellation and retry without losing their authenticated operator', async () => {
    const response = await request(app.getHttpServer()).get(root).query({ subjectId, month: '2035-11' }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(service.list).toHaveBeenCalledWith(subjectId, '2035-11', actor);
    await request(app.getHttpServer()).post(`${root}/${id}/cancel`).send({}).expect(201);
    expect(service.cancel).toHaveBeenCalledWith(id, actor);
    await request(app.getHttpServer()).post(`${root}/${id}/retry`).send({ requestId }).expect(201);
    expect(service.retry).toHaveBeenCalledWith(id, { requestId }, actor);
  });
  it('rejects invalid dates, unknown filters, forged cancel metadata and stale external identity', async () => {
    await request(app.getHttpServer()).get(root).query({ subjectId, month: '2035-13' }).expect(400);
    await request(app.getHttpServer()).get(root).query({ subjectId, month: '2035-11', salary: 'forbidden' }).expect(400);
    await request(app.getHttpServer()).post(`${root}/${id}/cancel`).send({ actorId: id }).expect(400);
    await request(app.getHttpServer()).post(`${root}/${id}/retry`).send({ requestId, corpId: 'forged' }).expect(400);
    await request(app.getHttpServer()).post(`${root}/invalid/retry`).send({ requestId }).expect(400);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
});
