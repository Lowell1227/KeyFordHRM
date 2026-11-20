import { Controller, Get, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '@/auth/auth.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { TalentSharesController } from './talent-shares.controller';
import { TalentSharesService } from './talent-shares.service';
import { TalentsService } from './talents.service';

@Controller('unrelated-private')
class PrivateController { @Get() view() { return { private: true }; } }

describe('public share HTTP boundary with real global guards and service', () => {
  let app: INestApplication;
  let found: any;
  const token = 'a'.repeat(64);
  const actor = { id: 'recipient', name: 'Synthetic reviewer', sysRole: 'employee' };
  const auth = { validateSession: jest.fn(async payload => {
    if (payload.sub === 'inactive') throw new UnauthorizedException();
    return { ...actor, id: payload.sub };
  }) };
  const jwt = { verifyAsync: jest.fn(async value => {
    if (value === 'invalid') throw new Error('invalid');
    return { sub: value };
  }) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TalentSharesController, PrivateController],
      providers: [TalentSharesService,
        { provide: AuthService, useValue: auth }, { provide: JwtService, useValue: jwt },
        { provide: PrismaService, useValue: {
          talentShare: { findUnique: async () => found, update: async () => ({}) },
          employmentRecord: { findMany: async () => [] }, user: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) },
        } },
        { provide: TalentsService, useValue: {} },
        { provide: StorageService, useValue: { pipeDownload: async (_key, res) => res.send('synthetic resume') } },
        { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    found = { id: 'share', token, isPublicLink: true, recipientIds: [], includeResume: true, revokedAt: null,
      expiresAt: new Date(Date.now() + 10000), createdAt: new Date(), message: null,
      candidate: { name: 'Synthetic candidate', deletedAt: null, tags: [], files: [{ id: 'file', objectKey: 'private/object', fileName: 'test.pdf' }] } };
  });

  it('allows guest summary and scoped download, with no unrelated route auth change', async () => {
    const response = await request(app.getHttpServer()).get(`/talents/shares/${token}`).expect(200);
    expect(response.body.candidate.name).toBe('Synthetic candidate');
    expect(JSON.stringify(response.body)).not.toContain('private/object');
    await request(app.getHttpServer()).get(`/talents/shares/${token}/file/file`).expect(200, 'synthetic resume');
    await request(app.getHttpServer()).get('/unrelated-private').expect(401);
  });

  it('keeps legacy shares behind validated current sessions and recipients', async () => {
    found.isPublicLink = false; found.recipientIds = ['recipient'];
    for (const value of ['', 'invalid', 'inactive', 'outsider']) {
      const get = (path: string) => { const pending = request(app.getHttpServer()).get(path); return value ? pending.auth(value, { type: 'bearer' }) : pending; };
      await get(`/talents/shares/${token}`).expect(403);
      await get(`/talents/shares/${token}/file/file`).expect(403);
    }
    await request(app.getHttpServer()).get(`/talents/shares/${token}`).auth('recipient', { type: 'bearer' }).expect(200);
    await request(app.getHttpServer()).get(`/talents/shares/${token}/file/file`).auth('recipient', { type: 'bearer' }).expect(200);
    expect(auth.validateSession).toHaveBeenCalled();
  });

  it('does not let an expired saved login block a valid external link', async () => {
    await request(app.getHttpServer()).get(`/talents/shares/${token}`).auth('invalid', { type: 'bearer' }).expect(200);
  });

  it('prevents caches from retaining a summary or downloaded original after revocation', async () => {
    for (const path of [`/talents/shares/${token}`, `/talents/shares/${token}/file/file`]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('returns the same 403 message for malformed tokens and invalid scoped files', async () => {
    for (const path of ['/talents/shares/invalid', '/talents/shares/invalid/file/file', `/talents/shares/${token}/file/foreign`]) {
      const response = await request(app.getHttpServer()).get(path).expect(403);
      expect(response.body.message).toBe('链接已失效或无权查看');
    }
  });
});
