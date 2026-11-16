const selectedPositionId = '00000000-0000-4000-8000-000000000099';
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
const input = { positionId: selectedPositionId, name: 'Synthetic', company: CompanyCode.fuede, deptId,
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
    position: { findUnique: jest.fn(async () => ({ id: selectedPositionId, name: 'Selected position', jobFamily: null, isActive: true })) },
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

describe('company directory at employee write boundaries', () => {
  const unmappedInput: any = { ...input, company: undefined };

  it.each([undefined, 'Unverified company text'])('keeps new-hire drafts incomplete but rejects submission without a directory or legacy code: %s', async companyText => {
    const f = setup(null);
    const empty = { ...input, company: undefined, contractSubjectId: undefined, employee: { companyText } };
    const draft: any = await f.archives.saveEmployeeCreateDraft(empty, operator);
    expect(draft.recordStatus).toBe('draft');
    await expect(f.archives.createEmployee({ ...empty, draftId: draft.id, expectedVersion: draft.requestVersion }, operator))
      .rejects.toThrow('请选择所属公司');
    expect(f.numbers.reserveNext).not.toHaveBeenCalled();
    expect(f.request().recordStatus).toBe('draft');
  });

  it.each([undefined, 'Unverified company text'])('rejects a new reentry without a directory or legacy code before creating the request: %s', async companyText => {
    const f = setup(null);
    await expect(f.onboarding.createReentry('user', { ...input, company: undefined,
      contractSubjectId: undefined, companyText }, operator.id)).rejects.toThrow('请选择所属公司');
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(f.numbers.reserveNext).not.toHaveBeenCalled();
  });

  it('rejects clearing the selected company on an unreviewed reentry revision', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    await expect(f.onboarding.reviseReentry(result.id, { ...unmappedInput, contractSubjectId: null, company: null }, operator.id))
      .rejects.toThrow('请选择所属公司');
    expect(f.request().requestVersion).toBe(1);
  });

  it('retains a reviewed legacy company text when an existing reentry changes only its date', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    Object.assign(f.request().proposedValue.employee, { contractSubjectId: null, company: null, companyText: 'Reviewed historical company' });
    f.tx.employmentRecord.findUnique.mockResolvedValue({ id: 'reviewed', contractSubjectId: null, company: null,
      companyText: 'Reviewed historical company' });
    const revised = await f.onboarding.reviseReentry(result.id, { ...unmappedInput, contractSubjectId: null, company: null,
      companyText: 'Reviewed historical company', effectiveDate: new Date('2020-01-02') }, operator.id);
    expect(revised.proposedValue.employee).toMatchObject({ company: null, companyText: 'Reviewed historical company' });
  });

  it('submits an unmapped new-hire draft and keeps its name snapshot after rename', async () => {
    const f = setup(null);
    const draft: any = await f.archives.saveEmployeeCreateDraft(unmappedInput, operator);
    f.subject.name = 'Renamed subject';
    const submitted: any = await f.archives.createEmployee({ ...unmappedInput, draftId: draft.id, expectedVersion: 1 }, operator);
    expect(submitted.proposedValue.employee).toMatchObject({ company: null, companyText: 'Synthetic subject', contractSubjectId: subjectId });
    expect(submitted.recordStatus).toBe('submitted');
  });

  it('creates a new hire without a legacy code, even if the directory retains a mapping', async () => {
    const f = setup();
    const result: any = await f.archives.createEmployee(unmappedInput, operator);
    expect(result.proposedValue.employee).toMatchObject({ company: null, contractSubjectId: subjectId });
  });

  it('submits and revises unmapped reentry without manufacturing a legacy code', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    expect(result.proposedValue.employee).toMatchObject({ company: null, companyText: 'Synthetic subject' });
    f.subject.internalCompany = CompanyCode.fuede_sports;
    f.subject.name = 'Renamed subject';
    expect((await f.onboarding.reviseReentry(result.id, unmappedInput, operator.id)).proposedValue.employee)
      .toMatchObject({ company: null, companyText: 'Synthetic subject' });
  });

  it('preserves unlinked legacy company text and code when an old reentry is revised without company fields', async () => {
    const f = setup(null);
    const legacyInput = { ...input, contractSubjectId: undefined, company: CompanyCode.fansibao, companyText: 'Historical company' };
    const result = await f.onboarding.createReentry('user', legacyInput, operator.id);
    const revised = await f.onboarding.reviseReentry(result.id,
      { ...legacyInput, company: undefined, companyText: undefined }, operator.id);
    expect(revised.proposedValue.employee).toMatchObject({ company: 'fansibao', companyText: 'Historical company' });
  });

  it('keeps intake draft incomplete without inferring a company', async () => {
    const f = setup(null);
    await f.onboarding.createOnboardingIntake({ ...unmappedInput, sourceSystem: 'synthetic', sourceReference: 'test',
      intakeType: 'new_hire', identitySnapshot: { name: 'Synthetic' } }, operator.id);
    expect(f.request()).toMatchObject({ recordStatus: 'draft', proposedValue: { employee: { company: null } } });
  });

  it('submits direct employment changes to an unmapped active company', async () => {
    const f = setup(null);
    f.user.status = 'active';
    const result: any = await f.archives.createEmploymentRecord('user', { ...unmappedInput, changeType: 'transfer' }, operator);
    expect(result.proposedValue.employee).toMatchObject({ company: null, companyText: 'Synthetic subject' });
  });

  it('applies unmapped reentry without changing the submitted snapshot after rename', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    f.subject.name = 'Renamed subject';
    await expect(f.onboarding.applyApprovedReentry(f.tx, result.id, operator.id)).resolves.toBe('pending_entry');
    expect(f.tx.employmentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ company: null,
      companyText: 'Synthetic subject', contractSubjectId: subjectId }) });
  });

  it('applies a new hire with no legacy code without defaulting to fuede', async () => {
    const f = setup(null);
    await f.archives.createEmployee(unmappedInput, operator);
    await expect((f.reviews as any).applyProfile(f.tx, f.request(), operator)).resolves.toBe('created-user');
    expect(f.tx.employmentRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ company: null,
      companyText: 'Synthetic subject', contractSubjectId: subjectId }) });
  });

  it('rejects a newly selected company deactivated before approval', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    f.subject.isActive = false;
    await expect(f.onboarding.applyApprovedReentry(f.tx, result.id, operator.id)).rejects.toThrow('已停用');
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });

  it('preserves already reviewed new-hire employment on arrival date revision after deactivation', async () => {
    const f = setup(null);
    await f.archives.createEmployee(unmappedInput, operator);
    const request = f.request();
    request.userId = 'user';
    f.user.status = 'pending_entry';
    f.subject.isActive = false;
    f.tx.employmentRecord.findUnique.mockResolvedValue({ id: 'employment', userId: 'user',
      contractSubjectId: subjectId, company: null, companyText: 'Original subject' });
    await expect((f.reviews as any).applyProfile(f.tx, request, operator)).resolves.toBe('user');
    expect(f.tx.employmentRecord.update).toHaveBeenCalledWith({ where: { id: 'employment' }, data: {
      effectiveFrom: new Date('2020-01-01'), effectiveTo: null, entryDate: new Date('2020-01-01'),
    } });
  });

  it('preserves reviewed reentry company on date-only approval after deactivation', async () => {
    const f = setup(null);
    const result = await f.onboarding.createReentry('user', unmappedInput, operator.id);
    f.subject.isActive = false;
    f.tx.employmentRecord.findUnique.mockResolvedValue({ id: 'employment', userId: 'user',
      contractSubjectId: subjectId, company: 'fansibao', companyText: 'Original subject' });
    await expect(f.onboarding.applyApprovedReentry(f.tx, result.id, operator.id)).resolves.toBe('pending_entry');
    expect(f.tx.employmentRecord.update).toHaveBeenCalledWith({ where: { id: 'employment' },
      data: expect.objectContaining({ company: 'fansibao', companyText: 'Original subject' }) });
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });
});

describe('optional legacy company HTTP contract', () => {
  it.each([CreateEmployeeDto, CreateEmployeeReentryDto, ReviseEmployeeReentryDto, CreateEmploymentRecordDto])
    ('accepts missing historical company but rejects invalid supplied codes in %p', async metatype => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const value: any = { ...input, changeType: 'transfer' };
      delete value.company;
      await expect(pipe.transform(value, { type: 'body', metatype })).resolves.toBeDefined();
      await expect(pipe.transform({ ...value, company: null }, { type: 'body', metatype })).resolves.toBeDefined();
      await expect(pipe.transform({ ...value, company: 'invalid' }, { type: 'body', metatype })).rejects.toThrow();
      delete value.contractSubjectId;
      delete value.employee;
      await expect(pipe.transform(value, { type: 'body', metatype })).resolves.toBeDefined();
    });
});
