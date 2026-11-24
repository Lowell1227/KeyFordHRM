import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { TalentInterviewsController } from './talent-interviews.controller';
import { TalentInterviewsService } from './talent-interviews.service';

describe('recruitment-only participant picker HTTP contract', () => {
  let app: INestApplication;
  const selectedId = '11111111-1111-4111-8111-111111111111';
  const actors = {
    operator: { id: 'operator', sysRole: 'employee', hrCapabilities: ['recruitment_edit'] },
    viewer: { id: 'viewer', sysRole: 'employee', hrCapabilities: ['recruitment_view'] },
    mixed: { id: 'mixed', sysRole: 'hr', hrCapabilities: ['recruitment_edit'], isAssessorOnly: true },
  };
  const db = { user: {
    findUnique: jest.fn(async ({ where }) => ({ ...actors[where.id], status: 'active', archivedAt: null, deletedAt: null })),
    findMany: jest.fn(async (_query: any) => [{ id: selectedId, name: 'Synthetic participant', employeeNo: 'SYN001', status: 'active', archivedAt: null }]),
    count: jest.fn(async (_query: any) => 1),
  } };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [TalentInterviewsController], providers: [
      { provide: TalentInterviewsService, useValue: new TalentInterviewsService(db as never) },
      { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req, _res, next) => { req.user = actors[req.headers['x-test-actor'] as string]; next(); });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('uses a static route, bounded paging and only five safe participant fields', async () => {
    const result = await request(app.getHttpServer()).get('/talent-interviews/participants?keyword=Synthetic&page=2&pageSize=1').set('x-test-actor', 'operator').expect(200);
    expect(result.body).toMatchObject({ total: 1, page: 2, pageSize: 1 });
    expect(Object.keys(result.body.items[0]).sort()).toEqual(['id', 'name', 'employeeNo', 'status', 'archivedAt'].sort());
    const query = db.user.findMany.mock.calls.at(-1)![0];
    expect(query).toMatchObject({ skip: 1, take: 1, where: {
      accountType: 'employee', isAssessorOnly: false, archivedAt: null, deletedAt: null, status: { in: ['active', 'probation'] },
      OR: [{ name: { contains: 'Synthetic', mode: 'insensitive' } }, { employeeNo: { contains: 'Synthetic', mode: 'insensitive' } }],
    } });
    expect(query.select).toEqual({ id: true, name: true, employeeNo: true, status: true, archivedAt: true });
    expect(db.user.count.mock.calls.at(-1)![0].where).toEqual(query.where);
  });
  it('verifies a selected UUID through the same eligible employee-only scope', async () => {
    await request(app.getHttpServer()).get(`/talent-interviews/participants?id=${selectedId}`).set('x-test-actor', 'operator').expect(200);
    expect(db.user.findMany.mock.calls.at(-1)![0].where).toMatchObject({ id: selectedId, accountType: 'employee', isAssessorOnly: false, archivedAt: null, deletedAt: null });
    for (const query of ['id=invalid', 'pageSize=1000', 'includeTestAccounts=true']) {
      await request(app.getHttpServer()).get('/talent-interviews/participants?' + query).set('x-test-actor', 'operator').expect(400);
    }
  });
  it.each(['viewer', 'mixed'])('does not expose a personnel directory to %s', async actor => {
    await request(app.getHttpServer()).get('/talent-interviews/participants').set('x-test-actor', actor).expect(403);
  });
  it('rechecks current operator eligibility rather than trusting old request capabilities', async () => {
    const service = new TalentInterviewsService({ user: { findUnique: async () => ({ ...actors.operator, status: 'resigned' }) } } as never);
    await expect(service.participantOptions({ page: 1, pageSize: 20 } as never, actors.operator as never)).rejects.toThrow(ForbiddenException);
  });
});
