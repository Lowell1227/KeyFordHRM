import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SysRole } from '@prisma/client';
import request from 'supertest';
import { RolesGuard } from '@/common/guards/roles.guard';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';

describe('employee roster import HTTP closure', () => {
  let app: INestApplication;
  let role: SysRole;
  const importOperations: string[] = [];
  const batchId = '11111111-1111-4111-8111-111111111111';
  const endpoints = [
    ['get', '/employee-archives/imports/template'],
    ['post', '/employee-archives/imports/preview'],
    ['get', `/employee-archives/imports/${batchId}`],
    ['post', `/employee-archives/imports/${batchId}/confirm`],
  ] as const;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeeArchivesController],
      providers: [
        { provide: EmployeeArchivesService, useValue: { createEmployee: () => ({ id: 'new-employee' }) } },
        { provide: EmployeeRosterImportService, useValue: {
          preview: () => { importOperations.push('preview'); return { id: batchId }; },
          confirm: () => { importOperations.push('confirm'); return { id: batchId }; },
          findBatch: () => { importOperations.push('batch'); return { id: batchId }; },
        } },
        { provide: EmployeeDataReviewsService, useValue: { findAll: () => ({ items: [], total: 0 }) } },
        { provide: PersonnelDiagnosticsService, useValue: {} },
        { provide: EmployeeIdentityMatchService, useValue: {} },
        { provide: EmployeeOnboardingService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Synthetic operator', sysRole: role,
        deptId: null, isAssessorOnly: false, canViewAll: true,
        hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
      };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    await app.init();
  });

  afterAll(() => app?.close());
  beforeEach(() => { role = SysRole.system_admin; importOperations.length = 0; });

  it.each(Object.values(SysRole))('denies every import route to %s without role exceptions', async deniedRole => {
    role = deniedRole;
    for (const [method, path] of endpoints) {
      const response = await request(app.getHttpServer())[method](path).expect(403);
      expect(response.body.code).toBe(4003);
      if (new Set<SysRole>([SysRole.system_admin, SysRole.hr, SysRole.hr_user]).has(deniedRole)) {
        expect(response.body.message).toBe('花名册导入暂未开放');
      }
    }
    expect(importOperations).toEqual([]);
  });

  it.each([
    '/employee-archives/imports/preview',
    `/employee-archives/imports/${batchId}/confirm`,
  ])('rejects %s before its multipart upload parser runs', async path => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Content-Type', 'multipart/form-data; boundary=synthetic-boundary')
      .send('incomplete multipart upload')
      .expect(403);
    expect(response.body.message).toBe('花名册导入暂未开放');
    expect(importOperations).toEqual([]);
  });

  it('keeps individual employee creation and existing review records available', async () => {
    await request(app.getHttpServer()).post('/employee-archives').send({ name: 'Synthetic employee' })
      .expect(201).expect({ id: 'new-employee' });
    await request(app.getHttpServer()).get('/employee-archives/reviews/list')
      .expect(200).expect({ items: [], total: 0 });
  });
});
