import { ValidationPipe } from '@nestjs/common';
import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { CreateEmployeeDto, CreateEmploymentRecordDto } from './dto/employee-archive.dto';
import { CreateEmployeeReentryDto, ReviseEmployeeReentryDto } from './dto/employee-onboarding.dto';

const subjectId = '11111111-1111-4111-8111-111111111111';
const deptId = '22222222-2222-4222-8222-222222222222';
const operator = { id: 'hr', sysRole: SysRole.hr } as any;
const input = { name: 'Synthetic', company: CompanyCode.fuede, deptId,
  entryDate: new Date('2020-01-01'), effectiveFrom: new Date('2020-01-01'),
  effectiveDate: new Date('2020-01-01'), employmentType: EmploymentType.full_time,
  employeeStatus: UserStatus.active, employee: { contractSubjectId: subjectId }, contractSubjectId: subjectId };

function setup(internalCompany: CompanyCode | null = CompanyCode.fansibao) {
  let request: any = null;
  const user: any = { id: 'user', name: 'Synthetic', status: 'resigned', accountType: 'employee',
    employeeNo: '001', archivedAt: null, employeeProfile: null, employmentHistory: [] };
  const subject = { id: subjectId, name: 'Synthetic subject', isActive: true, internalCompany };
  const tx: any = { contractSubject: { findUnique: jest.fn(async () => subject) },
    user: { findUnique: jest.fn(async () => user), create: jest.fn(async () => ({ id: 'created-user' })), update: jest.fn() },
    department: { findUnique: jest.fn(async () => ({ id: deptId, isActive: true })) },
    employmentRecord: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
    employeeProfile: { upsert: jest.fn() },
    employeeContract: { findMany: jest.fn(async () => []) },
    employeeNumberAssignment: { findFirst: jest.fn(async () => ({ id: 'reserved' })) },
    employeeDataChangeRequest: {
      findFirst: jest.fn(async () => request), findUnique: jest.fn(async () => request),
      create: jest.fn(async ({ data }) => (request = { id: 'request', requestVersion: 1, ...data })),
      update: jest.fn(async ({ data }) => (request = { ...request, ...data,
        requestVersion: data.requestVersion?.increment ? request.requestVersion + 1 : request.requestVersion })),
    }, auditLog: { create: jest.fn() },
  };
  const db: any = { ...tx, $transaction: async (run: any) => run(tx) };
  const numbers = { reserveNext: jest.fn(async () => '002') };
  return { tx, user, subject, numbers, request: () => request,
    archives: new EmployeeArchivesService(db, undefined, numbers as any),
    onboarding: new EmployeeOnboardingService(db, numbers as any, {} as any, {} as any),
    reviews: new EmployeeDataReviewsService(db),
  };
}

