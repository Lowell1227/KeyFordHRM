import { ConflictException } from '@nestjs/common';
import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

const operator = { id: 'hr', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true };
const updatedAt = new Date('2026-11-01T00:00:00Z');
const createInput = { name: 'Synthetic', company: CompanyCode.fuede, deptId: 'department',
  entryDate: new Date('2026-01-01'), effectiveFrom: new Date('2026-01-01'),
  employmentType: EmploymentType.full_time, employeeStatus: UserStatus.active };

function fixture(sourceType = 'manual_archive_change') {
  const user: any = { id: 'employee', employeeNo: '001', name: 'Synthetic', status: 'active', directManagerId: null,
    updatedAt, employeeProfile: null, employmentHistory: [], employeeContracts: [], externalIdentityBindings: [] };
  const draft: any = { id: 'draft', userId: sourceType === 'manual_archive_change' ? user.id : null,
    sourceType, recordStatus: 'draft', archivedAt: null, requestVersion: 3, updatedAt,
    profileReviewStatus: 'pending', performanceReviewStatus: 'not_required',
    baseValue: { employee: { name: 'Synthetic' }, profile: {}, profileExists: false, contracts: [], performance: { managerId: null } },
    proposedValue: { employee: { name: 'Saved' }, profile: {} } };
  const tx: any = {
    user: { findUnique: jest.fn(async () => user) },
    department: { findUnique: jest.fn(async () => ({ id: 'department', isActive: true })) },
    employeeDataChangeRequest: {
      findFirst: jest.fn(async () => draft),
      update: jest.fn(async ({ where, data }) => {
        if (where.requestVersion !== undefined && (where.requestVersion !== draft.requestVersion
          || where.updatedAt !== undefined && where.updatedAt !== draft.updatedAt)) throw { code: 'P2025' };
        Object.assign(draft, data, { requestVersion: data.requestVersion?.increment ? draft.requestVersion + 1 : draft.requestVersion });
        return draft;
      }),
      create: jest.fn(async ({ data }) => ({ id: 'new', requestVersion: 1, ...data })),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const db = { ...tx, $transaction: jest.fn(async (run) => {
    const snapshot = { ...draft };
    try { return await run(tx); } catch (error) { Object.assign(draft, snapshot); throw error; }
  }) };
  const numbers = { reserveNext: jest.fn(async () => '002') };
  return { user, draft, tx, db, service: new EmployeeArchivesService(db as any, undefined, numbers as any) };
}

describe('employee draft optimistic concurrency', () => {
  function partialApproval(approvedScope: 'profile' | 'performance') {
    const f = fixture();
    f.draft.recordStatus = 'submitted';
    f.draft.profileReviewStatus = approvedScope === 'profile' ? 'approved' : 'rejected';
    f.draft.performanceReviewStatus = approvedScope === 'performance' ? 'approved' : 'rejected';
    f.draft.baseValue.performance.managerId = 'original-manager';
    f.user.directManagerId = approvedScope === 'performance' ? 'approved-manager' : 'original-manager';
    f.user.name = approvedScope === 'profile' ? 'Approved name' : 'Synthetic';
    f.draft.proposedValue = { employee: { name: approvedScope === 'profile' ? 'Approved name' : 'Returned name' },
      profile: {}, contracts: [], performance: { managerId: approvedScope === 'performance' ? 'approved-manager' : 'returned-manager' } };
    const input = { draftId: 'draft', expectedVersion: 3,
      employee: { name: approvedScope === 'profile' ? 'Approved name' : 'Corrected name' }, profile: {}, contracts: [] as any[],
      performance: { managerId: approvedScope === 'performance' ? 'approved-manager' : 'corrected-manager' } };
    return { ...f, input };
  }

  it.each(['profile', 'performance'] as const)('resubmits the returned scope while retaining an already approved %s scope', async approvedScope => {
    const f = partialApproval(approvedScope);
    const originalBase = JSON.parse(JSON.stringify(f.draft.baseValue));
    const approvedProposal = JSON.parse(JSON.stringify(f.draft.proposedValue[approvedScope]));
    const result = await f.service.submitDraft('employee', f.input, operator);
    expect(result.requestVersion).toBe(4);
    expect(result.profileReviewStatus).toBe(approvedScope === 'profile' ? 'approved' : 'pending');
    expect(result.performanceReviewStatus).toBe(approvedScope === 'performance' ? 'approved' : 'pending');
    expect(f.draft.baseValue).toEqual(originalBase);
    expect(f.draft.proposedValue[approvedScope]).toEqual(approvedProposal);
    expect(result.proposedValue).toMatchObject({ employee: f.input.employee, performance: f.input.performance });
  });

  it('resumes an approved profile whose newly added contract now has an official ID and normalized values', async () => {
    const f = partialApproval('profile');
    const approvedContract = { contractType: 'contract', sequence: 0, name: '', signedAt: '2026-01-01', effectiveFrom: null,
      expiresAt: null, signingCompany: '', confidentialityAgreement: '已签', images: [], attachments: [] };
    f.draft.proposedValue.contracts = [approvedContract];
    f.user.employeeContracts = [{ ...approvedContract, id: 'official-contract', name: null, signingCompany: null,
      signedAt: new Date('2026-01-01'), effectiveFrom: new Date('2026-01-01') }];
    f.input.contracts = [approvedContract];
    const result = await f.service.submitDraft('employee', f.input, operator);
    expect(result.profileReviewStatus).toBe('approved');
    expect(result.performanceReviewStatus).toBe('pending');
    expect(f.draft.proposedValue.contracts).toEqual([approvedContract]);
    expect(f.draft.baseValue.contracts).toEqual([]);
  });

  it.each([
    { name: 'string trimming', raw: { name: ' Approved name ', phone: ' 123 ', position: ' Analyst ', jobGrade: ' P1 ', jobFamily: ' HR ', workLocation: ' HQ ', companyText: ' Company ' },
      user: { name: 'Approved name', phone: '123', position: 'Analyst' }, employment: { jobGrade: 'P1', jobFamily: 'HR', workLocation: 'HQ', companyText: 'Company' } },
    { name: 'blank strings stored as null', raw: { name: 'Approved name', phone: ' ', position: ' ', jobGrade: ' ', jobFamily: ' ', workLocation: ' ', companyText: ' ' },
      user: { phone: null, position: null }, employment: { jobGrade: null, jobFamily: null, workLocation: null, companyText: null } },
    { name: 'enum defaults', raw: { name: 'Approved name', company: 'unknown', employmentType: 'unknown', employeeStatus: 'unknown' },
      user: { employmentType: 'full_time', status: 'active' }, employment: { company: 'fuede' } },
  ])('resumes an approved profile after application normalizes $name', async ({ raw, user, employment }) => {
    const f = partialApproval('profile');
    Object.assign(f.user, user);
    f.user.employmentHistory = [employment];
    f.draft.proposedValue.employee = { ...raw };
    f.input.employee = { ...raw };
    const result = await f.service.submitDraft('employee', f.input, operator);
    expect(result.performanceReviewStatus).toBe('pending');
    expect(f.draft.proposedValue.employee).toEqual(raw);
  });

  it.each([false, true])('checks the applied directory position rather than the supplied display labels (external change=%s)', async changed => {
    const f = partialApproval('profile');
    const employee = { name: 'Approved name', positionId: 'position-1', position: 'Supplied label', jobFamily: 'Supplied family' };
    f.user.positionId = 'position-1';
    f.user.position = changed ? 'External position' : 'Directory position';
    f.user.employmentHistory = [{ jobFamily: 'Directory family' }];
    f.tx.position = { findUnique: jest.fn(async () => ({ id: 'position-1', name: 'Directory position', jobFamily: 'Directory family' })) };
    f.draft.proposedValue.employee = employee;
    f.input.employee = employee;
    if (changed) {
      await expect(f.service.submitDraft('employee', f.input, operator)).rejects.toBeInstanceOf(ConflictException);
      expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    } else {
      expect((await f.service.submitDraft('employee', f.input, operator)).performanceReviewStatus).toBe('pending');
      expect(f.draft.proposedValue.employee).toEqual(employee);
    }
  });

  it('keeps existing employment facts when approval only changed the employee projection', async () => {
    const f = partialApproval('profile');
    Object.assign(f.user, { name: 'Synthetic', positionId: 'position-1', position: 'Original position' });
    f.user.employmentHistory = [{ jobFamily: 'Original family', jobGrade: ' P1 ' }];
    const originalEmployee = (f.service as any).employeeReviewData(f.user, f.user.employmentHistory[0]);
    f.draft.baseValue.employee = originalEmployee;
    const approvedEmployee = { ...originalEmployee, name: 'Approved name ' };
    f.draft.proposedValue.employee = approvedEmployee;
    f.input.employee = { ...approvedEmployee };
    Object.assign(f.user, { name: 'Approved name', position: 'Directory position' });
    f.tx.position = { findUnique: jest.fn(async () => ({ id: 'position-1', name: 'Directory position', jobFamily: 'New directory family' })) };
    const result = await f.service.submitDraft('employee', f.input, operator);
    expect(result.performanceReviewStatus).toBe('pending');
    expect(f.draft.proposedValue.employee).toEqual(approvedEmployee);
  });

  it('recognizes a profile row created by an explicitly supplied nullable field during approval', async () => {
    const f = partialApproval('profile');
    f.draft.proposedValue.profile = { school: null };
    f.input.profile = { school: null };
    f.user.employeeProfile = { school: null };
    expect((await f.service.submitDraft('employee', f.input, operator)).performanceReviewStatus).toBe('pending');
    expect(f.draft.baseValue.profileExists).toBe(false);
  });

  it('retains inherited employee and existing-contract subject snapshots when the approved proposal omitted their IDs', async () => {
    const f = partialApproval('profile');
    const subjectId = '11111111-1111-4111-8111-111111111111';
    Object.assign(f.draft.baseValue.employee, { contractSubjectId: subjectId, companyText: 'Original subject' });
    f.user.employmentHistory = [{ contractSubjectId: subjectId, companyText: 'Original subject' }];
    const contract = { id: 'existing-contract', contractType: 'contract', sequence: 0, name: 'Existing contract', signedAt: null, effectiveFrom: null };
    f.draft.baseValue.contracts = [{ ...contract, contractSubjectId: subjectId, signingCompany: 'Original subject' }];
    f.user.employeeContracts = [{ ...contract, contractSubjectId: subjectId, signingCompany: 'Original subject' }];
    const employee = { name: ' Approved name ', companyText: 'Ignored supplied company' };
    const contracts = [{ ...contract, signingCompany: 'Ignored supplied company' }];
    f.draft.proposedValue.employee = employee;
    f.draft.proposedValue.contracts = contracts;
    f.input.employee = employee;
    f.input.contracts = contracts;
    expect((await f.service.submitDraft('employee', f.input, operator)).performanceReviewStatus).toBe('pending');
    expect(f.draft.proposedValue.employee).toEqual(employee);
    expect(f.draft.proposedValue.contracts).toEqual(contracts);
  });

  it.each([false, true])('keeps profile text literal while normalizing nullable profile dates (external trim=%s)', async changed => {
    const f = partialApproval('profile');
    f.draft.proposedValue.profile = { school: ' College ', birthDate: 'invalid-date' };
    f.input.profile = { ...f.draft.proposedValue.profile };
    f.user.employeeProfile = { school: changed ? 'College' : ' College ', birthDate: null };
    if (changed) await expect(f.service.submitDraft('employee', f.input, operator)).rejects.toBeInstanceOf(ConflictException);
    else expect((await f.service.submitDraft('employee', f.input, operator)).performanceReviewStatus).toBe('pending');
  });

  it.each(['profile', 'performance'] as const)('resolves an approved %s manager supplied by name using the original lookup rule', async approvedScope => {
    const f = partialApproval(approvedScope);
    f.tx.user.findMany = jest.fn(async () => [{ id: 'resolved-manager' }]);
    if (approvedScope === 'profile') {
      f.user.employmentHistory = [{ directManagerId: 'resolved-manager' }];
      Object.assign(f.draft.proposedValue.employee, { managerId: null, managerName: ' Manager ' });
      f.input.employee = { ...f.draft.proposedValue.employee };
    } else {
      f.user.directManagerId = 'resolved-manager';
      f.draft.proposedValue.performance = { managerId: null, managerName: ' Manager ' };
      f.input.performance = { ...f.draft.proposedValue.performance };
    }
    const result = await f.service.submitDraft('employee', f.input, operator);
    expect(result.requestVersion).toBe(4);
    expect(f.draft.proposedValue[approvedScope]).toMatchObject(approvedScope === 'profile' ? {} : { managerId: null, managerName: ' Manager ' });
  });

  it.each(['profile', 'performance'] as const)('rejects an attempt to rewrite an already approved %s scope', async approvedScope => {
    const f = partialApproval(approvedScope);
    if (approvedScope === 'profile') f.input.employee.name = 'Unauthorized replacement';
    else f.input.performance.managerId = 'unauthorized-manager';
    await expect(f.service.submitDraft('employee', f.input, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it.each(['approved profile', 'pending profile', 'approved performance', 'pending performance', 'contract edited', 'contract added', 'contract removed'])('still rejects external changes to %s during partial approval', async change => {
    const approvedScope = change === 'pending profile' || change === 'approved performance' ? 'performance' : 'profile';
    const f = partialApproval(approvedScope);
    if (change.endsWith('profile')) f.user.name = 'Externally changed';
    if (change.endsWith('performance')) f.user.directManagerId = 'external-manager';
    if (change.startsWith('contract')) {
      const contract = { contractType: 'contract', sequence: 0, name: 'Approved contract', confidentialityAgreement: '已签' };
      f.draft.proposedValue.contracts = [contract];
      f.input.contracts = [contract];
      f.user.employeeContracts = [{ ...contract, id: 'official-contract' }];
      if (change === 'contract edited') f.user.employeeContracts[0].confidentialityAgreement = '外部修改';
      if (change === 'contract added') f.user.employeeContracts.push({ id: 'external-contract', contractType: 'contract', sequence: 1 });
      if (change === 'contract removed') f.user.employeeContracts = [];
    }
    await expect(f.service.submitDraft('employee', f.input, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it.each(['saveArchiveDraft', 'submitDraft'] as const)('%s rejects an initial save without a formal archive version', async method => {
    const f = fixture();
    f.tx.employeeDataChangeRequest.findFirst.mockResolvedValue(null);
    await expect(f.service[method]('employee', { employee: { name: 'Old page' }, profile: {} }, operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each(['employee', 'profile', 'employment', 'contracts', 'performance'])('rejects an initial page after formal %s changes', async scope => {
    const f = fixture();
    f.tx.employeeDataChangeRequest.findFirst.mockResolvedValue(null);
    const archive: any = await f.service.findOne('employee');
    if (scope === 'employee') { f.user.name = 'Updated'; f.user.updatedAt = new Date('2026-11-01T00:01:00Z'); }
    if (scope === 'profile') f.user.employeeProfile = { id: 'profile', updatedAt: new Date('2026-11-01T00:01:00Z') };
    if (scope === 'employment') f.user.employmentHistory = [{ id: 'employment', updatedAt: new Date('2026-11-01T00:01:00Z') }];
    if (scope === 'contracts') f.user.employeeContracts = [{ id: 'contract', isActive: true, updatedAt: new Date('2026-11-01T00:01:00Z') }];
    if (scope === 'performance') f.user.directManagerId = 'new-manager';
    await expect(f.service.saveArchiveDraft('employee', { baseVersion: archive.archiveVersion,
      employee: { name: 'Old page' }, profile: {} } as any, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('accepts an initial proposal based on the current public archive version', async () => {
    const f = fixture();
    f.tx.employeeDataChangeRequest.findFirst.mockResolvedValue(null);
    const archive: any = await f.service.findOne('employee');
    const result = await f.service.saveArchiveDraft('employee', { baseVersion: archive.archiveVersion,
      employee: { name: 'New' }, profile: {} } as any, operator);
    expect(result.requestVersion).toBe(1);
    expect(f.tx.employeeDataChangeRequest.create).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 2])('rejects an absent or stale client version when saving a new-employee draft (%s)', async (expectedVersion) => {
    const f = fixture('manual_employee_create');
    await expect(f.service.saveEmployeeCreateDraft({ draftId: 'draft', expectedVersion, name: 'Late' } as any, operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.draft.proposedValue.employee.name).toBe('Saved');
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 2])('rejects an absent or stale client version when submitting a new-employee draft (%s)', async (expectedVersion) => {
    const f = fixture('manual_employee_create');
    await expect(f.service.createEmployee({ ...createInput, draftId: 'draft', expectedVersion } as any, operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it.each(['saveArchiveDraft', 'submitDraft'] as const)('%s rejects a stale client version before changing a saved archive proposal', async (method) => {
    const f = fixture();
    await expect(f.service[method]('employee', { draftId: 'draft', expectedVersion: 2,
      employee: { name: 'Late' }, profile: {} } as any, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.draft.proposedValue.employee.name).toBe('Saved');
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['saveArchiveDraft', 'submitDraft'] as const)('%s does not implicitly overwrite an existing draft without its ID', async (method) => {
    const f = fixture();
    await expect(f.service[method]('employee', { employee: { name: 'Late' }, profile: {} }, operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(f.tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each(['employee', 'profile', 'contracts', 'performance'])('rejects a changed formal %s baseline without rebasing the draft', async (scope) => {
    const f = fixture();
    if (scope === 'employee') f.user.name = 'Changed';
    if (scope === 'profile') f.user.employeeProfile = { gender: 'Changed' };
    if (scope === 'contracts') f.user.employeeContracts = [{ id: 'new-contract', name: 'Changed' }];
    if (scope === 'performance') f.user.directManagerId = 'new-manager';
    await expect(f.service.saveArchiveDraft('employee', { draftId: 'draft', expectedVersion: 3,
      employee: { name: 'Late' }, profile: {} } as any, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.draft.baseValue.employee.name).toBe('Synthetic');
    expect(f.tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it('increments the version and preserves the saved baseline when a current archive draft is saved', async () => {
    const f = fixture();
    const originalBase = f.draft.baseValue;
    const result = await f.service.saveArchiveDraft('employee', { draftId: 'draft', expectedVersion: 3,
      employee: { name: 'New' }, profile: {} } as any, operator);
    expect(result.requestVersion).toBe(4);
    expect(f.draft.baseValue).toEqual(originalBase);
    expect(f.tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestVersion: 3, updatedAt }),
    }));
    expect(f.db.$transaction).toHaveBeenCalled();
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('accepts an unchanged encrypted profile after its saved baseline passed through JSON storage', async () => {
    const f = fixture();
    f.user.employeeProfile = { idNumberEncrypted: Buffer.from('synthetic-cipher'), idNumberFingerprint: 'same-fingerprint' };
    f.draft.baseValue.profile = JSON.parse(JSON.stringify(f.user.employeeProfile));
    f.draft.baseValue.profileExists = true;
    const result = await f.service.saveArchiveDraft('employee', { draftId: 'draft', expectedVersion: 3,
      employee: { name: 'New' }, profile: {} } as any, operator);
    expect(result.requestVersion).toBe(4);
  });

  it('rolls back archive draft persistence when its audit fails', async () => {
    const f = fixture();
    f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.saveArchiveDraft('employee', { draftId: 'draft', expectedVersion: 3,
      employee: { name: 'New' }, profile: {} } as any, operator)).rejects.toThrow('audit unavailable');
    expect(f.draft.requestVersion).toBe(3);
    expect(f.draft.proposedValue.employee.name).toBe('Saved');
  });

  it.each(['saveArchiveDraft', 'submitDraft'] as const)('%s maps a database CAS failure to a conflict', async (method) => {
    const f = fixture();
    f.tx.employeeDataChangeRequest.update.mockRejectedValue({ code: 'P2025' });
    await expect(f.service[method]('employee', { draftId: 'draft', expectedVersion: 3,
      employee: { name: 'New' }, profile: {} } as any, operator)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('checks both the version and timestamp when saving a current new-employee draft', async () => {
    const f = fixture('manual_employee_create');
    const result = await f.service.saveEmployeeCreateDraft({ draftId: 'draft', expectedVersion: 3, name: 'New' } as any, operator);
    expect(result.requestVersion).toBe(4);
    expect(f.tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestVersion: 3, updatedAt }),
    }));
  });

  it('maps a concurrent transaction failure to a conflict without retrying a stale payload', async () => {
    const f = fixture();
    f.db.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(f.service.saveArchiveDraft('employee', { employee: { name: 'New' }, profile: {} }, operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });
});
