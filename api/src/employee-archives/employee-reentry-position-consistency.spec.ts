import { ValidationPipe } from '@nestjs/common';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { CreateEmployeeReentryDto, ReviseEmployeeReentryDto } from './dto/employee-onboarding.dto';

const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const emptyId = '33333333-3333-4333-8333-333333333333';
const managerId = '44444444-4444-4444-8444-444444444444';
const input = {
  company: CompanyCode.fuede, effectiveDate: new Date('2099-01-01'),
  employeeStatus: UserStatus.active, employmentType: EmploymentType.full_time,
};

// Exercise the real service with isolated persistence doubles, never a live employee database.
function setup(history: Record<string, unknown> = {
  positionId: oldId, position: 'Historical title', jobFamily: 'Historical family',
}) {
  let request: any = null;
  let employment: any = null;
  const positions = new Map([
    [oldId, { id: oldId, name: 'Current old title', jobFamily: 'Current old family', isActive: true }],
    [newId, { id: newId, name: 'New title', jobFamily: 'New family', isActive: true }],
    [emptyId, { id: emptyId, name: 'No family title', jobFamily: null, isActive: true }],
  ]);
  const user = { id: 'user', name: 'Synthetic reentry', status: 'resigned', archivedAt: null,
    employeeNo: '001', directManagerId: null, employmentHistory: [history] };
  const tx: any = {
    user: { findUnique: jest.fn(async () => user), update: jest.fn(), updateMany: jest.fn() },
    position: { findUnique: jest.fn(async ({ where }) => positions.get(where.id) ?? null) },
    department: { findUnique: jest.fn(async () => ({ isActive: true })) },
    employmentRecord: {
      findFirst: jest.fn(async ({ where }) => where.effectiveFrom ? null : history),
      findUnique: jest.fn(async () => employment),
      create: jest.fn(async ({ data }) => (employment = { id: 'employment', ...data })),
      update: jest.fn(async ({ data }) => (employment = { ...employment, ...data })),
      deleteMany: jest.fn(async () => { employment = null; return { count: 1 }; }),
    },
    employeeDataChangeRequest: {
      findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => request),
      create: jest.fn(async ({ data }) => (request = { id: 'request', requestVersion: 1,
        revisionHistory: [], rejectedReason: null, ...data })),
      update: jest.fn(async ({ data }) => (request = { ...request, ...data,
        requestVersion: data.requestVersion?.increment ? request.requestVersion + 1 : request.requestVersion })),
    },
    employeeNumberAssignment: { findFirst: jest.fn(async () => ({ id: 'reservation' })), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const numbers = { reserveNext: jest.fn(async () => '002') };
  const effectiveDates = { activateApprovedOnboarding: jest.fn() };
  const service = new EmployeeOnboardingService({ ...tx, $transaction: (run: any) => run(tx) } as any,
    numbers as any, {} as any, effectiveDates as any);
  return { service, tx, positions, numbers, request: () => request, employment: () => employment,
    create: (fields: Record<string, unknown> = {}) => service.createReentry('user', { ...input, ...fields }, 'hr'),
    revise: (fields: Record<string, unknown> = {}) => service.reviseReentry('request', { ...input, ...fields }, 'hr'),
    approve: () => service.applyApprovedReentry(tx, 'request', 'hr'),
  };
}

describe('reentry position and job-family persistence', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it.each(['A'.repeat(100), null])('keeps valid optional jobFamily in the HTTP DTO: %s', async jobFamily => {
    const parsed = await pipe.transform({ ...input, jobFamily }, { type: 'body', metatype: CreateEmployeeReentryDto });
    expect(parsed.jobFamily).toBe(jobFamily);
  });

  it.each(['A'.repeat(101), 17])('rejects invalid jobFamily: %s', async jobFamily => {
    await expect(pipe.transform({ ...input, jobFamily }, { type: 'body', metatype: CreateEmployeeReentryDto }))
      .rejects.toThrow();
  });

  it('does not manufacture jobFamily in a performance-only DTO', async () => {
    const parsed = await pipe.transform({ performanceOnly: true, performanceManagerId: managerId },
      { type: 'body', metatype: ReviseEmployeeReentryDto });
    expect(parsed.jobFamily).toBeUndefined();
  });

  it('takes a new selection from the directory through proposal and employment creation', async () => {
    const f = setup();
    await f.create({ positionId: newId, position: 'Forged title', jobFamily: 'Forged family' });
    expect(f.request().proposedValue.employee).toMatchObject({ positionId: newId, position: 'New title', jobFamily: 'New family' });
    await f.approve();
    expect(f.employment()).toMatchObject({ positionId: newId, position: 'New title', jobFamily: 'New family' });
  });

  it.each([{}, { position: 'Historical title', jobFamily: 'Historical family' }])
  ('preserves untouched same-ID history for omitted or echoed fields: %j', async fields => {
    const f = setup();
    await f.create({ positionId: oldId, ...fields });
    expect(f.request().proposedValue.employee).toMatchObject({ position: 'Historical title', jobFamily: 'Historical family' });
    await f.approve();
    expect(f.employment()).toMatchObject({ position: 'Historical title', jobFamily: 'Historical family' });
  });

  it('takes explicit same-ID overrides from the directory without rewriting the untouched field', async () => {
    const f = setup();
    await f.create({ positionId: oldId, position: 'Historical title', jobFamily: 'Attempted override' });
    expect(f.request().proposedValue.employee).toMatchObject({ position: 'Historical title', jobFamily: 'Current old family' });
  });

  it('does not retain caller family when the selected directory family is null', async () => {
    const f = setup();
    await f.create({ positionId: emptyId, jobFamily: 'Forged family' });
    await f.approve();
    expect(f.employment()).toMatchObject({ position: 'No family title', jobFamily: null });
  });

  it.each([{}, { position: 'Free title', jobFamily: 'Free family' }])
  ('preserves no-ID historical free text: %j', async fields => {
    const f = setup({ positionId: null, position: 'Free title', jobFamily: 'Free family' });
    await f.create({ positionId: null, ...fields });
    await f.approve();
    expect(f.employment()).toMatchObject({ positionId: null, position: 'Free title', jobFamily: 'Free family' });
  });

  it('allows explicit no-ID free text and clearing instead of retaining a former directory snapshot', async () => {
    const f = setup();
    await f.create({ positionId: null, position: 'New free title', jobFamily: 'New free family' });
    expect(f.request().proposedValue.employee).toMatchObject({ positionId: null, position: 'New free title', jobFamily: 'New free family' });
    await f.revise({ positionId: null, position: null, jobFamily: null });
    await f.approve();
    expect(f.employment()).toMatchObject({ positionId: null, position: null, jobFamily: null });
  });

  it('clears linked text when clearing the directory ID without replacement text', async () => {
    const f = setup();
    await f.create({ positionId: oldId });
    await f.revise({ positionId: null });
    expect(f.request().proposedValue.employee).toMatchObject({ positionId: null, position: null, jobFamily: null });
  });

  it('preserves saved null family on the same ID after the directory gains a family', async () => {
    const f = setup({ positionId: oldId, position: 'Historical title', jobFamily: null });
    await f.create({ positionId: oldId });
    await f.revise({ positionId: oldId });
    await f.approve();
    expect(f.employment().jobFamily).toBeNull();
  });

  it('keeps proposal snapshots during date-only revision and approval after a directory rename', async () => {
    const f = setup();
    await f.create({ positionId: newId });
    Object.assign(f.positions.get(newId)!, { name: 'Later title', jobFamily: 'Later family' });
    await f.revise({ positionId: newId, effectiveDate: new Date('2099-02-01') });
    expect(f.request().proposedValue.employee).toMatchObject({ position: 'New title', jobFamily: 'New family' });
    await f.approve();
    expect(f.employment()).toMatchObject({ position: 'New title', jobFamily: 'New family' });
  });

  it('normalizes changed positions on revision and keeps parent revision audit snapshots', async () => {
    const f = setup();
    await f.create({ positionId: oldId });
    const baseValue = f.request().baseValue;
    f.request().rejectedReason = 'Synthetic rejection';
    await f.revise({ positionId: newId, position: 'Forged title', jobFamily: 'Forged family' });
    expect(f.request().revisionHistory[0]).toMatchObject({ baseValue, rejectedReason: 'Synthetic rejection',
      proposedValue: { employee: { jobFamily: 'Historical family' } } });
    await f.approve();
    expect(f.employment()).toMatchObject({ positionId: newId, position: 'New title', jobFamily: 'New family' });
  });

  it('includes jobFamily in the update of an existing pending employment', async () => {
    const f = setup();
    await f.create({ positionId: newId });
    await f.approve();
    f.employment().jobFamily = 'Stale projection';
    await f.approve();
    expect(f.tx.employmentRecord.update).toHaveBeenLastCalledWith({ where: { id: 'employment' },
      data: expect.objectContaining({ jobFamily: 'New family' }) });
  });

  it.each([false, true])('rejects disabled positions before approval writes, existing projection=%s', async projected => {
    const f = setup();
    await f.create({ positionId: newId });
    if (projected) await f.approve();
    f.positions.get(newId)!.isActive = false;
    jest.clearAllMocks();
    await expect(f.approve()).rejects.toThrow('岗位不存在或已停用');
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(f.tx.employmentRecord.update).not.toHaveBeenCalled();
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.employeeNumberAssignment.updateMany).not.toHaveBeenCalled();
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it('blocks deleted directory positions at approval', async () => {
    const f = setup();
    await f.create({ positionId: newId });
    f.positions.delete(newId);
    await expect(f.approve()).rejects.toThrow('岗位不存在或已停用');
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });

  it.each([oldId, newId])('hydrates legacy proposals without family using the matching baseline: %s', async positionId => {
    const f = setup();
    await f.create({ positionId });
    delete f.request().proposedValue.employee.jobFamily;
    await f.approve();
    expect(f.employment().jobFamily).toBe(positionId === oldId ? 'Historical family' : 'New family');
  });

  it.each([false, true])('does not misclassify omitted family during performance-only resubmission, explicit=%s', async explicit => {
    const f = setup();
    await f.create({ positionId: newId, position: 'New title' });
    // Seed the persisted snapshot so this regression does not depend on create normalization.
    f.request().proposedValue.employee.jobFamily = 'New family';
    Object.assign(f.request(), { profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', onboardingStatus: 'effective' });
    f.positions.get(newId)!.isActive = false;
    const before = structuredClone(f.request().proposedValue.employee);
    const body = explicit ? { performanceOnly: true, performanceManagerId: managerId }
      : { ...input, positionId: newId, position: 'New title', performanceManagerId: managerId };
    await f.service.reviseReentry('request', body as ReviseEmployeeReentryDto, 'hr');
    expect(f.request().proposedValue.employee).toEqual(before);
    expect(f.request().performanceReviewStatus).toBe('pending');
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
  });

  it('does not accept an explicit family change via the legacy performance resubmission body', async () => {
    const f = setup();
    await f.create({ positionId: newId, position: 'New title' });
    f.request().proposedValue.employee.jobFamily = 'New family';
    Object.assign(f.request(), { profileReviewStatus: 'approved', performanceReviewStatus: 'rejected', onboardingStatus: 'effective' });
    await expect(f.revise({ positionId: newId, position: 'New title', jobFamily: 'Changed', performanceManagerId: managerId }))
      .rejects.toThrow('本次只可重提退回的绩效关系');
  });

  it('normalizes positions on intake drafts as well as direct reentry proposals', async () => {
    const f = setup();
    await f.service.createOnboardingIntake({ ...input, positionId: newId, position: 'Forged title',
      jobFamily: 'Forged family', sourceSystem: 'synthetic', sourceReference: 'position-test', intakeType: 'reentry',
      existingEmployeeId: 'user', identitySnapshot: { name: 'Synthetic reentry' } } as any, 'hr');
    expect(f.request().proposedValue.employee).toMatchObject({ position: 'New title', jobFamily: 'New family' });
  });
});
