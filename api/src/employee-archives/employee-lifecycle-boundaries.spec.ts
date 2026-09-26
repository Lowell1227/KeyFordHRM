import { SysRole } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { selectEmploymentAt } from './employment-timeline';

const operator = { id: 'hr1', sysRole: SysRole.hr } as any;
const resignationRequest = () => ({
  id: 'r1', userId: 'u1', employeeNo: '123', sourceType: 'manual_employment_change', recordStatus: 'submitted',
  profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', validationErrors: [], baseValue: {},
  proposedValue: { employee: { name: '员工', employeeNo: '123', company: 'fuede', deptId: 'd1',
    entryDate: '2020-01-01', leaveDate: '2026-10-08', effectiveFrom: '2026-10-08',
    employeeStatus: 'resigned', employmentType: 'full_time', changeType: 'resignation' } },
});

function reviewFixture(request: any) {
  let persisted: any = { user: { status: 'active', directManagerId: null }, request, employments: [], disabled: false };
  const prisma = { $transaction: async (callback: any) => {
    const local = structuredClone(persisted);
    const tx = {
      employeeDataChangeRequest: {
        findUnique: async () => local.request,
        updateMany: async ({ data }: any) => { Object.assign(local.request, data); return { count: 1 }; },
        update: async ({ data }: any) => Object.assign(local.request, data),
      },
      user: { update: async ({ data }: any) => Object.assign(local.user, data), findUnique: async ({ where }: any) => where.id === 'u1' ? local.user : null },
      employmentRecord: { findFirst: async () => null, create: async ({ data }: any) => local.employments.push(data) },
      employeeProfile: { upsert: async () => ({}) },
      externalIdentityBinding: { updateMany: async () => { local.disabled = true; return { count: 1 }; } },
      auditLog: { create: async () => ({}) },
    };
    const result = await callback(tx);
    persisted = local;
    return result;
  } };
  return { service: new EmployeeDataReviewsService(prisma as any), state: () => persisted };
}

