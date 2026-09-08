import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { CalibrationController, CalibrationCyclesController } from './calibration.controller';
import { CalibrationService } from './calibration.service';

/** Real transport/guards with isolated identities and an in-memory repository. */
describe('calibration HTTP authorization', () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: randomUUID() });
  const cycleId = randomUUID(), ownerId = randomUUID(), taskId = randomUUID();
  const cycle = { id: cycleId, hrOwnerId: ownerId, name: 'Virtual scope',
    ...Object.fromEntries(['A', 'B', 'C', 'D'].map(grade => [`grade${grade}MaxRatio`, new Prisma.Decimal(0.25)])) };
  const prisma: any = {
    assessmentCycle: { findUnique: jest.fn(async () => cycle), findMany: jest.fn(async () => [cycle]) },
    assessmentTask: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => ({ id: taskId, employeeId: ownerId })) },
    $transaction: jest.fn(),
  };
  const endpoints = [
    ['get', `/calibration/cycles`], ['get', `/cycles/${cycleId}/calibration`],
    ['get', `/cycles/${cycleId}/grade-distribution`], ['get', `/cycles/${cycleId}/calibration/tasks/${taskId}`],
    ['post', `/cycles/${cycleId}/calibration/confirm`], ['post', `/cycles/${cycleId}/calibration/reject`],
  ] as const;
  const token = (id: string) => jwt.sign({ sub: id, name: 'Virtual user', sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CalibrationController, CalibrationCyclesController],
      providers: [{ provide: CalibrationService, useValue: new CalibrationService(prisma, {} as any, {} as any) }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new JwtAuthGuard(new Reflector(), jwt), new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app.close());

  it('requires authentication on every endpoint', async () => {
    for (const [method, path] of endpoints) {
      await request(app.getHttpServer())[method](path).send({ taskIds: [taskId], reason: 'Virtual reason' }).expect(401);
    }
  });

  it('passes authenticated cycle owners through the existing global guards without HR permission grants', async () => {
    await request(app.getHttpServer()).get('/calibration/cycles').set('Authorization', `Bearer ${token(ownerId)}`).expect(200);
    expect(prisma.assessmentCycle.findMany.mock.calls[0][0].where.hrOwnerId).toBe(ownerId);
    await request(app.getHttpServer()).get(`/cycles/${cycleId}/calibration`).set('Authorization', `Bearer ${token(ownerId)}`).expect(200);
  });

  it('rejects unrelated users at each cycle endpoint, including distribution and both mutations', async () => {
    for (const [method, path] of endpoints.slice(1)) {
      await request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token(randomUUID())}`)
        .send({ taskIds: [taskId], reason: 'Virtual reason' }).expect(403);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an owner own detail at the HTTP boundary', async () => {
    await request(app.getHttpServer()).get(`/cycles/${cycleId}/calibration/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token(ownerId)}`).expect(403);
  });
});
