import { INestApplication, StreamableFile, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '@/auth/auth.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { TalentsController } from './talents.controller';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';

describe('talent export HTTP authorization and query contract', () => {
  let app: INestApplication;
  const talents = { exportApplications: jest.fn(async () => new StreamableFile(Buffer.from('synthetic-xlsx'), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="talents.xlsx"',
  })), applicationPositions: jest.fn(async () => ['历史财务', '运营']), detail: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [TalentsController], providers: [
      { provide: TalentsService, useValue: talents }, { provide: TalentFilesService, useValue: {} },
      { provide: TalentFollowUpsService, useValue: {} }, { provide: TalentSharesService, useValue: {} },
      { provide: JwtService, useValue: { verifyAsync: async value => ({ sub: value }) } },
      { provide: AuthService, useValue: { validateSession: async ({ sub }) => ({ id: sub, name: 'Synthetic',
        sysRole: ['hr', 'system_admin', 'employee'].includes(sub) ? sub : 'hr_user',
        hrCapabilities: sub === 'reviewer' ? ['employee_archive_review'] : sub === 'editor' ? ['employee_archive_edit'] : [],
      }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('keeps exports and historical position options behind the same existing talent-read roles', async () => {
    for (const path of ['/talents/export', '/talents/application-positions']) {
      await request(app.getHttpServer()).get(path).expect(401);
      for (const token of ['employee', 'unqualified']) await request(app.getHttpServer()).get(path).auth(token, { type: 'bearer' }).expect(403);
      for (const token of ['hr', 'system_admin', 'reviewer', 'editor']) await request(app.getHttpServer()).get(path).auth(token, { type: 'bearer' }).expect(200);
    }
    expect(talents.detail).not.toHaveBeenCalled();
  });

  it('streams an unwrapped workbook and validates same-application query fields', async () => {
    const response = await request(app.getHttpServer()).get('/talents/export?applicationPosition=财务&applicationStage=rejected&salaryMinYuan=5501')
      .auth('reviewer', { type: 'bearer' }).expect(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(talents.exportApplications).toHaveBeenLastCalledWith(expect.objectContaining({ applicationPosition: '财务', applicationStage: 'rejected', salaryMinYuan: 5501 }), expect.objectContaining({ id: 'reviewer' }));
    await request(app.getHttpServer()).get('/talents/export?applicationStage=not-a-stage').auth('hr', { type: 'bearer' }).expect(400);
  });
});
