import { BadRequestException, ConflictException, ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { RolesGuard } from '@/common/guards/roles.guard';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { AccountType, CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';

const editor = { id: 'synthetic-editor', name: 'Synthetic HR', sysRole: SysRole.hr_user,
  hrCapabilities: ['employee_archive_edit'], deptId: null, canViewAll: false, isAssessorOnly: false };

function setup(config?: any) {
  const employment: any = { id: 'employment', company: CompanyCode.fuede, companyText: null, contractSubjectId: null,
    deptId: 'department', positionId: null, position: 'Analyst', jobGrade: 'P1', jobFamily: 'Operations',
    directManagerId: null, workLocation: 'Office', probationMonths: null, effectiveFrom: new Date('2025-01-01'), effectiveTo: null };
  const user: any = { id: 'employee', employeeNo: '101', name: 'Synthetic employee', phone: null,
    deptId: 'department', positionId: null, position: 'Analyst', entryDate: new Date('2025-01-01'),
    plannedRegularDate: null, actualRegularDate: null, leaveDate: null, employmentType: EmploymentType.full_time,
    status: UserStatus.active, accountType: AccountType.employee, directManagerId: null, archivedAt: null,
    deletedAt: null, updatedAt: new Date('2026-01-01'), employeeProfile: null,
    employmentHistory: [employment], employeeContracts: [], dept: { parentId: 'parent', leaderId: null } };
  const requests: any[] = [];
  const audits: any[] = [];
  const referenceOptions = [
    ...['Changed', 'First', 'Second', 'Draft', 'Must roll back', 'Master', 'Do not apply', 'X'.repeat(50), 'x'.repeat(50)]
      .map(name => ({ kind: 'education', name, isActive: true })),
    ...['P2', 'P3'].map(name => ({ kind: 'job_grade', name, isActive: true })),
  ];
  const tx: any = {
    personnelReferenceData: { findMany: jest.fn(async ({ where }) => referenceOptions.filter(option =>
      option.isActive === where.isActive && where.OR.some((query: any) => query.kind === option.kind && query.name === option.name))) },
    user: {
      findUnique: jest.fn(async ({ where }) => where.id === user.id ? user
        : { id: where.id, status: 'active', accountType: 'employee', directManagerId: null, deletedAt: null }),
      update: jest.fn(async ({ where, data }) => { if (where.id === user.id) Object.assign(user, data); return user; }),
      findMany: jest.fn(async () => []),
    },
    employeeProfile: { upsert: jest.fn(async ({ create, update }) => {
      user.employeeProfile = user.employeeProfile ? { ...user.employeeProfile, ...update } : { ...create }; return user.employeeProfile;
    }) },
    employeeDataChangeRequest: {
      findFirst: jest.fn(async ({ where }) => requests.find(r => where.id ? r.id === where.id
        : (!r.archivedAt && !r.appliedAt && (!where.sourceType || r.sourceType === where.sourceType)
          && (!where.intakeType || r.intakeType))) ?? null),
      findUnique: jest.fn(async ({ where }) => requests.find(r => r.id === where.id) ?? null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }) => { const r = { id: 'request-' + requests.length, requestVersion: 1,
        updatedAt: new Date(), archivedAt: null, intakeType: null, appliedAt: null, ...data }; requests.push(r); return { ...r }; }),
      update: jest.fn(async ({ where, data }) => { const r = requests.find(x => x.id === where.id);
        if (!r || (where.requestVersion !== undefined && where.requestVersion !== r.requestVersion)) throw { code: 'P2025' };
        const version = data.requestVersion?.increment ? r.requestVersion + data.requestVersion.increment : r.requestVersion;
        Object.assign(r, data, { requestVersion: version }); return { ...r }; }),
      updateMany: jest.fn(async ({ where, data }) => { const r = requests.find(x => x.id === where.id);
        if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; }),
    },
    employmentRecord: {
      findFirst: jest.fn(async () => user.employmentHistory[0] ?? null),
      update: jest.fn(async ({ where, data }) => { const r = user.employmentHistory.find((x: any) => x.id === where.id); Object.assign(r, data); return r; }),
      create: jest.fn(async ({ data }) => { const r = { id: 'new-employment', ...data }; user.employmentHistory.unshift(r); return r; }),
    },
    employeeContract: {
      findMany: jest.fn(async () => user.employeeContracts.filter((x: any) => x.isActive)),
      create: jest.fn(async ({ data }) => { const c = { id: 'new-contract', ...data }; user.employeeContracts.push(c); return c; }),
      update: jest.fn(async ({ where, data }) => { const c = user.employeeContracts.find((x: any) => x.id === where.id); Object.assign(c, data); return c; }),
    },
    auditLog: { create: jest.fn(async ({ data }) => { audits.push(data); return data; }) },
  };
  const db: any = { ...tx, $transaction: jest.fn(async run => {
    const snapshot = structuredClone({ user, requests, audits });
    try { return await run(tx); } catch (e) {
      Object.assign(user, snapshot.user); requests.splice(0, requests.length, ...snapshot.requests); audits.splice(0, audits.length, ...snapshot.audits); throw e;
    }
  }) };
  const service = new EmployeeArchivesService(db, config);
  const input = (employee = {}, profile = {}, performance?: any, contracts?: any[]) => ({
    baseVersion: (service as any).archiveVersion(user), employee, profile, ...(performance ? { performance } : {}), ...(contracts ? { contracts } : {}),
  });
  return { service, db, tx, user, requests, audits, input };
}