describe('company mapping at employee write boundaries', () => {
  it('normalizes a new hire and submits a formerly unmapped draft only after explicit mapping', async () => {
    const f = setup(null);
    const draft: any = await f.archives.saveEmployeeCreateDraft(input, operator);
    expect(draft.proposedValue.employee).toMatchObject({ company: null, companyText: 'Synthetic subject' });
    const submission = { ...input, draftId: draft.id, expectedVersion: 1 };
    await expect(f.archives.createEmployee(submission, operator)).rejects.toThrow('内部公司映射');
    expect(f.numbers.reserveNext).not.toHaveBeenCalled();
    f.subject.internalCompany = CompanyCode.beijing_fuede;
    f.subject.name = 'Renamed subject';
    const submitted: any = await f.archives.createEmployee(submission, operator);
    expect(submitted.proposedValue.employee).toMatchObject({ company: 'beijing_fuede', companyText: 'Synthetic subject' });
    expect(submitted.recordStatus).toBe('submitted');
  });

  it('rejects unmapped new hire submission without writing a request', async () => {
    const f = setup(null);
    await expect(f.archives.createEmployee(input, operator)).rejects.toThrow('内部公司映射');
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('normalizes submitted reentry and revalidates its same-subject revision', async () => {
    const f = setup();
    const result = await f.onboarding.createReentry('user', input, operator.id);
    expect(result.proposedValue.employee).toMatchObject({ company: 'fansibao', companyText: 'Synthetic subject' });
    f.subject.internalCompany = null;
    await expect(f.onboarding.reviseReentry(result.id, input, operator.id)).rejects.toThrow('内部公司映射');
    f.subject.internalCompany = CompanyCode.fuede_sports;
    expect((await f.onboarding.reviseReentry(result.id, input, operator.id)).proposedValue.employee)
      .toMatchObject({ company: 'fuede_sports' });
  });

  it('rejects unmapped reentry before request or number reservation', async () => {
    const f = setup(null);
    await expect(f.onboarding.createReentry('user', input, operator.id)).rejects.toThrow('内部公司映射');
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(f.numbers.reserveNext).not.toHaveBeenCalled();
  });

  it('keeps intake draft incomplete without inferring a company', async () => {
    const f = setup(null);
    await f.onboarding.createOnboardingIntake({ ...input, sourceSystem: 'synthetic', sourceReference: 'test',
      intakeType: 'new_hire', identitySnapshot: { name: 'Synthetic' } }, operator.id);
    expect(f.request()).toMatchObject({ recordStatus: 'draft', proposedValue: { employee: { company: null } } });
  });

  it('enforces mappings on direct employment submissions', async () => {
    const f = setup(null);
    f.user.status = 'active';
    await expect(f.archives.createEmploymentRecord('user', { ...input, changeType: 'transfer' }, operator))
      .rejects.toThrow('内部公司映射');
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    f.subject.internalCompany = CompanyCode.fansibao;
    const result: any = await f.archives.createEmploymentRecord('user', { ...input, changeType: 'transfer' }, operator);
    expect(result.proposedValue.employee).toMatchObject({ company: 'fansibao' });
  });

  it.each([null, CompanyCode.fuede_sports])('blocks reentry approval with missing/changed mapping %s instead of rewriting the frozen company', async mapping => {
    const f = setup();
    const result = await f.onboarding.createReentry('user', input, operator.id);
    f.subject.internalCompany = mapping;
    await expect(f.onboarding.applyApprovedReentry(f.tx, result.id, operator.id)).rejects.toThrow('内部公司映射');
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(f.request().proposedValue.employee.company).toBe('fansibao');
  });

  it.each([null, CompanyCode.fuede_sports])('checks mapping before profile approval has any employee writes: %s', async mapping => {
    const f = setup();
    const result: any = await f.archives.createEmployee(input, operator);
    f.subject.internalCompany = mapping;
    await expect((f.reviews as any).applyProfile(f.tx, { ...f.request(), id: result.id }, operator))
      .rejects.toThrow('内部公司映射');
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });

  it('preserves an already reviewed new-hire employment when only its arrival date is revised', async () => {
    const f = setup();
    await f.archives.createEmployee(input, operator);
    const request = f.request();
    request.userId = 'user';
    f.user.status = 'pending_entry';
    f.subject.internalCompany = null;
    f.tx.employmentRecord.findUnique.mockResolvedValue({ id: 'employment', userId: 'user',
      contractSubjectId: subjectId, company: 'fansibao', companyText: 'Original subject' });
    await expect((f.reviews as any).applyProfile(f.tx, request, operator)).resolves.toBe('user');
    expect(f.tx.employmentRecord.update).toHaveBeenCalledWith({ where: { id: 'employment' }, data: {
      effectiveFrom: new Date('2020-01-01'), effectiveTo: null, entryDate: new Date('2020-01-01'),
    } });
  });

  it('preserves an already reviewed reentry company on date-only approval after mapping removal', async () => {
    const f = setup();
    const result = await f.onboarding.createReentry('user', input, operator.id);
    f.subject.internalCompany = null;
    f.tx.employmentRecord.findUnique.mockResolvedValue({ id: 'employment', userId: 'user',
      contractSubjectId: subjectId, company: 'fansibao', companyText: 'Synthetic subject' });
    await expect(f.onboarding.applyApprovedReentry(f.tx, result.id, operator.id)).resolves.toBe('pending_entry');
    expect(f.tx.employmentRecord.update).toHaveBeenCalledWith({ where: { id: 'employment' },
      data: expect.objectContaining({ company: 'fansibao', companyText: 'Synthetic subject' }) });
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });
});

describe('subject-only company HTTP contract', () => {
  it.each([CreateEmployeeDto, CreateEmployeeReentryDto, ReviseEmployeeReentryDto, CreateEmploymentRecordDto])
    ('allows company omission only with a selected subject in %p', async metatype => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const value: any = { ...input, changeType: 'transfer' };
      delete value.company;
      await expect(pipe.transform(value, { type: 'body', metatype })).resolves.toBeDefined();
      await expect(pipe.transform({ ...value, company: null }, { type: 'body', metatype })).resolves.toBeDefined();
      await expect(pipe.transform({ ...value, company: 'invalid' }, { type: 'body', metatype })).rejects.toThrow();
      delete value.contractSubjectId;
      delete value.employee;
      await expect(pipe.transform(value, { type: 'body', metatype })).rejects.toThrow();
    });
});
