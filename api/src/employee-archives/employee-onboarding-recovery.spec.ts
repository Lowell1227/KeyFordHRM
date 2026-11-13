import { ConflictException } from '@nestjs/common';
import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';

const editor = { id: 'editor', name: 'Editor', sysRole: SysRole.hr, deptId: null, canViewAll: true, isAssessorOnly: false };
const reviewer = { ...editor, id: 'reviewer' };
const subjectId = '11111111-1111-4111-8111-111111111111';

// Only persistence is replaced; review, number reservation and activation use real services.
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return (!('not' in value) || row[key] !== value.not)
        && (!('in' in value) || value.in.includes(row[key]))
        && (!('lte' in value) || row[key] <= value.lte)
        && (!('gte' in value) || row[key] >= value.gte)
        && (!('gt' in value) || row[key] > value.gt);
    }
    return row[key] === value;
  });
}

function setup(intakeType: 'new_hire' | 'reentry' = 'new_hire') {
  const request: any = {
    id: 'r1', userId: 'u1', employeeName: 'Synthetic', employeeNo: '358', intakeType,
    sourceType: intakeType === 'new_hire' ? 'manual_employee_create' : 'manual_reentry',
    onboardingStatus: 'pending_entry', recordStatus: 'submitted', requestVersion: 2,
    requiresArrivalConfirmation: true, arrivalDate: null, arrivalConfirmedAt: null, arrivalConfirmedById: null,
    cancelledAt: null, cancelledById: null, cancelledReason: null, archivedAt: null, appliedAt: null,
    profileReviewStatus: 'approved', performanceReviewStatus: 'not_required', createdById: editor.id,
    talentCandidateId: 't1', revisionHistory: [], validationWarnings: [], validationErrors: [],
    baseValue: { employee: intakeType === 'new_hire' ? {} : { status: 'resigned', employeeNo: '126' } },
    proposedValue: { employee: { name: 'Synthetic', employeeNo: '358', company: 'fuede', deptId: 'd1',
      positionId: 'p1', position: 'Original position', managerId: 'm1', employmentType: 'full_time',
      employeeStatus: 'probation', effectiveFrom: '2026-11-10', effectiveDate: '2026-11-10',
      entryDate: '2026-11-10', effectiveTo: null, probationMonths: 3, plannedRegularDate: '2027-02-10' },
    profile: {}, contracts: [], performance: { managerId: null } },
  };
  const user: any = { id: 'u1', name: 'Synthetic', accountType: 'employee', status: 'pending_entry',
    employeeNo: '358', archivedAt: null, deletedAt: null, deptId: 'd1', directManagerId: null };
  const candidate: any = { id: 't1', name: 'Source', deletedAt: null, status: 'new', convertedUserId: null };
  const records: any[] = [{ id: 'e1', sourceRequestId: 'r1', userId: 'u1', employeeNo: '358', company: 'fuede',
    deptId: 'd1', positionId: 'p1', position: 'Original position', directManagerId: 'm1',
    employmentType: 'full_time', employeeStatus: 'probation', effectiveFrom: new Date('2026-11-10'),
    entryDate: new Date('2026-11-10'), effectiveTo: null, plannedRegularDate: new Date('2027-02-10'), probationMonths: 3 }];
  const assignments: any[] = [{ id: 'n1', userId: 'u1', sourceRequestId: 'r1', employeeNo: '358', status: 'reserved' }];
  const otherRequests: any[] = [];
  const audit: any[] = [];
  const apply = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data) as any) {
      row[key] = value?.increment ? row[key] + value.increment : value;
    }
    return row;
  };
  const requestView = () => ({ ...request, employmentRecords: [...records.filter(row => row.sourceRequestId === request.id)],
    employeeNumbers: assignments.filter(row => row.sourceRequestId === request.id), talentCandidate: { ...candidate } });
  let nextNumber = 358;
  const tx: any = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => sql.join('').includes('nextval')
      ? [{ value: BigInt(++nextNumber) }] : [{ id: candidate.id }]),
    employeeDataChangeRequest: {
      findUnique: jest.fn(async () => requestView()), findUniqueOrThrow: jest.fn(async () => requestView()),
      findFirst: jest.fn(async ({ where }) => [request, ...otherRequests].find(row => matches(row, where)) ?? null),
      update: jest.fn(async ({ where, data }) => {
        if (!matches(request, where)) throw { code: 'P2025' };
        apply(request, data); return requestView();
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!matches(request, where)) return { count: 0 };
        apply(request, data); return { count: 1 };
      }),
    },
    employmentRecord: {
      findUnique: jest.fn(async ({ where }) => records.find(row => matches(row, where)) ?? null),
      findFirst: jest.fn(async ({ where }) => records.find(row => matches(row, where)) ?? null),
      update: jest.fn(async ({ where, data }) => apply(records.find(row => matches(row, where)), data)),
      create: jest.fn(async ({ data }) => { const row = { id: `e${records.length + 2}`, ...data }; records.push(row); return row; }),
      deleteMany: jest.fn(async ({ where }) => {
        let count = 0;
        for (let i = records.length - 1; i >= 0; i--) if (matches(records[i], where)) { records.splice(i, 1); count++; }
        return { count };
      }),
    },
    employeeNumberAssignment: {
      findFirst: jest.fn(async ({ where }) => assignments.find(row => matches(row, where)) ?? null),
      create: jest.fn(async ({ data }) => { const row = { id: `n${assignments.length + 1}`, ...data }; assignments.push(row); return row; }),
      update: jest.fn(async ({ where, data }) => apply(assignments.find(row => matches(row, where)), data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const selected = assignments.filter(row => matches(row, where));
        selected.forEach(row => apply(row, data)); return { count: selected.length };
      }),
    },
    user: { findUnique: jest.fn(async ({ where }) => where.id === user.id ? matches(user, where) ? user : null
      : { id: where.id, status: 'active' }),
    update: jest.fn(async ({ data }) => apply(user, data)),
    updateMany: jest.fn(async ({ where, data }) => {
      if (!matches(user, where)) return { count: 0 }; apply(user, data); return { count: 1 };
    }), create: jest.fn() },
    department: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, isActive: true })) },
    position: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, name: 'Original position', isActive: true })) },
    contractSubject: { findUnique: jest.fn(async () => ({ id: subjectId, name: 'Synthetic subject', isActive: true, internalCompany: CompanyCode.beijing_fuede })) },
    employeeContract: { findMany: jest.fn(async () => []) },
    employeeProfile: { upsert: jest.fn() },
    talentCandidate: { findUnique: jest.fn(async () => ({ ...candidate })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!matches(candidate, where)) return { count: 0 }; apply(candidate, data); return { count: 1 };
      }) },
    externalIdentityBinding: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async ({ data }) => { audit.push(data); return data; }) },
  };
  const db: any = { ...tx, $transaction: jest.fn(async run => run(tx)) };
  const effective = new EmployeeEffectiveDateService(db);
  const onboarding = new EmployeeOnboardingService(db, new EmployeeNumberService(), {} as any, effective);
  const reviews = new EmployeeDataReviewsService(db, onboarding);
  const approve = () => reviews.approveBatch({ requestIds: [request.id], scopes: ['profile'] }, reviewer);
  const reopen = (version = request.requestVersion) => onboarding.reviseArrivalDate(request.id,
    { arrivalDate: '2026-11-11', requestVersion: version }, editor);
  const cancel = () => onboarding.cancelReentry(request.id, { reason: 'Synthetic no-show' }, editor.id);
  return { onboarding, reviews, request, user, candidate, records, assignments, otherRequests, audit, tx, db, approve, reopen, cancel };
}