describe('employee lifecycle business boundaries', () => {
  afterEach(() => jest.useRealTimers());

  it('chooses the later approved record for the same effective day, not random UUID order', () => {
    const effectiveFrom = new Date('2026-03-21');
    const records = [
      { id: 'z-old-resignation', effectiveFrom, effectiveTo: null, createdAt: new Date('2026-03-20T10:00:00Z') },
      { id: 'a-new-reentry', effectiveFrom, effectiveTo: null, createdAt: new Date('2026-03-21T00:00:00Z') },
    ];
    expect(selectEmploymentAt(records, effectiveFrom).current?.id).toBe('a-new-reentry');
  });

  it('rejects a legacy ordinary change that would reactivate a resigned employee using the old number', async () => {
    const request = resignationRequest();
    request.proposedValue.employee.employeeStatus = 'active';
    request.proposedValue.employee.effectiveFrom = '2020-01-01';
    const fixture = reviewFixture(request);
    fixture.state().user.status = 'resigned';
    const result = await fixture.service.approveBatch({ requestIds: ['r1'], scopes: ['profile'] }, operator);
    expect(result.failed[0]?.reason).toContain('再入职');
    expect(fixture.state().user.status).toBe('resigned');
  });

  it.each(['2026-10-07T16:00:00Z', '2026-10-08T15:59:59Z'])('keeps access through the entire last working day at %s', async (now) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const fixture = reviewFixture(resignationRequest());
    const result = await fixture.service.approveBatch({ requestIds: ['r1'], scopes: ['profile'] }, operator);
    expect(result.failed).toEqual([]);
    expect(fixture.state().user.status).toBe('active');
    expect(fixture.state().disabled).toBe(false);
    expect(fixture.state().employments[0].effectiveFrom).toEqual(new Date('2026-10-09'));
    expect(fixture.state().request.appliedAt).toBeNull();
  });

  it('a late resignation approval disables access at approval while retaining the last working date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T16:00:00Z'));
    const fixture = reviewFixture(resignationRequest());
    const result = await fixture.service.approveBatch({ requestIds: ['r1'], scopes: ['profile'] }, operator);
    expect(result.failed).toEqual([]);
    expect(fixture.state().user.status).toBe('resigned');
    expect(fixture.state().user.leaveDate).toEqual(new Date('2026-10-08'));
    expect(fixture.state().disabled).toBe(true);
  });

  it('rolls back this click profile approval if the same request performance approval fails', async () => {
    const request = resignationRequest();
    request.proposedValue.employee.employeeStatus = 'active';
    request.proposedValue.employee.effectiveFrom = '2020-01-01';
    request.performanceReviewStatus = 'pending';
    (request.proposedValue as any).performance = { managerId: 'missing-manager' };
    const fixture = reviewFixture(request);
    const result = await fixture.service.approveBatch({ requestIds: ['r1'], scopes: ['profile', 'performance'] }, operator);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(fixture.state().request.profileReviewStatus).toBe('pending');
    expect(fixture.state().employments).toHaveLength(0);
  });

  it('revision removes the previously approved scheduled employment before returning it to review', async () => {
    const state: any = { user: { status: 'pending_entry', employeeNo: '358', archivedAt: null, name: 'later-corrected' }, records: [{ id: 'e1', sourceRequestId: 'r1', effectiveFrom: new Date('2099-10-01') }] };
    const request: any = { id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'reentry', onboardingStatus: 'pending_entry', requestVersion: 1,
      profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', baseValue: { employee: { status: 'resigned', employeeNo: '123', archivedAt: '2026-01-01' } } };
    const tx: any = {
      employeeDataChangeRequest: { findUnique: async () => request, update: async ({ data }: any) => Object.assign(request, data) },
      employmentRecord: { findUnique: async () => state.records[0], deleteMany: async () => { state.records = []; return { count: 1 }; } },
      user: { findUnique: async () => state.user, update: async ({ data }: any) => Object.assign(state.user, data), updateMany: async ({ data }: any) => { Object.assign(state.user, data); return { count: 1 }; } },
      auditLog: { create: async () => ({}) },
    };
    const service = new EmployeeOnboardingService({ $transaction: async (callback: any) => callback(tx) } as any, {} as any, {} as any, {} as any);
    await service.reviseReentry('r1', { company: 'fuede', effectiveDate: new Date('2099-11-01'), employeeStatus: 'active', employmentType: 'full_time' } as any, 'hr1');
    expect(state.records).toHaveLength(0);
    expect(state.user.status).toBe('resigned');
    expect(state.user.name).toBe('later-corrected');
    expect(request.onboardingStatus).toBe('submitted');
  });

  it('canceling pending onboarding only restores the projection owned by that application', async () => {
    const state: any = { user: { status: 'pending_entry', employeeNo: '358', archivedAt: null, name: 'later-approved-name', deptId: 'later-approved-dept' }, records: [{ effectiveFrom: new Date('2099-10-01') }], released: false };
    const request: any = { id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'new_hire', onboardingStatus: 'pending_entry',
      baseValue: {}, proposedValue: {}, requestVersion: 1 };
    const tx: any = {
      employeeDataChangeRequest: { findUnique: async () => request, update: async ({ data }: any) => Object.assign(request, data) },
      employmentRecord: { findUnique: async () => state.records[0], deleteMany: async () => { state.records = []; return { count: 1 }; } },
      user: { updateMany: async ({ data }: any) => { Object.assign(state.user, data); return { count: 1 }; } }, auditLog: { create: async () => ({}) },
    };
    const service = new EmployeeOnboardingService({ $transaction: async (callback: any) => callback(tx) } as any,
      { releaseReservation: async () => { state.released = true; } } as any, {} as any, {} as any);
    await service.cancelReentry('r1', { reason: '取消本次入职' }, 'hr1');
    expect(state.user.status).toBe('resigned');
    expect(state.user.name).toBe('later-approved-name');
    expect(state.user.deptId).toBe('later-approved-dept');
    expect(state.records).toEqual([]);
    expect(state.released).toBe(true);
    expect(request.onboardingStatus).toBe('cancelled');
  });

  it('historical reentry with an unreviewed manager never opens the current account', async () => {
    const request: any = { id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'reentry', onboardingStatus: 'submitted',
      profileReviewStatus: 'approved', performanceReviewStatus: 'pending', proposedValue: {
        employee: { company: 'fuede', effectiveDate: '2020-01-01', effectiveTo: '2020-12-31', employeeStatus: 'active', employmentType: 'full_time' },
        performance: { managerId: 'never-approved' },
      } };
    const numbers: any = { status: 'reserved' };
    const userUpdate = jest.fn();
    const tx: any = {
      employeeDataChangeRequest: { findUnique: async () => request, update: async ({ data }: any) => Object.assign(request, data) },
      employmentRecord: { findUnique: async () => null, create: async () => ({}) },
      employeeNumberAssignment: { findFirst: async () => numbers, updateMany: async ({ data }: any) => Object.assign(numbers, data) },
      user: { update: userUpdate },
    };
    const service = new EmployeeOnboardingService({} as any, {} as any, {} as any, {} as any);
    expect(await service.applyApprovedReentry(tx, 'r1', 'hr1', new Date('2026-09-26'))).toBe('historical');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(numbers.status).toBe('historical');
  });

  it('resubmits only rejected performance after the base reentry already took effect', async () => {
    const request: any = { id: 'r1', userId: 'u1', employeeNo: '358', intakeType: 'reentry', onboardingStatus: 'effective', recordStatus: 'submitted',
      profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', profileReviewedById: 'hr-before', requestVersion: 1,
      proposedValue: { employee: { company: 'fuede', effectiveDate: '2026-09-01', employeeStatus: 'active', employmentType: 'full_time' }, performance: { managerId: 'manager-old' } } };
    const tx: any = { employeeDataChangeRequest: { findUnique: async () => request, update: async ({ data }: any) => Object.assign(request, data) },
      user: { findUnique: async () => ({ id: 'manager-new' }) }, auditLog: { create: async () => ({}) } };
    const service = new EmployeeOnboardingService({ $transaction: async (callback: any) => callback(tx) } as any, {} as any, {} as any, {} as any);
    await service.reviseReentry('r1', { company: 'fuede', effectiveDate: new Date('2026-09-01'), employeeStatus: 'active', employmentType: 'full_time', performanceManagerId: 'manager-new' } as any, 'hr1');
    expect(request.profileReviewStatus).toBe('approved');
    expect(request.profileReviewedById).toBe('hr-before');
    expect(request.performanceReviewStatus).toBe('pending');
    expect(request.onboardingStatus).toBe('effective');
  });
});
