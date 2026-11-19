import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { TalentResumeTasksController } from './talent-resume-tasks.controller';
import { TalentResumeTasksService } from './talent-resume-tasks.service';

describe('Resume task HTTP boundary', () => {
  it.each(['start', 'current', 'get', 'retry', 'file', 'clear'])('requires maintenance capability on %s', method => {
    const guard = new RolesGuard(new Reflector());
    const context = (user: any) => ({ getHandler: () => TalentResumeTasksController.prototype[method],
      getClass: () => TalentResumeTasksController, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
    for (const user of [undefined, { sysRole: 'employee' }, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] }]) {
      expect(() => guard.canActivate(context(user))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(context({ sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] }))).toBe(true);
  });

  it('accepts the upload quickly and keeps download bytes outside the JSON envelope', async () => {
    const user = { id: 'fictional-hr', sysRole: 'hr' }, result = { id: 'synthetic-task', status: 'processing' };
    const tasks = { start: jest.fn().mockResolvedValue(result), current: jest.fn(async () => result), get: jest.fn(async () => result),
      retry: jest.fn(async () => result), clear: jest.fn(async () => undefined),
      file: jest.fn(async () => ({ buffer: Buffer.from('fictional-bytes'), fileName: 'unsafe\r\nname' })) };
    const module = await Test.createTestingModule({ controllers: [TalentResumeTasksController],
      providers: [{ provide: TalentResumeTasksService, useValue: tasks }] }).compile();
    const app = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => { req.user = user; next(); });
    await app.init();
    try {
      const start = await request(app.getHttpServer()).post('/talent-resume/tasks').set('X-Resume-Context', 'new')
        .attach('file', Buffer.from('fictional-bytes'), 'fictional.pdf').expect(202);
      expect(start.headers['cache-control']).toBe('no-store');
      expect(tasks.start.mock.calls[0][1]).toBe('new');
      await request(app.getHttpServer()).get('/talent-resume/tasks/current?context=new').expect(200);
      expect(tasks.current).toHaveBeenCalledWith('new', user);
      const download = await request(app.getHttpServer()).get('/talent-resume/tasks/id/file').expect(200);
      expect(download.headers['content-disposition']).toBe('attachment');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.body).toEqual(Buffer.from('fictional-bytes'));
      await request(app.getHttpServer()).post('/talent-resume/tasks/id/retry').expect(202);
      await request(app.getHttpServer()).delete('/talent-resume/tasks/id').expect(204);
      await request(app.getHttpServer()).post('/talent-resume/tasks').field('context', 'new')
        .attach('file', Buffer.from('synthetic'), 'resume.pdf').expect(400);
    } finally { await app.close(); }
  });
});