describe('onboarding revision and cancelled-arrival recovery', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-12T03:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it.each(['remapped', 'unmapped', 'inactive'])('keeps the reviewed same-subject company through repeated revisions and approval: %s', async directoryState => {
    const f = setup('reentry');
    const frozen = { contractSubjectId: subjectId, company: 'fuede', companyText: 'Reviewed subject' };
    Object.assign(f.records[0], frozen);
    // The approved employment, not a stale proposal, owns the company snapshot.
    Object.assign(f.request.proposedValue.employee, { ...frozen, company: 'fansibao', companyText: 'Stale proposal' });
    f.tx.contractSubject.findUnique.mockResolvedValue({ id: subjectId, name: 'Renamed subject',
      isActive: directoryState !== 'inactive', internalCompany: directoryState === 'unmapped' ? null : CompanyCode.beijing_fuede });
    const input = { contractSubjectId: subjectId, company: CompanyCode.fansibao,
      deptId: 'd1', position: 'First revision', effectiveDate: new Date('2026-11-11'),
      employeeStatus: UserStatus.probation, employmentType: EmploymentType.full_time };
    expect((await f.onboarding.reviseReentry('r1', input, editor.id)).proposedValue.employee).toMatchObject(frozen);
    expect(f.records).toEqual([]);
    await f.reviews.rejectBatch(['r1'], 'Synthetic correction', reviewer);
    expect((await f.onboarding.reviseReentry('r1', { ...input, contractSubjectId: undefined, position: 'Second revision' }, editor.id))
      .proposedValue.employee).toMatchObject(frozen);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ ...frozen, position: 'Second revision' });
    expect(f.tx.contractSubject.findUnique).not.toHaveBeenCalled();
  });

  it('recomputes only a newly selected subject and still rejects mapping drift on approval', async () => {
    const f = setup('reentry');
    const frozen = { contractSubjectId: subjectId, company: 'fuede', companyText: 'Reviewed subject' };
    Object.assign(f.records[0], frozen);
    Object.assign(f.request.proposedValue.employee, frozen);
    const nextId = '33333333-3333-4333-8333-333333333333';
    const input = { contractSubjectId: nextId, company: CompanyCode.fuede, deptId: 'd1',
      effectiveDate: new Date('2026-11-11'), employeeStatus: UserStatus.probation, employmentType: EmploymentType.full_time };
    const revised = await f.onboarding.reviseReentry('r1', input, editor.id);
    expect(revised.proposedValue.employee).toMatchObject({ contractSubjectId: nextId, company: 'beijing_fuede', companyText: 'Synthetic subject' });
    f.tx.contractSubject.findUnique.mockResolvedValue({ id: nextId, name: 'Synthetic subject', isActive: true, internalCompany: null });
    expect((await f.approve()).failed).toEqual([{ requestId: 'r1', reason: expect.stringContaining('内部公司映射') }]);
    expect(f.records).toEqual([]);
  });

  it('applies all reviewed reentry fields after date revision and return, without replacing the employment identity', async () => {
    const f = setup('reentry');
    await f.reopen();
    await f.reviews.rejectBatch(['r1'], 'Synthetic correction', reviewer);
    await f.onboarding.reviseReentry('r1', { company: CompanyCode.beijing_fuede, contractSubjectId: subjectId,
      deptId: 'd2', positionId: 'p2', position: 'New position', rosterManagerId: 'm2',
      effectiveDate: new Date('2026-11-11'), employmentType: EmploymentType.part_time,
      employeeStatus: UserStatus.active, probationMonths: 1, plannedRegularDate: new Date('2026-12-11') }, editor.id);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ id: 'e1', sourceRequestId: 'r1', deptId: 'd2', positionId: 'p2',
      position: 'New position', directManagerId: 'm2', company: 'beijing_fuede', contractSubjectId: subjectId,
      companyText: 'Synthetic subject', employmentType: 'part_time', employeeStatus: 'active',
      probationMonths: 1, plannedRegularDate: new Date('2026-12-11'), effectiveFrom: new Date('2026-11-11') });
    await f.onboarding.confirmArrival('r1', { arrivalDate: '2026-11-11', requestVersion: f.request.requestVersion }, reviewer);
    expect(f.user).toMatchObject({ id: 'u1', deptId: 'd2', positionId: 'p2', status: 'active', employmentType: 'part_time' });
  });

  it('retains explicit clears when re-reviewing the existing pending reentry employment', async () => {
    const f = setup('reentry');
    await f.reopen();
    await f.onboarding.reviseReentry('r1', { company: CompanyCode.fuede, deptId: 'd1',
      positionId: null, position: null, rosterManagerId: null, effectiveDate: new Date('2026-11-11'),
      employeeStatus: UserStatus.probation, employmentType: EmploymentType.full_time,
      probationMonths: null, plannedRegularDate: null }, editor.id);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.records[0]).toMatchObject({ positionId: null, position: null, directManagerId: null,
      probationMonths: null, plannedRegularDate: null });
  });

  it.each([false, true])('reopens the same cancelled new-hire identity through fresh review and arrival (deleted source: %s)', async deleted => {
    const f = setup();
    await f.cancel();
    expect(f.user).toMatchObject({ id: 'u1', status: 'pending_entry', employeeNo: null });
    expect(f.records).toEqual([]);
    if (deleted) f.candidate.deletedAt = new Date();
    const cancelledVersion = f.request.requestVersion;
    const result = await f.reopen(cancelledVersion);
    expect(result).toMatchObject({ id: 'r1', userId: 'u1', intakeType: 'new_hire', talentCandidateId: 't1',
      employeeNo: '359', recordStatus: 'submitted', onboardingStatus: 'submitted', profileReviewStatus: 'pending' });
    expect(f.request).toMatchObject({ cancelledAt: null, cancelledById: null, cancelledReason: null, arrivalConfirmedAt: null });
    expect(f.user.status).toBe('pending_entry');
    expect(f.records).toEqual([]);
    expect(f.assignments.map(row => row.status)).toEqual(['reserved']);
    expect(f.request.revisionHistory.at(-1).releasedReservation).toMatchObject({
      id: 'n1', sourceRequestId: 'r1', employeeNo: '358', status: 'released',
    });
    await expect(f.reopen(cancelledVersion)).rejects.toBeInstanceOf(ConflictException);
    expect(f.assignments).toHaveLength(1);
    expect((await f.approve()).failed).toEqual([]);
    expect(f.user).toMatchObject({ id: 'u1', status: 'pending_entry', employeeNo: '359' });
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ userId: 'u1', sourceRequestId: 'r1', employeeNo: '359', changeType: 'hire' });
    await f.onboarding.confirmArrival('r1', { arrivalDate: '2026-11-11', requestVersion: f.request.requestVersion }, reviewer);
    expect(f.user).toMatchObject({ id: 'u1', status: 'probation', employeeNo: '359' });
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.records.some(row => row.employeeStatus === 'resigned')).toBe(false);
    expect(f.candidate.convertedUserId).toBe(deleted ? null : 'u1');
    expect(f.audit.map(row => row.action)).toContain('reopen_cancelled_employee_arrival');
    expect(f.audit.map(row => row.action)).toContain('cancel_employee_reentry');
  });

  it.each(['active', 'probation', 'resigned'])('does not reopen a cancelled identity with %s employment history', async employeeStatus => {
    const f = setup();
    await f.cancel();
    f.records.push({ id: 'history', userId: 'u1', employeeStatus, effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2020-02-01') });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
    expect(f.request.onboardingStatus).toBe('cancelled');
    expect(f.assignments).toHaveLength(1);
  });

  it('discovers the recoverable original application for the pending identity without changing it', async () => {
    const f = setup();
    await f.cancel();
    const before = structuredClone(f.request);
    expect(await f.onboarding.getCurrentReentry('u1')).toMatchObject({ id: 'r1', userId: 'u1',
      intakeType: 'new_hire', onboardingStatus: 'cancelled' });
    expect(f.request).toEqual(before);
    expect(f.assignments).toHaveLength(1);
    f.records.push({ id: 'history', userId: 'u1', employeeStatus: 'resigned' });
    expect(await f.onboarding.getCurrentReentry('u1')).toBeNull();
  });

  it('keeps the same-date reopened application discoverable before and after profile review', async () => {
    const f = setup();
    await f.cancel();
    await f.onboarding.reviseArrivalDate('r1', { arrivalDate: '2026-11-10', requestVersion: f.request.requestVersion }, editor);
    expect(await f.onboarding.getCurrentReentry('u1')).toMatchObject({ id: 'r1', onboardingStatus: 'submitted' });
    await expect(f.onboarding.confirmArrival('r1', { arrivalDate: '2026-11-10', requestVersion: f.request.requestVersion }, reviewer))
      .rejects.toBeInstanceOf(ConflictException);
    expect((await f.approve()).failed).toEqual([]);
    expect(await f.onboarding.getCurrentReentry('u1')).toMatchObject({ id: 'r1', onboardingStatus: 'pending_entry' });
    expect(f.user.status).toBe('pending_entry');
  });

  it('retains saved profile, contracts and the existing performance review state on reopening', async () => {
    const f = setup();
    f.request.proposedValue.profile = { education: 'Synthetic education' };
    f.request.proposedValue.contracts = [{ contractNo: 'synthetic-contract', contractType: 'labor' }];
    f.request.proposedValue.performance = { managerId: 'm1' };
    f.request.performanceReviewStatus = 'approved';
    f.request.performanceReviewedAt = new Date();
    f.request.performanceReviewedById = reviewer.id;
    await f.cancel();
    await f.reopen();
    expect(f.request).toMatchObject({ performanceReviewStatus: 'approved', performanceReviewedAt: new Date(), performanceReviewedById: reviewer.id });
    expect((await f.approve()).failed).toEqual([]);
    expect(f.tx.employeeProfile.upsert).not.toHaveBeenCalled();
    expect(f.tx.employeeContract.findMany).not.toHaveBeenCalled();
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });

  it.each(['reserved', 'current', 'historical'])('does not reopen with an existing %s number assignment', async status => {
    const f = setup();
    await f.cancel();
    f.assignments.push({ id: 'other-number', userId: 'u1', status });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
    expect(await f.onboarding.getCurrentReentry('u1')).toBeNull();
  });

  it('does not reopen while another identity has an unfinished application from the same source', async () => {
    const f = setup();
    await f.cancel();
    f.otherRequests.push({ id: 'r2', userId: null, talentCandidateId: 't1', intakeType: 'new_hire',
      onboardingStatus: 'draft', recordStatus: 'draft', archivedAt: null, cancelledAt: null });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
    expect(await f.onboarding.getCurrentReentry('u1')).toBeNull();
  });

  it('refuses profile approval if employment history appears after reopening', async () => {
    const f = setup();
    await f.cancel();
    await f.reopen();
    f.records.push({ id: 'future', userId: 'u1', employeeStatus: 'active', effectiveFrom: new Date('2027-01-01') });
    expect((await f.approve()).failed).toHaveLength(1);
    expect(f.records).toHaveLength(1);
    expect(f.tx.employmentRecord.create).not.toHaveBeenCalled();
    expect(f.user.status).toBe('pending_entry');
  });

  it.each(['draft', 'submitted', 'pending_entry'])('does not reopen alongside another %s intake', async onboardingStatus => {
    const f = setup();
    await f.cancel();
    f.otherRequests.push({ id: 'r2', userId: 'u1', talentCandidateId: 'other-source', intakeType: 'new_hire',
      onboardingStatus, recordStatus: onboardingStatus === 'draft' ? 'draft' : 'submitted', archivedAt: null, cancelledAt: null });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
    expect(f.assignments).toHaveLength(1);
  });

  it('does not reopen alongside a pending non-onboarding personnel change', async () => {
    const f = setup();
    await f.cancel();
    f.otherRequests.push({ id: 'r2', userId: 'u1', talentCandidateId: null, intakeType: null, onboardingStatus: null,
      recordStatus: 'submitted', profileReviewStatus: 'pending', performanceReviewStatus: 'not_required', archivedAt: null, cancelledAt: null });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['active', 'resigned'])('does not reopen when the identity is now %s', async status => {
    const f = setup();
    await f.cancel();
    f.user.status = status;
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not reopen legacy requests that did not require arrival', async () => {
    const f = setup();
    await f.cancel();
    f.request.requiresArrivalConfirmation = false;
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['40001', '40P01'])('preserves the parent raw-query conflict mapping for %s', async code => {
    const f = setup();
    f.db.$transaction.mockRejectedValue({ code: 'P2010', meta: { code } });
    await expect(f.reopen()).rejects.toBeInstanceOf(ConflictException);
  });
});
