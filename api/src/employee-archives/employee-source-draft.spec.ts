import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';

const operator = { id: 'operator-1', name: 'HR', sysRole: SysRole.hr, deptId: null, isAssessorOnly: false, canViewAll: true };
function fixture() {
  const warnings = [{ id: 'identity-issue', field: 'identity', code: 'review', message: 'Candidate needs verification', source: { sheetName: 'Synthetic roster', rowNumber: 3 } }];
  const source = { sheetName: 'Synthetic roster', rowNumber: 3 };
  const draft: any = { id: 'draft-1', sourceType: 'manual_employee_create', sourceSystem: 'roster_reconcile_20261030',
    sourceReference: 'synthetic:3', userId: null, employeeNo: null, requestVersion: 1, recordStatus: 'draft',
    profileReviewStatus: 'pending', revisionHistory: [], validationWarnings: warnings,
    proposedValue: { employee: { name: 'Synthetic' }, profile: {}, source, sourceFileHash: 'a'.repeat(64),
      sourceEmployeeNo: null, identityCandidateUserId: 'candidate-1' },
  };
  const tx: any = { employeeDataChangeRequest: { findFirst: jest.fn(async () => draft),
    update: jest.fn(async ({ data }) => Object.assign(draft, data)) },
    department: { findUnique: jest.fn(async () => ({ id: 'department-1', isActive: true })) },
    auditLog: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async callback => callback(tx)) };
  const numbers = { reserveNext: jest.fn(async () => 'SYNTHETIC-NO') };
  return { service: new EmployeeArchivesService(prisma as any, undefined, numbers as any), draft, warnings, source, tx, numbers };
}

describe('source draft preservation', () => {
  it('keeps null lifecycle/company/probation fields and server-owned source/identity warnings after autosave', async () => {
    const { service, draft, warnings, source, numbers } = fixture();
    const result: any = await service.saveEmployeeCreateDraft({ draftId: draft.id, name: 'Synthetic', company: null,
      employmentType: null, employeeStatus: null, employee: { probationMonths: null }, saveMode: 'auto',
      sourceFileHash: 'client-forged', identityCandidateUserId: 'client-forged' } as any, operator);
    expect(result.proposedValue.employee).toMatchObject({ employeeStatus: null, employmentType: null, company: null, probationMonths: null });
    expect(result.proposedValue).toMatchObject({ source, sourceFileHash: 'a'.repeat(64), sourceEmployeeNo: null, identityCandidateUserId: 'candidate-1' });
    expect(result.validationWarnings).toEqual(warnings);
    expect(numbers.reserveNext).not.toHaveBeenCalled();
    expect(result.userId).toBeNull();
  });

  it('retains provenance and source warnings when a completed draft is submitted into the normal review flow', async () => {
    const { service, draft, warnings, source, numbers } = fixture();
    const result: any = await service.createEmployee({ draftId: draft.id, name: 'Synthetic', company: CompanyCode.fuede,
      deptId: 'department-1', entryDate: new Date('2020-01-01'), effectiveFrom: new Date('2020-01-01'),
      employmentType: EmploymentType.full_time, employeeStatus: UserStatus.active }, operator);
    expect(result.proposedValue).toMatchObject({ source, sourceFileHash: 'a'.repeat(64), identityCandidateUserId: 'candidate-1' });
    expect(result.validationWarnings).toEqual(warnings);
    expect(result.profileReviewStatus).toBe('pending');
    expect(result.recordStatus).toBe('submitted');
    expect(result.userId).toBeNull();
    expect(numbers.reserveNext).toHaveBeenCalledTimes(1);
  });

  it('preserves server-owned non-file provenance and warnings through autosave and normal submission', async () => {
    const { service, draft, warnings, source } = fixture();
    draft.sourceSystem = 'synthetic_non_file_channel';
    draft.sourceReference = 'synthetic-reference-1';
    delete draft.proposedValue.sourceFileHash;
    const saved: any = await service.saveEmployeeCreateDraft({ draftId: draft.id, name: 'Synthetic',
      company: null, employeeStatus: null, employmentType: null, employee: { probationMonths: null }, saveMode: 'auto',
      sourceSystem: 'client-forged', sourceReference: 'client-forged' } as any, operator);
    expect(saved).toMatchObject({ sourceSystem: 'synthetic_non_file_channel', sourceReference: 'synthetic-reference-1', validationWarnings: warnings });
    expect(saved.proposedValue).toMatchObject({ source, identityCandidateUserId: 'candidate-1' });
    expect(saved.proposedValue).not.toHaveProperty('sourceFileHash');
    const submitted: any = await service.createEmployee({ draftId: draft.id, name: 'Synthetic', company: CompanyCode.fuede,
      deptId: 'department-1', entryDate: new Date('2020-01-01'), effectiveFrom: new Date('2020-01-01'),
      employmentType: EmploymentType.full_time, employeeStatus: UserStatus.active }, operator);
    expect(submitted).toMatchObject({ sourceSystem: 'synthetic_non_file_channel', sourceReference: 'synthetic-reference-1',
      validationWarnings: warnings, recordStatus: 'submitted', profileReviewStatus: 'pending', userId: null });
    expect(submitted.proposedValue).toMatchObject({ source, identityCandidateUserId: 'candidate-1' });
    expect(submitted.proposedValue).not.toHaveProperty('sourceFileHash');
  });

  it('counts bound-employee issues from formal facts rather than a pending draft, and hides the summary from ordinary employees', async () => {
    const { draft } = fixture();
    draft.userId = 'employee-1';
    draft.validationWarnings = [{ field: 'phone', code: 'missing', message: 'Contact information is missing' }];
    draft.proposedValue.profile.phone = 'synthetic-proposed-contact';
    const formalUser = { id: 'employee-1', phone: null as string | null, employeeProfile: { phone: null }, employmentHistory: [], employeeContracts: [] };
    const prisma: any = {
      employeeDataChangeRequest: { findMany: jest.fn(async () => [draft]), count: jest.fn(async () => 1) },
      user: { findMany: jest.fn(async () => [formalUser]) },
    };
    const service = new EmployeeArchivesService(prisma, undefined);
    const pending = await service.listDrafts({ page: 1, pageSize: 10 }, operator);
    expect(pending.items[0].archiveIssueCount).toBe(1);
    formalUser.phone = 'synthetic-confirmed-contact';
    const completed = await service.listDrafts({ page: 1, pageSize: 10 }, operator);
    expect(completed.items[0].archiveIssueCount).toBe(0);
    const ordinary = await service.listDrafts({ page: 1, pageSize: 10 }, { ...operator, sysRole: SysRole.employee, canViewAll: false });
    expect(ordinary.items[0]).not.toHaveProperty('archiveIssueCount');
    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ phone: true }) }));
  });
});
