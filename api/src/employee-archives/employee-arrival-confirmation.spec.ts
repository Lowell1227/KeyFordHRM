import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { AuthService } from '@/auth/auth.service';
import { approvedEmploymentSourceWhere } from './employment-timeline';

const reviewer = { id: 'reviewer', name: 'Reviewer', sysRole: SysRole.hr_user,
  hrCapabilities: ['employee_archive_review'], deptId: null, canViewAll: false, isAssessorOnly: false };
const editor = { ...reviewer, hrCapabilities: ['employee_archive_edit'] };

function setup(overrides: Record<string, unknown> = {}) {
  const employment = { id: 'e1', sourceRequestId: 'r1', userId: 'u1', employeeNo: '358',
    effectiveFrom: new Date('2026-11-10'), entryDate: new Date('2026-11-10'), effectiveTo: null,
    employeeStatus: 'active', employmentType: 'full_time', deptId: 'd1', positionId: null };
  const request: any = { id: 'r1', userId: 'u1', employeeName: 'Synthetic', employeeNo: '358',
    intakeType: 'new_hire', sourceType: 'manual_employee_create', onboardingStatus: 'pending_entry',
    recordStatus: 'submitted', profileReviewStatus: 'approved', performanceReviewStatus: 'not_required',
    requiresArrivalConfirmation: true, arrivalConfirmedAt: null, arrivalConfirmedById: null, arrivalDate: null,
    cancelledAt: null, archivedAt: null, appliedAt: null, requestVersion: 2, createdById: 'author',
    talentCandidateId: null, proposedValue: { employee: { effectiveFrom: '2026-11-10', entryDate: '2026-11-10' } },
    baseValue: { employee: { status: 'resigned', employeeNo: '126' } }, validationWarnings: [],
    employmentRecords: [employment], employeeNumbers: [{ id: 'n1', status: 'reserved', employeeNo: '358', userId: 'u1' }],
    ...overrides };
  const user = { id: 'u1', status: 'pending_entry', accountType: 'employee', deletedAt: null };
  const candidate: any = { id: 't1', name: 'Source', deletedAt: null, status: 'new', convertedUserId: null };
  function update({ data }: any) {
    const version = request.requestVersion;
    Object.assign(request, data);
    if (data.requestVersion?.increment) request.requestVersion = version + data.requestVersion.increment;
    return { ...request };
  }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'r1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    employeeDataChangeRequest: { findUnique: jest.fn(async () => ({ ...request })),
      findUniqueOrThrow: jest.fn(async () => ({ ...request })),
      findFirst: jest.fn(async () => ({ id: request.id })),
      update: jest.fn(update), updateMany: jest.fn(async (args) => { update(args); return { count: 1 }; }) },
    employmentRecord: { findUnique: jest.fn(async () => employment), deleteMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []) },
    employeeNumberAssignment: { update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(async () => request.employeeNumbers[0]) },
    user: { findUnique: jest.fn(async () => user), update: jest.fn(async ({ data }) => Object.assign(user, data)),
      updateMany: jest.fn(async ({ data }) => { Object.assign(user, data); return { count: 1 }; }) },
    talentCandidate: { findUnique: jest.fn(async () => candidate),
      updateMany: jest.fn(async ({ where, data }) => { if (candidate.deletedAt && where.deletedAt === null) return { count: 0 }; Object.assign(candidate, data); return { count: 1 }; }) },
    externalIdentityBinding: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const db: any = { ...tx, $transaction: jest.fn(async run => run(tx)) };
  const effective = new EmployeeEffectiveDateService(db);
  const numbers: any = { releaseReservation: jest.fn() };
  const service = new EmployeeOnboardingService(db, numbers, {} as any, effective);
  return { service, effective, tx, db, request, user, employment, candidate, numbers };
}

