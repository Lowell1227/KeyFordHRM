import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SysRole } from '@prisma/client';
import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { RolesGuard } from '@/common/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('roster column selection over HTTP', () => {
  let app: INestApplication;
  let actor: Record<string, unknown>;
  const count = jest.fn().mockResolvedValue(0);
  const findMany = jest.fn().mockResolvedValue([]);
  const audit = jest.fn().mockResolvedValue({});
  const service = new UsersService({ user: { count, findMany }, auditLog: { create: audit } } as any,
    { getVisibleEmployeeFilter: async () => ({}) } as any, {} as any);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    actor = { id: 'synthetic-reviewer', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_review'] };
  });

  it.each(['', 'idNumber', 'name,passwordHash', 'name,name'])('rejects invalid selection %s without reading personnel', async columns => {
    await request(app.getHttpServer()).get('/users/export').query({ columns }).expect(400);
    expect(count).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('preserves only requested column order in a parseable workbook and keeps review-only access', async () => {
    const response = await request(app.getHttpServer()).get('/users/export')
      .query({ columns: 'companyTenure,name', unassigned: 'true', employmentType: 'part_time' })
      .buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect((workbook.getWorksheet('花名册')!.getRow(2).values as unknown[]).slice(1)).toEqual(['本次司龄', '姓名']);
    expect(audit.mock.calls[0][0].data.newValue).toMatchObject({ columns: ['companyTenure', 'name'], total: 0 });
  });

  it('does not grant export access to an employee or HR without personnel capabilities', async () => {
    for (const sysRole of [SysRole.employee, SysRole.hr_user]) {
      actor = { id: 'synthetic-denied', sysRole, hrCapabilities: [] };
      await request(app.getHttpServer()).get('/users/export').query({ columns: 'name' }).expect(403);
    }
    expect(count).not.toHaveBeenCalled();
  });

  it('offers archive modules only to archive-capable HR and rejects forged archive columns', async () => {
    const full = await request(app.getHttpServer()).get('/users/export-fields').expect(200);
    expect(full.body.map((group: any) => group.label)).toEqual([
      '基本与任职', '个人与教育', '身份与联系', '社保公积金', '银行信息', '当前合同', '合同历史', '系统信息',
    ]);
    expect(full.body.flatMap((group: any) => group.fields).some((field: any) => field.key === 'phone')).toBe(true);
    actor = { id: 'synthetic-org-only', sysRole: SysRole.hr_user, hrCapabilities: ['organization_edit'] };
    const limited = await request(app.getHttpServer()).get('/users/export-fields').expect(200);
    expect(limited.body.flatMap((group: any) => group.fields)).toHaveLength(10);
    await request(app.getHttpServer()).get('/users/export').query({ columns: 'name,phone' }).expect(403);
    expect(count).not.toHaveBeenCalled();
  });
});
