import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AccountType, CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeArchivesController } from './employee-archives.controller';

const editor = { id: 'synthetic-editor', name: 'Synthetic HR', sysRole: SysRole.hr_user,
  hrCapabilities: ['employee_archive_edit'], deptId: null, canViewAll: false, isAssessorOnly: false };

function setup() {
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
  const tx: any = {
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
  const service = new EmployeeArchivesService(db);
  const input = (employee = {}, profile = {}, performance?: any, contracts?: any[]) => ({
    baseVersion: (service as any).archiveVersion(user), employee, profile, ...(performance ? { performance } : {}), ...(contracts ? { contracts } : {}),
  });
  return { service, db, tx, user, requests, audits, input };
}

describe('manual archive changes apply at submission', () => {
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
