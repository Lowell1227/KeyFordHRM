import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PayrollReadinessController } from './payroll-readiness.controller';
import { PayrollReadinessService } from './payroll-readiness.service';

describe('readiness request HTTP contract', () => {
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const root = '/api/v1/payroll/readiness/requests';
  const detail = { request: { id, version: 1, status: 'pending' }, netSnapshot: { rows: [] }, lines: [],
    actors: [], canDecide: false, canWithdraw: true, canRevoke: false };
  let app: INestApplication;
  const service = Object.fromEntries(['list', 'submit', 'detail', 'decide', 'withdraw', 'revoke'].map(method => [method, jest.fn()]));
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PayrollReadinessController],
      providers: [{ provide: PayrollReadinessService, useValue: service }] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => { req.user = { id: req.headers['x-test-user'] ?? userId }; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  beforeEach(() => { Object.values(service).forEach(fn => fn.mockReset().mockResolvedValue(detail)); service.list.mockResolvedValue([]); });
  afterAll(async () => { await app?.close(); });

  const submit = { batchId: id, expectedVersion: 4, firstMonth: '2026-11', reference: 'Fictional comparison', requestId: subjectId };
  it('binds submit to the server actor and returns the agreed detail shape', async () => {
    const result = await request(app.getHttpServer()).post(root).send(submit).expect(201);
    expect(result.body).toEqual(detail);
    expect(service.submit).toHaveBeenCalledWith(submit, { id: userId });
  });
  it.each(['actor', 'approvedById', 'approvalPath', 'sourceHash', 'netSnapshot', 'state', 'subjectId'])('rejects a forged %s before service dispatch', async key => {
    await request(app.getHttpServer()).post(root).send({ ...submit, [key]: userId }).expect(400);
    expect(service.submit).not.toHaveBeenCalled();
  });
  it.each(['2026-00', '2026-13', '26-11', '2026-11-01', ''])('rejects invalid explicit firstMonth %s', async firstMonth => {
    await request(app.getHttpServer()).post(root).send({ ...submit, firstMonth }).expect(400);
    expect(service.submit).not.toHaveBeenCalled();
  });
  it('requires the first month, a nonblank reference and a numeric revision', async () => {
    for (const change of [{ firstMonth: undefined }, { reference: '  ' }, { expectedVersion: '4' }, { requestId: 'invalid' }]) {
      await request(app.getHttpServer()).post(root).send({ ...submit, ...change }).expect(400);
    }
    expect(service.submit).not.toHaveBeenCalled();
  });
  it('validates scoped list queries and adds no-store headers to salary reads', async () => {
    const response = await request(app.getHttpServer()).get(root).query({ subjectId }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(service.list).toHaveBeenCalledWith(subjectId, { id: userId });
    await request(app.getHttpServer()).get(root).query({ subjectId, all: 'true' }).expect(400);
    await request(app.getHttpServer()).get(root).query({ subjectId: 'invalid' }).expect(400);
  });
  it('scopes detail to the UUID request and the authenticated actor only', async () => {
    await request(app.getHttpServer()).get(`${root}/${id}`).expect(200);
    expect(service.detail).toHaveBeenCalledWith(id, { id: userId });
    await request(app.getHttpServer()).get(`${root}/invalid`).expect(400);
    service.detail.mockRejectedValueOnce(new ForbiddenException('No subject grant'));
    await request(app.getHttpServer()).get(`${root}/${id}`).set('x-test-user', subjectId).expect(403);
  });
  it.each(['decide', 'withdraw', 'revoke'])('validates and dispatches %s with a request revision', async method => {
    const input = { expectedVersion: 1, note: 'Fictional review', ...(method === 'decide' ? { decision: 'approve' } : {}) };
    const response = await request(app.getHttpServer()).post(`${root}/${id}/${method}`).send(input).expect(201);
    expect(response.body).toEqual(detail);
    expect(service[method]).toHaveBeenCalledWith(id, input, { id: userId });
    service[method].mockClear();
    await request(app.getHttpServer()).post(`${root}/${id}/${method}`).send({ ...input, actorId: userId }).expect(400);
    await request(app.getHttpServer()).post(`${root}/${id}/${method}`).send({ ...input, expectedVersion: 0 }).expect(400);
    expect(service[method]).not.toHaveBeenCalled();
  });
  it('does not permit arbitrary decisions or blank withdrawal/revocation explanations', async () => {
    await request(app.getHttpServer()).post(`${root}/${id}/decide`).send({ expectedVersion: 1, decision: 'paid', note: '' }).expect(400);
    for (const method of ['withdraw', 'revoke']) await request(app.getHttpServer()).post(`${root}/${id}/${method}`).send({ expectedVersion: 1, note: ' ' }).expect(400);
  });
});
