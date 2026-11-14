import { BadRequestException } from '@nestjs/common';
import { EmployeeArchivesService } from './employee-archives.service';
import { approvedEmploymentSourceWhere } from './employment-timeline';

const operator = { id: 'hr', sysRole: 'hr' } as any;
const controlled = [
  ['employee', 'jobGrade', 'job_grade'],
  ['profile', 'education', 'education'],
  ['profile', 'maritalStatus', 'marital_status'],
  ['profile', 'politicalStatus', 'political_status'],
  ['profile', 'householdType', 'household_type'],
  ['profile', 'emergencyContactRelation', 'contact_relation'],
] as const;

function fixture(base: { employee?: Record<string, unknown>; profile?: Record<string, unknown> } = {}) {
  const current = { id: 'user', accountType: 'employee', employeeNo: '001', name: 'Synthetic', status: 'active',
    directManagerId: null, updatedAt: new Date('2026-01-01'), entryDate: new Date('2024-01-01'),
    employeeProfile: { ...(base.profile ?? {}) }, employeeContracts: [],
    employmentHistory: [{ id: 'employment', company: 'fuede', effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null as Date | null, ...(base.employee ?? {}) }] };
  const options: { kind: string; name: string; isActive: boolean }[] = [];
  const prisma = {
    $transaction: jest.fn(async callback => callback(prisma)),
    user: { findUnique: jest.fn().mockResolvedValue(current), update: jest.fn(async ({ data }) => Object.assign(current, data)), findMany: jest.fn().mockResolvedValue([]) },
    employeeProfile: { upsert: jest.fn(async ({ create, update }) => Object.assign(current.employeeProfile, update ?? create)) },
    personnelReferenceData: { findMany: jest.fn(async ({ where }) => options.filter(option => option.isActive === where.isActive
      && where.OR.some((query: any) => query.kind === option.kind && query.name === option.name))) },
    department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept', isActive: true }) },
    employmentRecord: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() },
    employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }) => ({ id: 'request', requestVersion: 1, archivedAt: null, updatedAt: new Date(), ...data })) },
  };
  const reviews = { applyArchiveChange: jest.fn(async () => ({ id: 'request',
    ...prisma.employeeDataChangeRequest.create.mock.calls.at(-1)![0].data, profileReviewStatus: 'approved' })) };
  const service = new EmployeeArchivesService(prisma as any, undefined, undefined, undefined, undefined, reviews as any);
  return { service, prisma, current, options, baseVersion: (service as any).archiveVersion(current) };
}

