import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SysRole } from '@prisma/client';
import request from 'supertest';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';

describe('AI configuration admin boundary', () => {
  let app: INestApplication;
  let role: SysRole;
  const writes: string[] = [];
  const service = {
    getPublicState: () => ({
      activeProvider: null,
      botEnabled: false,
      providers: [],
    }),
    saveProvider: () => {
      writes.push('save');
      return { configured: true };
    },
    testProvider: () => {
      writes.push('test');
      return { success: true };
    },
    activate: () => {
      writes.push('activate');
      return { activeProvider: 'kimi' };
    },
    setBotEnabled: () => {
      writes.push('enabled');
      return { botEnabled: false };
    },
    setAllowlist: () => {
      writes.push('allowlist');
      return { allowlist: [] };
    },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AiConfigController],
      providers: [{ provide: AiConfigService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        id: '00000000-0000-4000-8000-000000000001',
        sysRole: role,
        isManager: true,
        hrCapabilities: ['organization_edit'],
        canViewAll: true,
      };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    role = SysRole.system_admin;
    writes.length = 0;
  });

  it.each(Object.values(SysRole).filter((value) => value !== SysRole.system_admin))(
    'denies %s including manager/capability flags on all routes',
    async (denied) => {
      role = denied;
      await request(app.getHttpServer()).get('/ai-progress/config').expect(403);
      await request(app.getHttpServer())
        .put('/ai-progress/config/providers/kimi')
        .send({ apiKey: 'synthetic-key', modelId: 'sample-model' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/ai-progress/config/providers/kimi/test')
        .expect(403);
      await request(app.getHttpServer())
        .post('/ai-progress/config/providers/kimi/activate')
        .expect(403);
      await request(app.getHttpServer())
        .patch('/ai-progress/config/bot')
        .send({ enabled: true })
        .expect(403);
      await request(app.getHttpServer())
        .put('/ai-progress/config/allowlist')
        .send({ userIds: [] })
        .expect(403);
      expect(writes).toEqual([]);
    },
  );

  it('allows administrator configuration with safe response fields', async () => {
    const state = await request(app.getHttpServer()).get('/ai-progress/config').expect(200);
    expect(JSON.stringify(state.body)).not.toContain('apiKey');
    await request(app.getHttpServer())
      .put('/ai-progress/config/providers/kimi')
      .send({ apiKey: 'synthetic-key', modelId: 'sample-model' })
      .expect(200);
    await request(app.getHttpServer()).post('/ai-progress/config/providers/kimi/test').expect(201);
    await request(app.getHttpServer())
      .post('/ai-progress/config/providers/kimi/activate')
      .expect(201);
    await request(app.getHttpServer())
      .patch('/ai-progress/config/bot')
      .send({ enabled: false })
      .expect(200);
    await request(app.getHttpServer())
      .put('/ai-progress/config/allowlist')
      .send({ userIds: [] })
      .expect(200);
    expect(writes).toEqual(['save', 'test', 'activate', 'enabled', 'allowlist']);
  });

  it('rejects invalid regions, empty/nonstring keys, null fields and non-HRM IDs', async () => {
    for (const body of [
      { apiKey: '', modelId: 'sample-model' },
      { apiKey: null, modelId: 'sample-model' },
      { apiKey: 12345, modelId: 'sample-model' },
      { apiKey: 'synthetic-key', modelId: 12345 },
      { apiKey: 'synthetic-key', modelId: 'sample-model', region: 'invalid' },
      { apiKey: 'synthetic-key', modelId: null },
    ])
      await request(app.getHttpServer())
        .put('/ai-progress/config/providers/qwen')
        .send(body)
        .expect(400);
    await request(app.getHttpServer())
      .put('/ai-progress/config/providers/other')
      .send({ modelId: 'sample-model' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/ai-progress/config/bot')
      .send({ enabled: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .put('/ai-progress/config/allowlist')
      .send({ userIds: ['dingtalk-staff-id'] })
      .expect(400);
    expect(writes).toEqual([]);
  });
});
