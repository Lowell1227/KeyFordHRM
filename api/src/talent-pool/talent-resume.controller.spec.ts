import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { TalentResumeController } from './talent-resume.controller';
import { TalentResumeService } from './talent-resume.service';
import { RESUME_LIMITS } from './talent-resume-client';

describe('TalentResumeController', () => {
  const guard = new RolesGuard(new Reflector());
  it.each(['getStatus', 'parse'])('protects %s with archive maintenance permission', (method) => {
    const ctx = (user: any) => ({ getHandler: () => TalentResumeController.prototype[method], getClass: () => TalentResumeController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;
    for (const user of [undefined, { sysRole: 'employee', canViewAll: true }, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] }]) {
      expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
    }
    for (const user of [{ sysRole: 'hr' }, { sysRole: 'system_admin' }, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }]) {
      expect(guard.canActivate(ctx(user))).toBe(true);
    }
  });

  it('uses bounded in-memory multipart and repaired filename on the real HTTP route', async () => {
    const service = { getStatus: jest.fn().mockResolvedValue({ configured: false, enabled: false, provider: 'deepseek', modelId: 'deepseek-flash' }),
      parse: jest.fn().mockImplementation(async file => ({ fields: {}, reviewItems: [], source: { fileName: file.originalname } })),
    };
    const module = await Test.createTestingModule({ controllers: [TalentResumeController], providers: [{ provide: TalentResumeService, useValue: service }] }).compile();
    const app = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => { req.user = { id: 'hr', sysRole: 'hr' }; next(); });
    await app.init();
    try {
      const status = await request(app.getHttpServer()).get('/talent-resume/status').expect(200);
      expect(status.headers['cache-control']).toBe('no-store');
      const response = await request(app.getHttpServer()).post('/talent-resume/parse').attach('file', Buffer.from('synthetic'), '虚构简历.pdf').expect(200);
      expect(response.body.source.fileName).toBe('虚构简历.pdf');
      expect(service.parse.mock.calls[0][0].buffer).toBeInstanceOf(Buffer);
      expect(service.parse.mock.calls[0][0].path).toBeUndefined();
      expect(service.parse.mock.calls[0][1]).toEqual({ id: 'hr', sysRole: 'hr' });
      await request(app.getHttpServer()).post('/talent-resume/parse').attach('file', Buffer.alloc(RESUME_LIMITS.fileBytes + 1), 'large.pdf').expect(413);
      await request(app.getHttpServer()).post('/talent-resume/parse').field('unexpected', 'field').attach('file', Buffer.from('synthetic'), 'resume.pdf').expect(400);
      await request(app.getHttpServer()).post('/talent-resume/parse').attach('other', Buffer.from('synthetic'), 'resume.pdf').expect(400);
      await request(app.getHttpServer()).post('/talent-resume/parse').attach('file', Buffer.from('one'), 'one.pdf').attach('file', Buffer.from('two'), 'two.pdf').expect(400);
      expect(service.parse).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