describe('personnel directory validation at formal submission boundaries', () => {
  describe('archive directory baseline follows the displayed employment', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-14T16:30:00Z')));
    afterEach(() => jest.useRealTimers());

    const employment = (id: string, jobGrade: string, from: string, to: string | null = null, sourceRequest?: object) => ({
      id, company: 'fuede', jobGrade, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null,
      sourceRequest: sourceRequest ?? null,
    });
    const prepare = (history: ReturnType<typeof employment>[], status = 'active') => {
      const context = fixture();
      Object.assign(context.current, { employmentHistory: history, status });
      return { ...context, baseVersion: (context.service as any).archiveVersion(context.current) };
    };
    const future = () => employment('future', 'Future', '2027-01-01');
    const current = () => employment('current', 'Historical', '2025-01-01', '2026-12-31');
    const pending = () => employment('pending', 'Pending', '2026-11-01', null,
      { requiresArrivalConfirmation: true, arrivalConfirmedAt: null });

    it('keeps an unchanged current legacy grade when an approved future employment exists', async () => {
      const { service, prisma, baseVersion } = prepare([future(), current()]);
      const result = await service.submitDraft('user', { baseVersion, employee: { jobGrade: 'Historical' },
        profile: { professionalTitle: 'Changed' } }, operator);
      expect(result.request?.proposedValue).toMatchObject({ employee: { jobGrade: 'Historical' } });
      // The fix must not change the existing proposal/CAS baseline or employment application rules.
      expect(result.request?.baseValue).toMatchObject({ employee: { jobGrade: 'Future' } });
      expect(prisma.personnelReferenceData.findMany).not.toHaveBeenCalled();
    });

    it.each(['Unknown', 'Inactive', 'Future'])('still rejects a newly selected %s grade', async jobGrade => {
      const { service, prisma, options, baseVersion } = prepare([future(), current()]);
      options.push({ kind: 'job_grade', name: 'Inactive', isActive: false });
      await expect(service.submitDraft('user', { baseVersion, employee: { jobGrade },
        profile: { professionalTitle: 'Changed' } }, operator)).rejects.toMatchObject({
        response: { data: { fieldErrors: { 'employee.jobGrade': expect.any(String) } } },
      });
      expect(prisma.employeeProfile.upsert).not.toHaveBeenCalled();
      expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'pending arrival first', history: () => [future(), pending(), current()], status: 'pending_entry', grade: 'Pending' },
      { label: 'latest formal fallback without current employment', history: () => [employment('past', 'Historical', '2020-01-01', '2021-01-01')], grade: 'Historical' },
      { label: 'Shanghai next-day employment ending today', history: () => [future(), employment('today', 'Historical', '2026-11-15', '2026-11-15')], grade: 'Historical' },
      { label: 'unconfirmed arrival excluded for active employee', history: () => [future(), pending(), current()], grade: 'Historical' },
    ])('preserves $label', async ({ history, status, grade }) => {
      const { service, prisma, baseVersion } = prepare(history(), status);
      await expect(service.submitDraft('user', { baseVersion, employee: { jobGrade: grade },
        profile: { professionalTitle: 'Changed' } }, operator)).resolves.toMatchObject({ reviewOutcome: 'not_required' });
      expect(prisma.personnelReferenceData.findMany).not.toHaveBeenCalled();
    });

    it('does not exempt an unconfirmed arrival grade for an active employee', async () => {
      const { service, baseVersion } = prepare([pending(), current()]);
      await expect(service.submitDraft('user', { baseVersion, employee: { jobGrade: 'Pending' },
        profile: { professionalTitle: 'Changed' } }, operator)).rejects.toMatchObject({
        response: { data: { fieldErrors: { 'employee.jobGrade': expect.any(String) } } },
      });
    });

    it.each([
      { label: 'unapproved', source: { profileReviewStatus: 'pending' } },
      { label: 'cancelled onboarding', source: { onboardingStatus: 'cancelled' } },
      { label: 'not pending arrival', source: { onboardingStatus: 'submitted' } },
      { label: 'archived pending arrival', source: { archivedAt: new Date('2026-11-01') } },
      { label: 'cancelled pending arrival', source: { cancelledAt: new Date('2026-11-01') } },
      { label: 'non-intake pending arrival', source: { intakeType: null } },
    ])('query excludes $label from legacy grade exemptions', async ({ source }) => {
      const unqualified = { ...pending(), sourceRequestId: 'source', sourceRequest: {
        intakeType: 'reentry', profileReviewStatus: 'approved', requiresArrivalConfirmation: true,
        onboardingStatus: 'pending_entry', archivedAt: null, cancelledAt: null, arrivalConfirmedAt: null, ...source,
      } };
      const history = [unqualified, { ...current(), sourceRequestId: null, sourceRequest: null }];
      const { service, prisma, current: user } = prepare(history, 'pending_entry');
      const matches = (value: any, where: any): boolean => {
        if (where === null || typeof where !== 'object') return value === where;
        return Object.entries(where).every(([key, condition]: [string, any]) => {
          if (key === 'AND') return condition.every((part: any) => matches(value, part));
          if (key === 'OR') return condition.some((part: any) => matches(value, part));
          if (key === 'not') return !matches(value, condition);
          return value != null && matches(value[key], condition);
        });
      };
      prisma.user.findUnique.mockImplementation(async (query: any) => ({ ...user,
        employmentHistory: query.include?.employmentHistory
          ? history.filter(item => matches(item, query.include.employmentHistory.where)) : history,
      }));
      const baseVersion = (service as any).archiveVersion({ ...user, employmentHistory: [history[1]] });
      await expect(service.submitDraft('user', { baseVersion, employee: { jobGrade: 'Pending' },
        profile: { professionalTitle: 'Changed' } }, operator)).rejects.toMatchObject({
        response: { data: { fieldErrors: { 'employee.jobGrade': expect.any(String) } } },
      });
      const query = prisma.user.findUnique.mock.calls[0][0] as any;
      expect(query.include.employmentHistory.where).toEqual({ OR: [approvedEmploymentSourceWhere,
        { sourceRequest: { intakeType: { not: null }, requiresArrivalConfirmation: true,
          onboardingStatus: 'pending_entry', profileReviewStatus: 'approved', archivedAt: null,
          cancelledAt: null, arrivalConfirmedAt: null } },
      ] });
      expect(prisma.employeeProfile.upsert).not.toHaveBeenCalled();
      expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    });
  });

  it.each(controlled)('rejects new inactive %s.%s before any formal write', async (section, field, kind) => {
    const { service, prisma, options, baseVersion } = fixture();
    options.push({ kind, name: 'Inactive', isActive: false });
    const input = { baseVersion, employee: {}, profile: {}, [section]: { [field]: 'Inactive' } };
    await expect(service.submitDraft('user', input, operator)).rejects.toMatchObject({
      response: { data: { fieldErrors: { [`${section}.${field}`]: expect.any(String) } } },
    });
    expect(prisma.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each(controlled)('allows active new %s.%s', async (section, field, kind) => {
    const { service, options, baseVersion } = fixture();
    options.push({ kind, name: 'Active', isActive: true });
    await expect(service.submitDraft('user', { baseVersion, employee: {}, profile: {}, [section]: { [field]: 'Active' } }, operator))
      .resolves.toMatchObject({ reviewOutcome: 'not_required' });
  });

  it('preserves all untouched historical values without requiring directory entries', async () => {
    const employee = { jobGrade: 'Historical' };
    const profile = { education: 'Historical', maritalStatus: 'Historical', politicalStatus: 'Historical',
      householdType: 'Historical', emergencyContactRelation: 'Historical' };
    const { service, prisma, baseVersion } = fixture({ employee, profile });
    const result = await service.submitDraft('user', { baseVersion, employee: { ...employee, position: 'Changed' }, profile }, operator);
    expect(result.request?.proposedValue).toMatchObject({ employee, profile });
    expect(prisma.personnelReferenceData.findMany).not.toHaveBeenCalled();
  });

  it('autosaves unmaintained values but does not treat the saved draft as the formal baseline', async () => {
    const { service, prisma, baseVersion } = fixture();
    const input = { baseVersion, employee: { jobGrade: 'Unmaintained' }, profile: { education: 'Unmaintained' } };
    const draft = await service.saveArchiveDraft('user', input, operator);
    expect(draft?.proposedValue).toMatchObject({ employee: input.employee, profile: input.profile });
    expect(prisma.personnelReferenceData.findMany).not.toHaveBeenCalled();
    prisma.employeeDataChangeRequest.findFirst.mockResolvedValue(draft);
    await expect(service.submitDraft('user', { ...input, draftId: 'request', expectedVersion: 1 }, operator)).rejects.toThrow(BadRequestException);
  });

  it('keeps optional empty values and bank/contract free text valid', async () => {
    const { service, prisma, baseVersion } = fixture();
    await expect(service.submitDraft('user', { baseVersion, employee: { jobGrade: null },
      profile: { education: '', bankName: 'Custom bank' }, contracts: [{ name: 'C'.repeat(150) }] }, operator))
      .resolves.toMatchObject({ reviewOutcome: 'not_required' });
    expect(prisma.personnelReferenceData.findMany).not.toHaveBeenCalled();
  });

  it('blocks unknown new-hire values before reserving an employee or creating a request', async () => {
    const { service, prisma } = fixture();
    await expect(service.createEmployee({ name: 'Synthetic', deptId: 'dept', company: 'fuede',
      employeeStatus: 'active', employmentType: 'full_time', effectiveFrom: new Date('2026-11-14'),
      employee: { jobGrade: 'Unknown' }, profile: { education: 'Unknown' } } as any, operator))
      .rejects.toMatchObject({ response: { data: { fieldErrors: {
        'employee.jobGrade': expect.any(String), 'profile.education': expect.any(String),
      } } } });
    expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('blocks unknown grades in manual employment changes', async () => {
    const { service, prisma } = fixture();
    await expect(service.createEmploymentRecord('user', { company: 'fuede', employeeStatus: 'active', employmentType: 'full_time',
      changeType: 'transfer', effectiveFrom: new Date('2026-11-14'), jobGrade: 'Unknown' } as any, operator))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'employee.jobGrade': expect.any(String) } } } });
    expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });
});
