import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as officeCrypto from 'officecrypto-tool';
import { RolesGuard } from '@/common/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RosterSensitiveExportService } from './roster-sensitive-export.service';

describe('sensitive export HTTP boundary', () => {
  let app: INestApplication, actor: any, storedActor: any;
  const count = jest.fn().mockResolvedValue(0), findMany = jest.fn().mockResolvedValue([]), audit = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockImplementation(async () => storedActor);
  const input = { columns: 'name,idNumber', accountPassword: 'fixture-account', filePassword: '4567' };
  const prisma = { user: { count, findMany, findUnique }, auditLog: { create: audit } } as any;
  beforeAll(async () => {
    const security = new RosterSensitiveExportService(prisma, new ConfigService());
    const service = new UsersService(prisma, { getVisibleEmployeeFilter: async () => ({}) } as any, {} as any, security);
    const module = await Test.createTestingModule({ controllers: [UsersController], providers: [{ provide: UsersService, useValue: service }] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app?.close());
  beforeEach(async () => {
    jest.clearAllMocks();
    actor = { id: 'fixture-reviewer', sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] };
    storedActor = { status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(input.accountPassword, 4) };
  });
  it('GET cannot export identity even with password query parameters', async () => {
    await request(app.getHttpServer()).get('/users/export').query(input).expect(400);
    expect(findUnique).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled();
  });
  it.each([{ accountPassword: undefined }, { filePassword: '' }, { filePassword: '123' }, { accountPassword: 'wrong' }])('rejects incomplete or wrong credentials before reading personnel %p', async changes => {
    await request(app.getHttpServer()).post('/users/export-sensitive').send({ ...input, ...changes }).expect(changes.accountPassword === 'wrong' ? 403 : 400);
    expect(count).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
  it('denies organization-only HR and employees', async () => {
    for (const role of ['hr_user', 'employee']) {
      actor = { ...actor, sysRole: role, hrCapabilities: ['organization_edit'] };
      await request(app.getHttpServer()).post('/users/export-sensitive').send(input).expect(403);
    }
    expect(findUnique).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled();
  });
  it('checks the signed-in identity, returns encrypted no-store XLSX and excludes secrets from audit', async () => {
    const response = await request(app.getHttpServer()).post('/users/export-sensitive').send({ ...input, userId: 'someone-else' })
      .buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); }).expect(201);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(findUnique.mock.calls[0][0].where.id).toBe(actor.id);
    expect(findMany.mock.calls[0][0].include.employeeProfile.select.idNumberEncrypted).toBe(true);
    expect(officeCrypto.isEncrypted(response.body)).toBe(true);
    await expect(officeCrypto.decrypt(response.body, { password: 'wrong-file' })).rejects.toThrow();
    const decrypted = await officeCrypto.decrypt(response.body, { password: input.filePassword });
    expect(decrypted.subarray(0, 2).toString()).toBe('PK');
    expect(audit.mock.calls[0][0].data.newValue).toMatchObject({ columns: ['name', 'idNumber'], encrypted: true, identityIncluded: true });
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(input.accountPassword); expect(logged).not.toContain(input.filePassword);
  });
  it('ordinary export does not read encrypted identity data', async () => {
    await request(app.getHttpServer()).get('/users/export').query({ columns: 'name' }).expect(200);
    expect(findMany.mock.calls[0][0].include.employeeProfile.select.idNumberEncrypted).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