describe('N08 formal archive version protection', () => {
  function versionFixture() {
    const secret = randomUUID();
    const f = setup({ get: () => secret });
    f.user.employeeProfile = { id: 'existing-profile', userId: f.user.id, education: 'Original',
      phone: null, gender: null, bankName: null, updatedAt: new Date('2026-01-01') };
    return f;
  }

  it.each([
    ['existing profile only', {}, { education: 'Changed' }],
    ['reviewed profile only', {}, { bankName: 'Synthetic bank' }],
    ['sensitive bank account', {}, { bankAccount: '6222000000000000' }],
    ['sensitive identity', {}, { idNumber: '330100199001011234' }],
    ['employee phone only', { phone: '13800000000' }, {}],
    ['mixed profile and employee', { name: 'Changed' }, { education: 'Changed' }],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)(
    'advances the formal metadata version for %s and rejects an old base before any second write', async (_name, employee, profile) => {
      const f = versionFixture();
      const payload = f.input(employee, profile);
      const oldUpdatedAt = f.user.updatedAt.getTime();
      await f.service.submitDraft('employee', payload, editor);
      expect(f.user.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt);
      expect(f.input().baseVersion).not.toBe(payload.baseVersion);
      const after = structuredClone({ user: f.user, requests: f.requests, audits: f.audits });
      await expect(f.service.submitDraft('employee', { ...payload, employee: {}, profile: { education: 'Stale overwrite' } }, editor))
        .rejects.toBeInstanceOf(ConflictException);
      expect({ user: f.user, requests: f.requests, audits: f.audits }).toEqual(after);
      expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    },
  );

  it('advances the version for a same-ID contract correction without new employment or profile identities', async () => {
    const f = versionFixture();
    const contract = { id: 'existing-contract', contractType: 'contract', sequence: 0, name: 'Original contract',
      signedAt: new Date('2025-01-01'), effectiveFrom: new Date('2025-01-01'), expiresAt: null, isActive: true,
      updatedAt: new Date('2026-01-01') };
    f.user.employeeContracts = [contract];
    const payload = f.input({}, {}, undefined, [{ ...contract, name: 'Corrected contract' }]);
    await f.service.submitDraft('employee', payload, editor);
    expect(f.user.employeeContracts[0]).toMatchObject({ id: contract.id, name: 'Corrected contract' });
    expect(f.tx.employeeContract.create).not.toHaveBeenCalled();
    expect(f.user.employmentHistory.map((e: any) => e.id)).toEqual(['employment']);
    expect(f.input().baseVersion).not.toBe(payload.baseVersion);
    await expect(f.service.submitDraft('employee', { ...payload, contracts: [{ ...contract, name: 'Stale contract' }] }, editor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('advances monotonically for two real changes in the same millisecond, even after a clock rollback', async () => {
    const f = versionFixture();
    const instant = new Date('2026-11-14T00:00:00Z');
    f.user.updatedAt = instant;
    jest.useFakeTimers().setSystemTime(instant);
    try {
      await f.service.submitDraft('employee', f.input({}, { education: 'First' }), editor);
      expect(f.user.updatedAt.getTime()).toBe(instant.getTime() + 1);
      const firstVersion = f.input().baseVersion;
      jest.setSystemTime(new Date(instant.getTime() - 5000));
      await f.service.submitDraft('employee', f.input({}, { education: 'Second' }), editor);
      expect(f.user.updatedAt.getTime()).toBe(instant.getTime() + 2);
      expect(f.input().baseVersion).not.toBe(firstVersion);
    } finally { jest.useRealTimers(); }
  });

  it('keeps same-value submissions and draft saves from advancing the formal version', async () => {
    const f = versionFixture();
    const before = f.input().baseVersion;
    await expect(f.service.submitDraft('employee', f.input({}, { education: ' Original ' }), editor))
      .rejects.toThrow('未检测到实际变更');
    expect(f.input().baseVersion).toBe(before);
    expect(f.tx.user.update).not.toHaveBeenCalled();
    const draft = await f.service.saveArchiveDraft('employee', f.input({}, { education: 'Draft' }), editor);
    expect(f.input().baseVersion).toBe(before);
    expect(f.user.employeeProfile.education).toBe('Original');
    expect(f.tx.user.update).not.toHaveBeenCalled();
    await f.service.submitDraft('employee', { employee: {}, profile: { education: 'Draft' },
      draftId: draft!.id, expectedVersion: draft!.requestVersion }, editor);
    expect(f.input().baseVersion).not.toBe(before);
  });

  it('keeps a same-sensitive-value replacement a no-op despite randomized encryption', async () => {
    const f = versionFixture();
    await f.service.submitDraft('employee', f.input({}, { bankAccount: '6222000000000000' }), editor);
    const before = f.input().baseVersion;
    f.tx.user.update.mockClear();
    await expect(f.service.submitDraft('employee', f.input({}, { bankAccount: '6222000000000000' }), editor))
      .rejects.toThrow('未检测到实际变更');
    expect(f.input().baseVersion).toBe(before);
    expect(f.tx.user.update).not.toHaveBeenCalled();
  });

  it('preserves the no-baseVersion legacy profile API while invalidating already-open archive pages', async () => {
    const f = versionFixture();
    const payload = f.input({}, { education: 'Stale' });
    await f.service.upsertProfile('employee', { gender: '女' }, editor);
    expect(f.input().baseVersion).not.toBe(payload.baseVersion);
    await expect(f.service.submitDraft('employee', payload, editor)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['profile', 'phone', 'sensitive fingerprint', 'contract', 'manager']) (
    'rejects draftId submission after another entry changes its saved %s baseline, even with a fresh supplied baseVersion', async section => {
      const f = versionFixture();
      f.user.employeeContracts = [{ id: 'contract', contractType: 'contract', sequence: 0, name: 'Original', isActive: true }];
      const draft = await f.service.saveArchiveDraft('employee', f.input({}, { education: 'Draft' }), editor);
      if (section === 'profile') f.user.employeeProfile.education = 'Other entry';
      if (section === 'phone') f.user.phone = '13800000000';
      if (section === 'sensitive fingerprint') f.user.employeeProfile.bankAccountFingerprint = 'synthetic-other-fingerprint';
      if (section === 'contract') f.user.employeeContracts[0].name = 'Other entry';
      if (section === 'manager') f.user.directManagerId = 'other-manager';
      const before = structuredClone({ user: f.user, requests: f.requests, audits: f.audits });
      await expect(f.service.submitDraft('employee', { ...f.input({}, { education: 'Draft' }),
        draftId: draft!.id, expectedVersion: draft!.requestVersion }, editor)).rejects.toBeInstanceOf(ConflictException);
      expect({ user: f.user, requests: f.requests, audits: f.audits }).toEqual(before);
    },
  );

  it('rolls back direct data and audits and returns 409 when the final version write loses serialization', async () => {
    const f = versionFixture();
    const before = structuredClone(f.user);
    f.tx.user.update.mockImplementation(async ({ data }) => {
      if (data.updatedAt) throw { code: 'P2034' };
      Object.assign(f.user, data); return f.user;
    });
    await expect(f.service.submitDraft('employee', f.input({}, { education: 'Must roll back' }), editor))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.user).toEqual(before);
    expect(f.requests).toEqual([]);
    expect(f.audits).toEqual([]);
  });
});

describe('archive contract HTTP boundary with production implicit conversion', () => {
  let app: INestApplication;
  let f: ReturnType<typeof setup>;
  let actor: typeof editor;
  const employeeId = '11111111-1111-4111-8111-111111111111';
  const subjectId = '454ff4f9-4d7d-44e8-ba83-1409ccba466e';
  const contract = { contractType: 'contract', sequence: 0, name: 'Synthetic back-signed contract',
    signingCompany: 'Synthetic subject', signedAt: '2026-11-12', effectiveFrom: '2025-11-14', expiresAt: '2028-10-14',
    termType: '', originalCompany: '', newCompany: '', confidentialityAgreement: '', nonCompeteAgreement: '',
    portraitAgreement: '', images: [], attachments: [], contractSubjectId: subjectId };
  const submit = (contracts: unknown[]) => request(app.getHttpServer()).patch(`/employee-archives/${employeeId}/draft`)
    .send(f.input({}, {}, undefined, contracts));

  beforeEach(async () => {
    f = setup();
    f.user.id = employeeId;
    actor = { ...editor, hrCapabilities: [...editor.hrCapabilities] };
    f.tx.contractSubject = { findUnique: jest.fn(async () => ({ id: subjectId, name: 'Synthetic subject', isActive: true })) };
    const module = await Test.createTestingModule({ controllers: [EmployeeArchivesController], providers: [
      { provide: EmployeeArchivesService, useValue: f.service },
      { provide: EmployeeRosterImportService, useValue: {} },
      { provide: EmployeeDataReviewsService, useValue: new EmployeeDataReviewsService(f.db) },
      { provide: PersonnelDiagnosticsService, useValue: {} },
      { provide: EmployeeIdentityMatchService, useValue: {} },
      { provide: EmployeeOnboardingService, useValue: {} },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.user = actor; next(); });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });
  afterEach(async () => { await app?.close(); });

  it('F05 returns the field map through the real HTTP filter without converting bad profile types', async () => {
    const response = await request(app.getHttpServer()).patch(`/employee-archives/${employeeId}/draft`)
      .send(f.input({}, { education: 'x'.repeat(51), ethnicity: 123 })).expect(400);
    expect(response.body).toMatchObject({ code: 4001, data: { fieldErrors: {
      'profile.education': '最多填写 50 个字符', 'profile.ethnicity': expect.any(String),
    } } });
    expect(f.tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
  });

  it('F05 rejects non-string performance relationships instead of silently clearing them', async () => {
    const response = await request(app.getHttpServer()).patch(`/employee-archives/${employeeId}/draft`)
      .send(f.input({}, { education: 'Do not apply' }, { managerId: false })).expect(400);
    expect(response.body).toMatchObject({ code: 4001, data: { fieldErrors: { 'performance.managerId': expect.any(String) } } });
    expect(f.tx.employeeProfile.upsert).not.toHaveBeenCalled();
  });

  it('accepts the real UI first-contract payload and applies all contract fields', async () => {
    const response = await submit([contract]).expect(200);
    expect(response.body.data.reviewOutcome).toBe('not_required');
    expect(response.body.data.request.proposedValue.contracts).toEqual([contract]);
    expect(f.user.employeeContracts).toEqual([expect.objectContaining({ name: contract.name, contractType: 'contract',
      signingCompany: contract.signingCompany, contractSubjectId: subjectId, signedAt: new Date('2026-11-12'),
      effectiveFrom: new Date('2025-11-14'), expiresAt: new Date('2028-10-14'), isActive: true })]);
  });

  it('keeps draft contracts and material objects without applying or serializing them as empty arrays', async () => {
    const draftContract = { ...contract, signedAt: '2026-02-31', attachments: [{ name: 'Synthetic.pdf',
      url: '/storage/download?key=employee-contracts%2Fattachments%2Fsynthetic.pdf', size: 42, mimeType: 'application/pdf' }] };
    const response = await request(app.getHttpServer()).patch(`/employee-archives/${employeeId}/draft/save`)
      .send(f.input({}, {}, undefined, [draftContract])).expect(200);
    expect(response.body.data.proposedValue.contracts).toEqual([draftContract]);
    expect(f.requests[0].proposedValue.contracts).toEqual([draftContract]);
    expect(f.user.employeeContracts).toEqual([]);
  });

  it.each([
    [[{ ...contract, signedAt: '2026-02-31' }], 'contracts.0.signedAt'],
    [[{ ...contract, signedAt: 123 }], 'contracts.0.signedAt'],
    [[{ ...contract, expiresAt: '2025-11-13' }], 'contracts.0.expiresAt'],
    [[{ ...contract, contractType: 'unknown-new-type' }], 'contracts.0.contractType'],
    [[contract, { ...contract, sequence: 1 }], 'contracts.1.name'],
    [[[]], 'contracts.0'], [[null], 'contracts.0'], [['invalid-row'], 'contracts.0'],
  ] as Array<[unknown[], string]>)('retains the business error path after DTO conversion: %j', async (contracts, field) => {
    const response = await submit(contracts).expect(400);
    expect(response.body).toMatchObject({ code: 4001, data: { fieldErrors: { [field]: expect.any(String) } } });
    expect(f.user.employeeContracts).toEqual([]);
    expect(f.requests).toEqual([]);
    expect(f.audits).toEqual([]);
  });

  it('retains legacy duplicate IDs and missing dates during an unrelated HTTP submission', async () => {
    f.user.employeeContracts = ['legacy-a', 'legacy-b'].map((id, sequence) => ({ id, sequence, contractType: 'legacy-custom',
      name: 'Same legacy content', signedAt: null, effectiveFrom: null, expiresAt: null, isActive: true, images: [], attachments: [] }));
    const before = structuredClone(f.user.employeeContracts);
    await request(app.getHttpServer()).patch(`/employee-archives/${employeeId}/draft`)
      .send(f.input({ name: 'Updated unrelated name' }, {}, undefined, before)).expect(200);
    expect(f.user.name).toBe('Updated unrelated name');
    expect(f.user.employeeContracts).toEqual(before);
    expect(f.tx.employeeContract.update).not.toHaveBeenCalled();
    expect(f.tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('still denies contract submission without archive editing capability', async () => {
    actor.hrCapabilities = [];
    await submit([contract]).expect(403);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});

describe('manual archive changes apply at submission', () => {
  it.each(['leading', 'trailing', 'both'])('F05 persists only the validated education length with %s whitespace', async side => {
    const f = setup();
    const text = 'X'.repeat(50);
    const education = `${side !== 'trailing' ? ' ' : ''}${text}${side !== 'leading' ? ' ' : ''}`;
    await f.service.submitDraft('employee', f.input({}, { education }), editor);
    expect(f.user.employeeProfile.education).toBe(text);
    expect(f.tx.employeeProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { education: text } }));
    expect(f.audits.find(a => a.action === 'employee_profile_direct_update').newValue.education).toBe(text);
    f.tx.employeeProfile.upsert.mockClear();
    await expect(f.service.submitDraft('employee', f.input({}, { education: ` ${text}X ` }), editor))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'profile.education': '最多填写 50 个字符' } } } });
    expect(f.tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(f.user.employeeProfile.education).toBe(text);
  });

  it.each([' 2024-02-29 ', ' 2024-02-29T00:00:00.000Z '])('F05 persists normalized dates through both direct and reviewed profile paths: %s', date => {
    const f = setup();
    return f.service.submitDraft('employee', f.input({ plannedRegularDate: date },
      { birthDate: date, socialSecurityStartDate: date }), editor).then(result => {
      expect(f.user.plannedRegularDate).toEqual(new Date('2024-02-29'));
      expect(f.user.employeeProfile.birthDate).toEqual(new Date('2024-02-29'));
      expect(f.user.employeeProfile.socialSecurityStartDate).toEqual(new Date('2024-02-29'));
      expect(result.request!.proposedValue.employee.plannedRegularDate).toBe('2024-02-29');
      expect(result.request!.proposedValue.profile.socialSecurityStartDate).toBe('2024-02-29');
    });
  });

  it('F05 leaves padded contract proposals unchanged while the existing apply path stores trimmed text', async () => {
    const f = setup();
    const name = ` ${'X'.repeat(150)} `;
    const result = await f.service.submitDraft('employee', f.input({}, {}, undefined,
      [{ contractType: 'contract', name, signedAt: '2024-02-29' }]), editor);
    expect(result.request!.proposedValue.contracts[0].name).toBe(name);
    expect(f.user.employeeContracts[0].name).toBe('X'.repeat(150));
  });

  it.each([
    ['profile', 'education', 'x'.repeat(51)], ['profile', 'ethnicity', 'x'.repeat(51)],
    ['profile', 'education', 123], ['profile', 'gender', 'x'.repeat(21)],
    ['profile', 'childrenStatus', 'x'.repeat(31)], ['profile', 'childrenCount', 1.5],
    ['profile', 'childrenCount', false], ['profile', 'childrenCount', 21],
    ['profile', 'socialSecurityStartDate', '2026-02-30'], ['profile', 'housingFundStartDate', 123],
    ['employee', 'name', 'x'.repeat(51)], ['employee', 'name', ''],
    ['employee', 'jobGrade', 'x'.repeat(31)], ['employee', 'probationMonths', 13],
    ['employee', 'entryDate', '2026-02-30'], ['employee', 'plannedRegularDate', '2025-02-29'],
    ['employee', 'actualRegularDate', false], ['employee', 'phone', 123],
  ])('F05 rejects %s.%s before any formal write', async (section, field, value) => {
    const f = setup();
    const payload = f.input({ name: 'Do not apply' }, { education: 'Do not apply' });
    (payload as any)[section][field] = value;
    await expect(f.service.submitDraft('employee', payload, editor)).rejects.toMatchObject({
      response: { code: 4001, data: { fieldErrors: { [`${section}.${field}`]: expect.any(String) } } },
    });
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
    expect(f.audits).toEqual([]);
  });

  it('F05 accepts the 50-character boundary and normalizes nullable blank fields without turning blank counts into zero', async () => {
    const f = setup();
    f.user.employeeProfile = { education: 'Old', ethnicity: 'Old', childrenCount: 2, graduationDate: new Date('2024-02-29') };
    await f.service.submitDraft('employee', f.input({}, { education: 'x'.repeat(50), ethnicity: '', childrenCount: '', graduationDate: '' }), editor);
    expect(f.user.employeeProfile).toMatchObject({ education: 'x'.repeat(50), ethnicity: null, childrenCount: null, graduationDate: null });
  });

  it('F05 keeps incomplete and invalid profile input in drafts only', async () => {
    const f = setup();
    const payload = f.input({ name: '' }, { education: 'x'.repeat(51), childrenCount: false });
    const draft: any = await f.service.saveArchiveDraft('employee', payload, editor);
    expect(draft.proposedValue.profile).toMatchObject(payload.profile);
    expect(f.user.employeeProfile).toBeNull();
    await expect(f.service.submitDraft('employee', { ...payload, draftId: draft.id, expectedVersion: draft.requestVersion }, editor))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'profile.education': expect.any(String) } } } });
  });

  it.each(['Directory family', null])('D01 normalizes attempts to override the same catalog position (family=%s)', async family => {
    const f = setup();
    const id = '40000000-0000-4000-8000-000000000001';
    Object.assign(f.user, { positionId: id, position: 'Catalog position' });
    Object.assign(f.user.employmentHistory[0], { positionId: id, position: 'Catalog position', jobFamily: 'Historical family' });
    f.tx.position = { findUnique: jest.fn(async () => ({ id, name: 'Catalog position', jobFamily: family, isActive: true })) };
    const result = await f.service.submitDraft('employee', f.input({ positionId: id, position: 'Spoofed name', jobFamily: 'Spoofed family' }), editor);
    expect(result.request?.proposedValue.employee).toMatchObject({ positionId: id, position: 'Catalog position', jobFamily: family });
    expect(f.user.employmentHistory[0].jobFamily).toBe(family);
  });

  it('D01 keeps an untouched same-ID family snapshot while another field changes', async () => {
    const f = setup();
    const id = '40000000-0000-4000-8000-000000000001';
    Object.assign(f.user, { positionId: id, position: 'Catalog position' });
    Object.assign(f.user.employmentHistory[0], { positionId: id, position: 'Catalog position', jobFamily: 'Historical family' });
    f.tx.position = { findUnique: jest.fn(async () => ({ id, name: 'Catalog position', jobFamily: 'Renamed family', isActive: true })) };
    const result = await f.service.submitDraft('employee', f.input({ positionId: id, jobFamily: 'Historical family', workLocation: 'New office' }), editor);
    expect(result.request?.proposedValue.employee.jobFamily).toBe('Historical family');
    expect(f.user.employmentHistory[0].jobFamily).toBe('Historical family');
  });

  it('F06 explicitly links a mixed direct update to its persisted submission version', async () => {
    const f = setup();
    const result = await f.service.submitDraft('employee', f.input({ name: 'New name' }, { education: 'Master' }), editor);
    const direct = f.audits.filter(a => a.action === 'employee_profile_direct_update');
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ userId: editor.id, entityType: 'user', entityId: 'employee',
      oldValue: { education: null }, newValue: { education: 'Master', requestId: result.request!.id, requestVersion: 1 } });
    expect(result.request!.baseValue.profile.education).toBe('Master');
    expect(result.request!.proposedValue.profile.education).toBe('Master');
  });

  it.each([
    ['signedAt', '2026-02-31'], ['effectiveFrom', 'not-a-date'], ['expiresAt', '2025-02-29'],
    ['contractType', 'unknown-new-type'], ['signedAt', 123],
  ])('rejects invalid contract %s=%s with field errors and no applied changes', async (field, value) => {
    const f = setup();
    await expect(f.service.submitDraft('employee', f.input({ name: 'Do not apply' }, {}, undefined,
      [{ contractType: 'contract', [field]: value }]), editor)).rejects.toMatchObject({
      response: { code: 4001, data: { fieldErrors: { [`contracts.0.${field}`]: expect.any(String) } } },
    });
    expect(f.user.name).toBe('Synthetic employee');
    expect(f.user.employeeContracts).toEqual([]);
    expect(f.requests).toEqual([]);
    expect(f.audits).toEqual([]);
  });

  it('saves incomplete contract input as a draft but rejects invalid dates on explicit submission', async () => {
    const f = setup();
    const input = f.input({}, {}, undefined, [{ contractType: 'contract', signedAt: '2026-02-31' }]);
    const draft: any = await f.service.saveArchiveDraft('employee', input, editor);
    expect(draft.proposedValue.contracts[0].signedAt).toBe('2026-02-31');
    expect(f.user.employeeContracts).toEqual([]);
    await expect(f.service.submitDraft('employee', { ...input, draftId: draft.id, expectedVersion: draft.requestVersion }, editor))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'contracts.0.signedAt': expect.any(String) } } } });
  });

  it('does not block unrelated changes on unchanged legacy types, missing dates or reversed historical ranges', async () => {
    const f = setup();
    f.user.employeeContracts = [
      { id: 'legacy', contractType: 'legacy-custom', sequence: 0, name: 'Legacy', signedAt: null,
        effectiveFrom: null, expiresAt: null, isActive: true, images: [], attachments: [] },
      { id: 'reversed', contractType: 'contract', sequence: 1, name: 'Historical range', signedAt: null,
        effectiveFrom: new Date('2024-03-01'), expiresAt: new Date('2024-02-01'), isActive: true, images: [], attachments: [] },
    ];
    const before = structuredClone(f.user.employeeContracts);
    await f.service.submitDraft('employee', f.input({ name: 'Updated unrelated field' }, {}, undefined,
      JSON.parse(JSON.stringify(before))), editor);
    expect(f.user.name).toBe('Updated unrelated field');
    expect(f.user.employeeContracts).toEqual(before);
    expect(f.tx.employeeContract.update).not.toHaveBeenCalled();
  });

  it('checks reversed historical dates when the contract itself is materially edited', async () => {
    const f = setup();
    const old = { id: 'legacy', contractType: 'contract', sequence: 0, name: 'Legacy', signedAt: null,
      effectiveFrom: new Date('2024-03-01'), expiresAt: new Date('2024-02-01'), isActive: true };
    f.user.employeeContracts = [old];
    await expect(f.service.submitDraft('employee', f.input({}, {}, undefined, [{ ...old, name: 'Changed' }]), editor))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'contracts.0.expiresAt': expect.any(String) } } } });
    expect(f.user.employeeContracts[0].name).toBe('Legacy');
  });

  it('preserves unchanged duplicate legacy contracts during an unrelated formal submission', async () => {
    const f = setup();
    f.user.employeeContracts = ['legacy-a', 'legacy-b'].map((id, sequence) => ({ id, sequence,
      contractType: 'legacy-custom', name: 'Same legacy content', signedAt: null, effectiveFrom: null,
      expiresAt: null, isActive: true, images: [], attachments: [] }));
    const before = structuredClone(f.user.employeeContracts);
    const result = await f.service.submitDraft('employee', f.input({ name: 'Unrelated update' }, {}, undefined,
      JSON.parse(JSON.stringify(before))), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user.name).toBe('Unrelated update');
    expect(f.user.employeeContracts).toEqual(before);
    expect(f.tx.employeeContract.update).not.toHaveBeenCalled();
    expect(f.tx.employeeContract.create).not.toHaveBeenCalled();
  });

  it('rejects non-object contract entries using the row field path', async () => {
    const f = setup();
    await expect(f.service.submitDraft('employee', f.input({}, {}, undefined, [null]), editor))
      .rejects.toMatchObject({ response: { code: 4001, data: { fieldErrors: { 'contracts.0': expect.any(String) } } } });
  });

  it.each([null, '', 'invalid-code', 123, false])('rejects explicit invalid company %s before applying an archive edit', async company => {
    const f = setup();
    Object.assign(f.user.employmentHistory[0], { company: 'fansibao', contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: 'Reviewed subject' });
    await expect(f.service.submitDraft('employee', f.input({ contractSubjectId: null, company }, { education: 'Do not apply' }), editor))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(f.user.employmentHistory[0]).toMatchObject({ company: 'fansibao', companyText: 'Reviewed subject' });
    expect(f.user.employeeProfile).toBeNull();
    expect(f.requests).toEqual([]);
  });

  it('preserves an omitted company in a legacy unlinked archive payload', async () => {
    const f = setup();
    f.user.employmentHistory[0].company = 'fansibao';
    await f.service.submitDraft('employee', f.input({ position: 'Revised position' }), editor);
    expect(f.user.employmentHistory[0]).toMatchObject({ company: 'fansibao', position: 'Revised position' });
  });

  it.each([
    { noEmployment: true, applyProfile: false }, { noEmployment: true, applyProfile: true },
    { noEmployment: false, applyProfile: false }, { noEmployment: false, applyProfile: true },
  ])('allows unchanged historical null company in full profile payloads: %j', async ({ noEmployment, applyProfile }) => {
    const f = setup();
    if (noEmployment) f.user.employmentHistory = [];
    else delete f.user.employmentHistory[0].company;
    const employee = { ...(f.service as any).employeeReviewData(f.user, f.user.employmentHistory[0] ?? null), company: null };
    const profile = { education: 'Master', ...(applyProfile ? { socialSecurityStatus: 'Updated' } : {}) };
    const result = await f.service.submitDraft('employee', f.input(employee, profile), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user.employeeProfile).toMatchObject(profile);
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(f.tx.employmentRecord.update).not.toHaveBeenCalled();
    if (noEmployment) expect(f.user.employmentHistory).toEqual([]);
    else expect(f.user.employmentHistory[0]).not.toHaveProperty('company');
  });

  it('derives a null company from a newly selected mapped subject on archive submission', async () => {
    const f = setup();
    const id = '11111111-1111-4111-8111-111111111111';
    f.tx.contractSubject = { findUnique: jest.fn(async () => ({ id, name: 'Selected subject', isActive: true, internalCompany: CompanyCode.fansibao })) };
    await f.service.submitDraft('employee', f.input({ contractSubjectId: id, company: null }), editor);
    expect(f.user.employmentHistory[0]).toMatchObject({ contractSubjectId: id, company: 'fansibao', companyText: 'Selected subject' });
  });

  it.each([null, 'invalid-code'])('rejects invalid stored archive company %s at the apply boundary too', async company => {
    const f = setup();
    f.user.employmentHistory[0].company = 'fansibao';
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ company, position: 'Do not apply' }), editor);
    Object.assign(f.requests[0], { recordStatus: 'submitted' });
    await expect(f.db.$transaction((tx: any) => new EmployeeDataReviewsService(f.db).applyArchiveChange(tx, draft.id, editor)))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(f.user.employmentHistory[0]).toMatchObject({ company: 'fansibao', position: 'Analyst' });
  });

  it.each([true, false])('inherits an omitted stored archive company without defaulting to fuede (base has company: %s)', async baseHasCompany => {
    const f = setup();
    f.user.employmentHistory[0].company = 'fansibao';
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ position: 'Revised position' }), editor);
    Object.assign(f.requests[0], { recordStatus: 'submitted' });
    delete f.requests[0].proposedValue.employee.company;
    if (!baseHasCompany) delete f.requests[0].baseValue.employee.company;
    await f.db.$transaction((tx: any) => new EmployeeDataReviewsService(f.db).applyArchiveChange(tx, draft.id, editor));
    expect(f.user.employmentHistory[0]).toMatchObject({ company: 'fansibao', position: 'Revised position' });
  });

  it('the legacy profile endpoint applies defined fields immediately and never rewrites an existing draft', async () => {
    const f = setup();
    const result = await f.service.upsertProfile('employee', { gender: '女' }, editor);
    expect(result).toMatchObject({ reviewOutcome: 'not_required' });
    expect(f.user.employeeProfile.gender).toBe('女');
    expect(f.requests).toHaveLength(0);
    await expect(f.service.upsertProfile('employee', { gender: '女' }, editor)).rejects.toThrow('未检测到实际变更');
    await f.service.saveArchiveDraft('employee', f.input({ name: 'Existing draft' }), editor);
    await expect(f.service.upsertProfile('employee', { gender: '男' }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.user.employeeProfile.gender).toBe('女');
    expect(f.requests[0].proposedValue.employee.name).toBe('Existing draft');
  });

  it('an edit-only HR can apply employment, contracts and performance relations atomically without review permission', async () => {
    const f = setup();
    const result = await f.service.submitDraft('employee', f.input({ name: 'Updated', jobGrade: 'P2' },
      { education: 'Master' }, { managerId: 'manager' }, [{ contractType: 'contract', sequence: 0, name: 'Contract' }]), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user).toMatchObject({ name: 'Updated', directManagerId: 'manager', employeeProfile: { education: 'Master' } });
    expect(f.user.employmentHistory[0]).toMatchObject({ jobGrade: 'P2' });
    expect(f.user.employeeContracts).toEqual([expect.objectContaining({ name: 'Contract', isActive: true })]);
    expect(f.requests[0]).toMatchObject({ profileReviewStatus: 'approved', performanceReviewStatus: 'approved', appliedAt: expect.any(Date) });
    expect(f.audits.some(x => x.action === 'apply_employee_archive_change')).toBe(true);
    expect(f.audits.some(x => x.action === 'approve_employee_data_change')).toBe(false);
    expect(f.requests[0].profileReviewedById).toBeFalsy();
  });

  it('draft saves never apply and a submitted legacy pending request continues with its ID and version', async () => {
    const f = setup();
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ name: 'First draft' }), editor);
    expect(f.user.name).toBe('Synthetic employee');
    Object.assign(f.requests[0], { recordStatus: 'submitted', profileReviewStatus: 'pending' });
    const result = await f.service.submitDraft('employee', { ...f.input({ name: 'Completed' }), draftId: draft.id, expectedVersion: draft.requestVersion }, editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user.name).toBe('Completed');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].revisionHistory).toEqual(expect.arrayContaining([expect.objectContaining({ proposedValue: expect.objectContaining({ employee: expect.objectContaining({ name: 'First draft' }) }) })]));
  });

  it('keeps independent review authority unavailable to an edit-only HR', async () => {
    const f = setup();
    await expect(new EmployeeDataReviewsService(f.db).approveBatch({ requestIds: ['hire'], scopes: ['profile'] }, editor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([UserStatus.resigned, UserStatus.pending_entry])('does not use an archive edit to start %s lifecycle', async status => {
    const f = setup();
    await expect(f.service.submitDraft('employee', f.input({ employeeStatus: status }), editor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.user.status).toBe(UserStatus.active);
    expect(f.requests).toHaveLength(0);
  });

  it('preserves formal data when the draft version is stale', async () => {
    const f = setup();
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ name: 'First' }), editor);
    await expect(f.service.submitDraft('employee', { ...f.input({ name: 'Stale' }), draftId: draft.id, expectedVersion: 99 }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.user.name).toBe('Synthetic employee');
  });

  it('forks a partially applied legacy request without changing its approved employment source during autosave', async () => {
    const f = setup();
    await f.service.submitDraft('employee', f.input({ name: 'Already applied', jobGrade: 'P2' }, {}, undefined,
      [{ contractType: 'contract', sequence: 0, name: 'Already applied contract', signedAt: '2026-01-01' }]), editor);
    const original = f.requests[0];
    original.performanceReviewStatus = 'pending'; original.proposedValue.performance = { managerId: 'manager' };
    original.profileReviewedById = 'historical-reviewer'; original.profileReviewedAt = new Date('2026-11-01'); original.appliedAt = null;
    const employmentId = f.user.employmentHistory[0].id;
    const contractId = f.user.employeeContracts[0].id;
    const revision: any = await f.service.saveArchiveDraft('employee', { ...f.input({ name: 'New revision', jobGrade: 'P3' }, {},
      { managerId: 'manager' }, f.user.employeeContracts), draftId: original.id, expectedVersion: original.requestVersion }, editor);
    expect(revision.id).not.toBe(original.id);
    expect(original).toMatchObject({ profileReviewStatus: 'approved', performanceReviewStatus: 'cancelled',
      profileReviewedById: 'historical-reviewer', archivedAt: expect.any(Date) });
    expect(f.user).toMatchObject({ name: 'Already applied', directManagerId: null });
    expect(f.user.employmentHistory[0]).toMatchObject({ id: employmentId, jobGrade: 'P2', sourceRequestId: original.id });
    expect(revision.baseValue.employee.name).toBe('Already applied');
    expect(revision.revisionHistory[0]).toMatchObject({ sourceRequestId: original.id, profileReviewedById: 'historical-reviewer',
      profileReviewedAt: '2026-11-01T00:00:00.000Z' });
    await f.service.submitDraft('employee', { ...f.input({ name: 'New revision', jobGrade: 'P3' }, {},
      { managerId: 'manager' }, f.user.employeeContracts), draftId: revision.id, expectedVersion: revision.requestVersion }, editor);
    expect(f.user).toMatchObject({ name: 'New revision', directManagerId: 'manager' });
    expect(f.user.employmentHistory[0].jobGrade).toBe('P3');
    expect(f.user.employeeContracts.filter((c: any) => c.isActive).map((c: any) => c.id)).toEqual([contractId]);
  });

  it('rolls back profile, contracts and request when a performance relation is invalid', async () => {
    const f = setup();
    await expect(f.service.submitDraft('employee', f.input({ name: 'Do not apply' }, { education: 'Master' },
      { managerId: 'employee' }, [{ sequence: 0, name: 'Do not persist' }]), editor)).rejects.toThrow('不能是员工本人');
    expect(f.user).toMatchObject({ name: 'Synthetic employee', directManagerId: null, employeeProfile: null, employeeContracts: [] });
    expect(f.requests).toHaveLength(0); expect(f.audits).toHaveLength(0);
  });

  it('keeps an applying request locked instead of resuming or applying it twice', async () => {
    const f = setup();
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ name: 'First' }), editor);
    Object.assign(f.requests[0], { recordStatus: 'submitted', profileReviewStatus: 'applying' });
    await expect(f.service.submitDraft('employee', { ...f.input({ name: 'Second' }), draftId: draft.id, expectedVersion: draft.requestVersion }, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.user.name).toBe('Synthetic employee');
  });

  it('rejects direct service submission without archive edit capability', async () => {
    const f = setup();
    await expect(f.service.submitDraft('employee', f.input({ name: 'Forbidden' }), { ...editor, hrCapabilities: [] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.requests).toHaveLength(0);
  });

  it('does not accept hidden organization, account or lifecycle commands inside the editable employee object', async () => {
    const f = setup();
    const result = await f.service.submitDraft('employee', f.input({ name: 'Allowed', employeeNo: 'forged', sysRole: 'hr',
      organizationPath: ['forged'], organizationLeaderPaths: [['forged']], changeType: 'resignation', effectiveFrom: '2099-01-01' }), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user).toMatchObject({ name: 'Allowed', employeeNo: '101', status: 'active' });
    expect(f.requests[0].proposedValue.employee).not.toHaveProperty('organizationPath');
    expect(f.requests[0].proposedValue.employee).not.toHaveProperty('changeType');
  });

  it('keeps pending-entry identity inactive and corrects its carrier without creating another employment or number', async () => {
    const f = setup(); f.user.status = UserStatus.pending_entry; f.user.employeeNo = null;
    Object.assign(f.user.employmentHistory[0], { sourceRequestId: 'onboarding', employeeNo: '102', employeeStatus: 'probation' });
    const originalDate = f.user.employmentHistory[0].effectiveFrom;
    f.requests.push({ id: 'onboarding', requestVersion: 1, updatedAt: new Date(), sourceType: 'manual_employee_create',
      intakeType: 'new_hire', onboardingStatus: 'pending_entry', profileReviewStatus: 'approved', performanceReviewStatus: 'approved',
      profileReviewedById: 'historical-reviewer', profileReviewedAt: new Date('2026-01-01'),
      proposedValue: { employee: { employeeStatus: 'probation', employeeNo: '102', entryDate: '2025-01-01' }, performance: { managerId: 'old-manager' } } });
    const result = await f.service.submitDraft('employee', f.input({ name: 'Pending corrected', jobGrade: 'P3', deptId: 'new-department' }, {}, { managerId: 'new-manager' }), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user).toMatchObject({ name: 'Pending corrected', status: 'pending_entry', employeeNo: null, directManagerId: 'new-manager' });
    expect(f.user.employmentHistory).toHaveLength(1);
    expect(f.user.employmentHistory[0]).toMatchObject({ sourceRequestId: 'onboarding', employeeStatus: 'probation', employeeNo: '102',
      effectiveFrom: originalDate, deptId: 'new-department', jobGrade: 'P3' });
    expect(f.requests[0]).toMatchObject({ requestVersion: 2, profileReviewedById: 'historical-reviewer',
      proposedValue: { employee: { name: 'Pending corrected', employeeStatus: 'probation', employeeNo: '102', entryDate: '2025-01-01' },
        performance: { managerId: 'new-manager' } } });
    expect(f.requests[0].revisionHistory[0].proposedValue.performance.managerId).toBe('old-manager');
  });

  it('allows legacy pending-entry personal and contract corrections without creating employment', async () => {
    const f = setup(); f.user.status = UserStatus.pending_entry; f.user.employeeNo = null;
    f.user.employmentHistory = []; f.user.deptId = null; f.user.entryDate = null;
    const result = await f.service.submitDraft('employee', f.input({ name: 'Legacy correction' }, {}, undefined,
      [{ contractType: 'contract', sequence: 0, name: 'Historical material' }]), editor);
    expect(result.reviewOutcome).toBe('not_required');
    expect(f.user).toMatchObject({ name: 'Legacy correction', status: 'pending_entry', employeeNo: null });
    expect(f.user.employeeContracts).toHaveLength(1); expect(f.user.employmentHistory).toEqual([]);
  });

  it('does not rewrite a freshly edited job family from an older approved position change', async () => {
    const f = setup();
    const draft: any = await f.service.saveArchiveDraft('employee', f.input({ jobFamily: 'Approved family', positionId: 'position-2' }), editor);
    const previous = f.requests[0];
    Object.assign(previous, { recordStatus: 'submitted', profileReviewStatus: 'approved', performanceReviewStatus: 'pending' });
    previous.proposedValue.performance = { managerId: 'manager' }; previous.baseValue.employee.positionId = 'position-1';
    Object.assign(f.user, { positionId: 'position-2', position: 'Directory label' });
    Object.assign(f.user.employmentHistory[0], { positionId: 'position-2', position: 'Directory label', jobFamily: 'Approved family' });
    f.tx.position = { findUnique: jest.fn(async () => ({ id: 'position-2', name: 'Directory label', jobFamily: 'Approved family' })) };
    const revision = await f.service.saveArchiveDraft('employee', { ...f.input({ jobFamily: 'Explicit correction', positionId: 'position-2' }), draftId: draft.id, expectedVersion: draft.requestVersion }, editor);
    expect(revision).toMatchObject({ profileReviewStatus: 'pending', proposedValue: { employee: { jobFamily: 'Explicit correction' } } });
    expect(f.user.employmentHistory[0].jobFamily).toBe('Approved family');
  });

  it('personnel settings applies the performance manager immediately without reviewer authority', async () => {
    const f = setup();
    const result = await new EmployeeDataReviewsService(f.db).proposePerformanceManager('employee', { managerId: 'manager' }, editor);
    expect(f.user.directManagerId).toBe('manager');
    expect(result).toMatchObject({ sourceType: 'manual_performance_relation', performanceReviewStatus: 'approved', appliedAt: expect.any(Date) });
    expect(f.audits.some(event => event.action === 'apply_employee_archive_change')).toBe(true);
  });

  it('does not reclassify a system account as an employee via archive edit', async () => {
    const f = setup(); f.user.accountType = 'system';
    await expect(f.service.submitDraft('employee', f.input({ name: 'Forbidden' }), editor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.user.accountType).toBe('system'); expect(f.requests).toHaveLength(0);
  });

  it('the controller reports direct settings as effective while reentry remains pending', async () => {
    const controller = new EmployeeArchivesController({ upsertProfile: jest.fn(async () => ({ reviewOutcome: 'not_required', directApplied: ['性别'] })) } as any, {} as any,
      { proposePerformanceManager: jest.fn(async () => ({ appliedAt: new Date() })) } as any,
      {} as any, {} as any, { createReentry: jest.fn(async () => ({ onboardingStatus: 'submitted' })) } as any);
    expect(await controller.proposePerformanceManager('employee', { managerId: 'manager' }, editor)).toMatchObject({ reviewOutcome: 'not_required' });
    expect(await controller.createReentry('employee', {} as any, editor)).toMatchObject({ reviewOutcome: 'pending' });
    expect(await controller.updateProfile('employee', { gender: '女' }, editor)).toMatchObject({ reviewOutcome: 'not_required' });
  });
});
