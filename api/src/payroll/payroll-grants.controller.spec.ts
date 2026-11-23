import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { PayrollGrantsService } from './payroll-grants.service';

const subjectId = '33333333-3333-4333-8333-333333333333';
const userId = '22222222-2222-4222-8222-222222222222';
const grantId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2037-01-01T00:00:00.000Z';
const save = { subjectId, userId, capabilities: ['payroll_view'], expectedUpdatedAt: null, reason: 'Fictional approved access' };

describe('payroll grant administration HTTP contract', () => {
  let app: INestApplication;
  const service = { list: jest.fn(), options: jest.fn(), save: jest.fn(), revoke: jest.fn(), events: jest.fn() };
  let actor: any;
  beforeAll(async () => {
    expect(existsSync(join(__dirname, 'payroll-grants.controller.ts'))).toBe(true);
    const { PayrollGrantsController } = require('./payroll-grants.controller');
    const module = await Test.createTestingModule({ controllers: [PayrollGrantsController], providers: [{ provide: PayrollGrantsService, useValue: service }] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalInterceptors(new ResponseInterceptor());
    // Match the global pipe: unknown payloads must still reach the stricter endpoint validation intact.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    actor = { id: userId, sysRole: 'system_admin', isAssessorOnly: false };
    service.list.mockResolvedValue([]);
    service.options.mockResolvedValue({ subjects: [{ id: subjectId, name: 'Fictional directory' }], users: [{ id: userId, name: 'Fictional person', employeeNo: 'F001' }], capabilities: ['payroll_view'] });
    service.save.mockResolvedValue({ id: grantId, updatedAt: timestamp });
    service.revoke.mockResolvedValue({ id: grantId, updatedAt: timestamp, revokedAt: timestamp });
    service.events.mockResolvedValue([{ id: 'event', action: 'grant_saved', actor: { id: userId, name: 'Fictional admin' }, oldCapabilities: [], newCapabilities: ['payroll_view'], reason: 'Fictional', createdAt: timestamp }]);
  });
  afterAll(async () => { await app?.close(); });
  const root = '/api/v1/payroll/grants';

  it('lists an unpaginated array with optional subject/state filtering and no-store headers', async () => {
    const response = await request(app.getHttpServer()).get(root).query({ subjectId, status: 'revoked' }).expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(service.list).toHaveBeenCalledWith({ subjectId, status: 'revoked' }, actor);
  });
  it('provides options, not the dynamic id endpoint, and defaults list status to all', async () => {
    const response = await request(app.getHttpServer()).get(`${root}/options`).expect(200);
    expect(response.body.data).toEqual(await service.options.mock.results[0].value);
    expect(service.events).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(root).expect(200);
    expect(service.list).toHaveBeenCalledWith({ status: 'all' }, actor);
  });
  it('keeps the explicit null new-record marker and delegates only the supplied validated save', async () => {
    const response = await request(app.getHttpServer()).post(root).send(save).expect(201);
    expect(response.body.data).toEqual({ id: grantId, updatedAt: timestamp });
    expect(service.save).toHaveBeenCalledWith(save, actor);
  });
  it('updates a record with its exact version token and delegates revoke and readable history by id', async () => {
    await request(app.getHttpServer()).post(root).send({ ...save, expectedUpdatedAt: timestamp }).expect(201);
    const body = { expectedUpdatedAt: timestamp, reason: 'Fictional revoke' };
    await request(app.getHttpServer()).post(`${root}/${grantId}/revoke`).send(body).expect(201);
    expect(service.revoke).toHaveBeenCalledWith(grantId, body, actor);
    const history = await request(app.getHttpServer()).get(`${root}/${grantId}/events`).expect(200);
    expect(history.headers['cache-control']).toBe('no-store, private');
    expect(history.body.data[0]).toMatchObject({ actor: { name: 'Fictional admin' }, oldCapabilities: [], newCapabilities: ['payroll_view'], reason: 'Fictional' });
    expect(service.events).toHaveBeenCalledWith(grantId, actor);
  });
  it.each(['employee', 'hr_user', 'hr'])('does not let %s manage or read grants via a broad actor role', async sysRole => {
    actor.sysRole = sysRole;
    await request(app.getHttpServer()).get(root).expect(403);
    await request(app.getHttpServer()).get(`${root}/options`).expect(403);
    await request(app.getHttpServer()).get(`${root}/${grantId}/events`).expect(403);
    await request(app.getHttpServer()).post(root).send(save).expect(403);
    await request(app.getHttpServer()).post(`${root}/${grantId}/revoke`).send({ expectedUpdatedAt: timestamp, reason: 'Fictional' }).expect(403);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
  it.each([
    { salary: '10000' }, { actorId: userId }, { grantedById: userId }, { expectedUpdatedAt: undefined }, { expectedUpdatedAt: 'invalid' },
    { capabilities: [] }, { capabilities: ['payroll_parameter_review'] }, { capabilities: ['payroll_view', 'payroll_view'] }, { reason: '  ' },
  ])('rejects unknown or invalid save fields without silently stripping them: %p', async changes => {
    await request(app.getHttpServer()).post(root).send({ ...save, ...changes }).expect(400);
    expect(service.save).not.toHaveBeenCalled();
  });
  it('rejects invalid query/path/revoke versions and extra body fields', async () => {
    await request(app.getHttpServer()).get(root).query({ subjectId: 'bad' }).expect(400);
    await request(app.getHttpServer()).get(root).query({ status: 'unknown' }).expect(400);
    await request(app.getHttpServer()).get(root).query({ salary: 'forbidden' }).expect(400);
    await request(app.getHttpServer()).post(`${root}/bad/revoke`).send({ expectedUpdatedAt: timestamp, reason: 'Fictional' }).expect(400);
    await request(app.getHttpServer()).get(`${root}/bad/events`).expect(400);
    await request(app.getHttpServer()).post(`${root}/${grantId}/revoke`).send({ expectedUpdatedAt: null, reason: 'Fictional' }).expect(400);
    await request(app.getHttpServer()).post(`${root}/${grantId}/revoke`).send({ expectedUpdatedAt: timestamp, reason: 'Fictional', capabilities: [] }).expect(400);
    expect(service.revoke).not.toHaveBeenCalled();
  });
  it('does not accept fact selectors or arbitrary query fields on fixed options/history endpoints', async () => {
    await request(app.getHttpServer()).get(`${root}/options`).query({ subjectId }).expect(400);
    await request(app.getHttpServer()).get(`${root}/${grantId}/events`).query({ targetUserId: userId }).expect(400);
    expect(service.options).not.toHaveBeenCalled(); expect(service.events).not.toHaveBeenCalled();
  });
  it('anonymous requests cannot reach management service methods', async () => {
    actor = undefined;
    await request(app.getHttpServer()).get(root).expect(403);
    expect(service.list).not.toHaveBeenCalled();
  });
});