describe('explicit arrival confirmation', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-12T03:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it.each(['new_hire', 'reentry'])('does not activate an overdue %s from the activation path', async intakeType => {
    const { effective, tx } = setup({ intakeType });
    await expect(effective.activateApprovedOnboarding(tx, 'r1', new Date())).resolves.toEqual({ activated: false, historicalOnly: false });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeNumberAssignment.update).not.toHaveBeenCalled();
  });

  it('reviewing overdue reentry keeps the employee pending until arrival', async () => {
    const { service, tx, request, user } = setup({ intakeType: 'reentry', onboardingStatus: 'submitted',
      proposedValue: { employee: { effectiveDate: '2026-11-10', employeeStatus: 'active', employmentType: 'full_time' } } });
    tx.employmentRecord.update = jest.fn();
    const result = await service.applyApprovedReentry(tx, 'r1', reviewer.id);
    expect(result).toBe('pending_entry');
    expect(request.onboardingStatus).toBe('pending_entry');
    expect(user.status).toBe('pending_entry');
  });

  it('does not turn a missed arrival into completed history when its end date passes', async () => {
    const { service, tx, user } = setup({ intakeType: 'reentry', onboardingStatus: 'submitted',
      proposedValue: { employee: { effectiveDate: '2026-11-01', effectiveTo: '2026-11-10', employeeStatus: 'active', employmentType: 'full_time' } } });
    tx.employmentRecord.update = jest.fn();
    await expect(service.applyApprovedReentry(tx, 'r1', reviewer.id)).resolves.toBe('pending_entry');
    expect(user.status).toBe('pending_entry');
  });

  it('reviewing a new hire creates a non-login projection even when the date has passed', async () => {
    const { tx } = setup();
    tx.user.create = jest.fn(async () => ({ id: 'u1' }));
    tx.employmentRecord.create = jest.fn();
    tx.employeeContract = { findMany: jest.fn(async () => []) };
    const service = new EmployeeDataReviewsService({} as any);
    await (service as any).applyProfile(tx, { id: 'r1', userId: null, employeeNo: '358', sourceType: 'manual_employee_create',
      intakeType: 'new_hire', requiresArrivalConfirmation: true, sourceBatchId: null, baseValue: {}, proposedValue: {
        employee: { name: 'Synthetic', employeeNo: '358', deptId: 'd1', company: 'fuede', entryDate: '2026-11-10',
          effectiveFrom: '2026-11-10', employeeStatus: 'active', employmentType: 'full_time' },
      } }, reviewer);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending_entry' }) }));
  });

  it('does not let ordinary approved employment changes activate a pending employee', async () => {
    const { tx } = setup();
    const service = new EmployeeDataReviewsService({} as any);
    await expect((service as any).applyProfile(tx, { id: 'r2', userId: 'u1', employeeNo: '358', sourceType: 'manual_employment_change',
      intakeType: null, baseValue: {}, proposedValue: { employee: { name: 'Synthetic', employeeNo: '358', deptId: 'd1',
        company: 'fuede', entryDate: '2026-11-10', effectiveFrom: '2026-11-10', employeeStatus: 'active', employmentType: 'full_time' } } }, reviewer)).rejects.toThrow();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('keeps login/read refresh from applying an unconfirmed request', async () => {
    const { effective, tx, user } = setup();
    await effective.refreshUserProjection('u1');
    expect(user.status).toBe('pending_entry');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('gates the shared employment selector, including the null-onboarding legacy branch', () => {
    const branches = approvedEmploymentSourceWhere.OR as any[];
    for (const branch of branches.filter(item => item.sourceRequest)) {
      expect(branch.sourceRequest).toEqual(expect.objectContaining({ OR: [
        { requiresArrivalConfirmation: false },
        { arrivalConfirmedAt: { not: null }, onboardingStatus: 'effective' },
      ] }));
    }
  });

  it('login checks the arrival-gated employment query even with a stale active user cache', async () => {
    const db: any = { employmentRecord: { findFirst: jest.fn(async ({ where }) => {
      for (const branch of where.AND[0].OR.filter((item: any) => item.sourceRequest)) {
        expect(branch.sourceRequest.OR).toContainEqual({ requiresArrivalConfirmation: false });
        expect(branch.sourceRequest.OR).toContainEqual({ arrivalConfirmedAt: { not: null }, onboardingStatus: 'effective' });
      }
      return null;
    }) } };
    const auth = new AuthService(db, {} as any, {} as any, {} as any, {} as any);
    await expect(auth.assertLoginEligibility({ id: 'u1', accountType: 'employee', status: 'active', archivedAt: null,
      deletedAt: null } as any)).rejects.toMatchObject({ status: 401 });
    expect(db.employmentRecord.findFirst).toHaveBeenCalledTimes(1);
  });

  it('scheduler excludes unconfirmed employment from its projection query', async () => {
    const { effective, db, tx } = setup();
    db.employeeDataChangeRequest.findMany = jest.fn(async () => [{ userId: 'u1' }]);
    db.user.findMany = jest.fn(async () => [{ id: 'u1', status: 'active' }]);
    db.position = { findMany: jest.fn(async () => []) };
    await effective.refreshEffectiveProjections();
    expect(tx.employmentRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: approvedEmploymentSourceWhere }));
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('does not activate when a concurrent cancellation wins the version claim', async () => {
    const { service, tx } = setup();
    tx.employeeDataChangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40001', message: 'could not serialize access due to concurrent update' } },
    { code: 'P2010', meta: { code: '40P01', message: 'deadlock detected' } },
  ])('maps a serialization race to a refreshable business conflict (%j)', async error => {
    const { service, db } = setup();
    db.$transaction.mockRejectedValue(error);
    await expect(service.confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not conceal unrelated database failures as retryable conflicts', async () => {
    const { service, db } = setup();
    const error = { code: 'P2010', meta: { code: '42P01' } };
    db.$transaction.mockRejectedValue(error);
    await expect(service.confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer)).rejects.toBe(error);
  });

  it('retains legacy activation without inventing arrival evidence', async () => {
    const { effective, tx, request } = setup({ requiresArrivalConfirmation: false });
    await expect(effective.activateApprovedOnboarding(tx, 'r1', new Date())).resolves.toMatchObject({ activated: true });
    expect(request.arrivalConfirmedAt).toBeNull();
    expect(request.arrivalConfirmedById).toBeNull();
  });

  it('confirms once, activates, converts the source and audits the actual reviewer', async () => {
    const { service, request, user, candidate, tx } = setup({ talentCandidateId: 't1' });
    const input = { arrivalDate: '2026-11-10', requestVersion: 2 };
    const first = await (service as any).confirmArrival('r1', input, reviewer);
    const repeat = await (service as any).confirmArrival('r1', input, reviewer);
    expect(first).toMatchObject({ arrivalDate: new Date('2026-11-10'), arrivalConfirmedById: reviewer.id,
      requestVersion: 3, onboardingStatus: 'effective', talentCandidateId: 't1' });
    expect(repeat).toEqual(first);
    expect(request.arrivalConfirmedAt).toEqual(new Date());
    expect(user.status).toBe('active');
    expect(candidate).toMatchObject({ status: 'hired', convertedUserId: 'u1' });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.employeeDataChangeRequest.updateMany.mock.invocationCallOrder[0]);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'confirm_employee_arrival', userId: reviewer.id, entityId: 'r1',
    }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'activate_employee_onboarding', userId: reviewer.id,
    }) }));
  });

  it('requires review capability even when called outside the controller', async () => {
    const { service, tx } = setup();
    await expect((service as any).confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, editor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ arrivalDate: '2026-11-13', requestVersion: 2 }, {}],
    [{ arrivalDate: '2026-11-11', requestVersion: 2 }, {}],
    [{ arrivalDate: '2026-02-30', requestVersion: 2 }, {}],
    [{ arrivalDate: '2026-11-10', requestVersion: 1 }, {}],
    [{ arrivalDate: '2026-11-10', requestVersion: 2 }, { onboardingStatus: 'cancelled', cancelledAt: new Date() }],
    [{ arrivalDate: '2026-11-10', requestVersion: 2 }, { profileReviewStatus: 'pending' }],
    [{ arrivalDate: '2026-11-10', requestVersion: 2 }, { userId: null }],
    [{ arrivalDate: '2026-11-10', requestVersion: 2 }, { requiresArrivalConfirmation: false }],
  ])('rejects invalid date, version or state without activation (%j)', async (input, state) => {
    const { service, tx } = setup(state);
    await expect((service as any).confirmArrival('r1', input, reviewer)).rejects.toThrow();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('does not resurrect a deleted source while allowing the existing application to finish', async () => {
    const { service, candidate } = setup({ talentCandidateId: 't1' });
    candidate.deletedAt = new Date('2026-11-11');
    await (service as any).confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer);
    expect(candidate).toMatchObject({ status: 'new', convertedUserId: null, deletedAt: new Date('2026-11-11') });
  });

  it('allows overdue unconfirmed cancellation and prevents later confirmation', async () => {
    const { service, tx, numbers } = setup({ talentCandidateId: 't1' });
    await service.cancelReentry('r1', { reason: 'No show' }, editor.id);
    expect(tx.employmentRecord.deleteMany).toHaveBeenCalledWith({ where: { sourceRequestId: 'r1' } });
    expect(numbers.releaseReservation).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.employmentRecord.deleteMany.mock.invocationCallOrder[0]);
    await expect((service as any).confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer)).rejects.toThrow();
  });

  it('does not cancel after confirmation wins', async () => {
    const { service, numbers } = setup();
    await (service as any).confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: 2 }, reviewer);
    await expect(service.cancelReentry('r1', { reason: 'No show' }, editor.id)).rejects.toBeInstanceOf(ConflictException);
    expect(numbers.releaseReservation).not.toHaveBeenCalled();
  });

  it.each(['new_hire', 'reentry'])('revises an overdue %s date, retaining source and reservation for re-review', async intakeType => {
    const { service, request, tx } = setup({ intakeType, talentCandidateId: 't1' });
    const result = await (service as any).reviseArrivalDate('r1', { arrivalDate: '2026-11-11', requestVersion: 2 }, editor);
    expect(result).toMatchObject({ profileReviewStatus: 'pending', onboardingStatus: 'submitted',
      requestVersion: 3, talentCandidateId: 't1', userId: 'u1', employeeNo: '358' });
    expect(request.proposedValue.employee[intakeType === 'new_hire' ? 'effectiveFrom' : 'effectiveDate']).toBe('2026-11-11');
    expect(tx.employmentRecord.deleteMany).not.toHaveBeenCalled();
    expect(tx.employeeNumberAssignment.update).not.toHaveBeenCalled();
    await expect((service as any).confirmArrival('r1', { arrivalDate: '2026-11-11', requestVersion: 3 }, reviewer)).rejects.toThrow();
  });

  it('approves corrected new-hire dates without creating another employee or employment', async () => {
    const { tx, request, employment } = setup();
    request.proposedValue.employee = { name: 'Synthetic', employeeNo: '358', company: 'fuede', deptId: 'd1',
      entryDate: '2026-11-11', effectiveFrom: '2026-11-11', employeeStatus: 'active', employmentType: 'full_time' };
    tx.employmentRecord.update = jest.fn(async ({ data }) => Object.assign(employment, data));
    tx.user.create = jest.fn();
    const reviews = new EmployeeDataReviewsService({} as any);
    await (reviews as any).applyProfile(tx, request, reviewer);
    expect(employment.effectiveFrom).toEqual(new Date('2026-11-11'));
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.talentCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('locks a linked candidate before changing a pending performance manager', async () => {
    const { db, tx, request } = setup({ talentCandidateId: 't1', performanceReviewStatus: 'pending',
      updatedAt: new Date('2026-11-12T00:00:00Z') });
    const reviews = new EmployeeDataReviewsService(db);
    await reviews.setPendingPerformanceManager('r1', 'manager', reviewer);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.employeeDataChangeRequest.update.mock.invocationCallOrder[0]);
    expect(request.requestVersion).toBe(3);
    expect(request.revisionHistory).toEqual([expect.objectContaining({ version: 2, revisedById: reviewer.id })]);
  });
});
