import { CompanyCode, EmploymentType, SysRole, UserStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { EmployeeArchivesService } from './employee-archives.service';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { resolveTalentSource } from './employee-talent-source';

const editor = { id: 'editor', name: 'Editor', sysRole: SysRole.hr, deptId: null, canViewAll: true, isAssessorOnly: false };
const candidateId = '11111111-1111-4111-8111-111111111111';
const applicationId = '22222222-2222-4222-8222-222222222222';

function setup() {
  const candidate: any = { id: candidateId, name: 'Synthetic', deletedAt: null, convertedUserId: null };
  const application: any = { id: applicationId, candidateId, stage: 'accepted', revision: 0 };
  let draft: any = null;
  let duplicate: any = null;
  const tx: any = {
    $queryRaw: jest.fn(async () => [{ id: candidateId }]),
    talentCandidate: { findUnique: jest.fn(async () => candidate) },
    talentApplication: { findUnique: jest.fn(async () => application), updateMany: jest.fn(async ({ data }) => {
      Object.assign(application, data, { revision: application.revision + 1 }); return { count: 1 };
    }) },
    talentApplicationEvent: { create: jest.fn() },
    employeeDataChangeRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(async ({ where }) => where.talentCandidateId ? duplicate : draft),
      create: jest.fn(async ({ data }) => (draft = { id: 'r1', requestVersion: 1, updatedAt: new Date(), ...data })),
      update: jest.fn(async ({ data }) => { const version = draft.requestVersion; Object.assign(draft, data);
        if (data.requestVersion?.increment) draft.requestVersion = version + 1; return draft; }),
      findUnique: jest.fn(async () => draft),
    },
    auditLog: { create: jest.fn() },
  };
  const service = new EmployeeArchivesService({ $transaction: async (run: any) => run(tx) } as any);
  return { service, tx, candidate, setDuplicate: (value: any) => { duplicate = value; } };
}

describe('talent source on intake drafts', () => {
  it('validates and locks the source, persists it, and opts a new draft into arrival confirmation', async () => {
    const { service, tx } = setup();
    const result = await service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId, talentApplicationId: applicationId } as any, editor);
    expect(result).toMatchObject({ talentCandidateId: candidateId, talentApplicationId: applicationId, requiresArrivalConfirmation: true, intakeType: 'new_hire', onboardingStatus: 'draft' });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.talentCandidate.findUnique).toHaveBeenCalled();
  });

  it('preserves the source on autosave, including after candidate deletion', async () => {
    const { service, candidate } = setup();
    const first = await service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId, talentApplicationId: applicationId } as any, editor);
    candidate.deletedAt = new Date();
    const result = await service.saveEmployeeCreateDraft({ draftId: first.id, expectedVersion: 1, name: 'Updated' }, editor);
    expect(result.talentCandidateId).toBe(candidateId);
  });

  it('does not attach a talent source to an existing source-free draft', async () => {
    const { service, tx } = setup();
    const first = await service.saveEmployeeCreateDraft({ name: 'Synthetic' }, editor);
    await expect(service.saveEmployeeCreateDraft({
      draftId: first.id, expectedVersion: 1, name: 'Updated', talentCandidateId: candidateId,
    }, editor)).rejects.toThrow('申请来源人才不能更换');
    expect(tx.talentCandidate.findUnique).not.toHaveBeenCalled();
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it.each([null, undefined])('keeps an existing %s talent source immutable', async (savedSource) => {
    const { tx } = setup();
    await expect(resolveTalentSource(tx, candidateId, { id: 'existing', talentCandidateId: savedSource }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps a source-free draft source-free when the source is omitted', async () => {
    const { service, tx } = setup();
    const first = await service.saveEmployeeCreateDraft({ name: 'Synthetic' }, editor);
    const result = await service.saveEmployeeCreateDraft({ draftId: first.id, expectedVersion: 1, name: 'Updated' }, editor);
    expect(result.talentCandidateId).toBeNull();
    expect(tx.talentCandidate.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a newly linked deleted candidate', async () => {
    const { service, candidate, tx } = setup();
    candidate.deletedAt = new Date();
    await expect(service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId } as any, editor)).rejects.toThrow();
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });

  it('returns the existing application id on duplicate intake without creating another draft', async () => {
    const { service, setDuplicate, tx } = setup();
    setDuplicate({ id: 'existing' });
    try {
      await service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId } as any, editor);
      throw new Error('expected conflict');
    } catch (error: any) {
      expect(error.getStatus()).toBe(409);
      const response: any = { status: jest.fn(() => response), json: jest.fn() };
      new HttpExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response }) } as any);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: { applicationId: 'existing' } }));
    }
    expect(tx.employeeDataChangeRequest.create).not.toHaveBeenCalled();
  });
});

describe('talent source archive concurrency', () => {
  function archiveSetup(count: number) {
    const drafts = ['r1', 'r2'].map(id => ({
      id, employeeName: 'Synthetic', talentCandidateId: candidateId, talentApplicationId: applicationId,
    }));
    const application = { id: applicationId, stage: 'onboarding', revision: 1 };
    const tx: any = {
      $queryRaw: jest.fn(),
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue(drafts), updateMany: jest.fn().mockResolvedValue({ count }),
      },
      talentApplication: {
        findUnique: jest.fn(async () => ({ ...application })),
        updateMany: jest.fn(async ({ data }) => { application.stage = data.stage; application.revision++; return { count: 1 }; }),
      },
      talentApplicationEvent: { create: jest.fn() }, auditLog: { create: jest.fn() },
    };
    const service = new EmployeeArchivesService({ $transaction: async (run: any) => run(tx) } as any);
    return { service, tx, application };
  }

  it.each([0, 1])('rejects an archive count of %s before touching applications or events', async count => {
    const { service, tx, application } = archiveSetup(count);
    await expect(service.archiveDrafts(['r1', 'r2'], editor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.talentApplication.findUnique).not.toHaveBeenCalled();
    expect(tx.talentApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(application.stage).toBe('onboarding');
  });

  it('syncs application cancellation only after every selected draft was archived', async () => {
    const { service, tx, application } = archiveSetup(2);
    await expect(service.archiveDrafts(['r1', 'r2', 'r1'], editor)).resolves.toEqual({ archived: 2 });
    expect(application.stage).toBe('accepted');
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'cancel_onboarding', fromStage: 'onboarding', toStage: 'accepted' }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.employeeDataChangeRequest.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.talentApplication.updateMany.mock.invocationCallOrder[0]);
  });
});

describe('resubmitted new-hire arrival gate', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-18T03:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  async function resubmit(employeeStatus: UserStatus, effectiveTo: Date | null) {
    let draft: any = {
      id: 'r1', sourceType: 'manual_employee_create', recordStatus: 'submitted', profileReviewStatus: 'rejected',
      talentCandidateId: candidateId, talentApplicationId: applicationId, requiresArrivalConfirmation: false,
      requestVersion: 2, updatedAt: new Date(), userId: null, employeeNo: 'synthetic-number',
      proposedValue: { employee: {}, profile: {} }, baseValue: {}, validationWarnings: [],
    };
    const tx: any = {
      $queryRaw: jest.fn(),
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'department', isActive: true }) },
      position: { findUnique: jest.fn().mockResolvedValue({ id: 'position', name: 'Synthetic position', isActive: true, jobFamily: null, jobFamilyId: null }) },
      talentCandidate: { findUnique: jest.fn().mockResolvedValue({ id: candidateId, deletedAt: null, convertedUserId: null }) },
      talentApplication: { findUnique: jest.fn().mockResolvedValue({ id: applicationId, candidateId, stage: 'onboarding', revision: 1 }) },
      employeeDataChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(async ({ where }) => where.id === draft.id ? draft : null),
        update: jest.fn(async ({ data }) => {
          const version = draft.requestVersion;
          draft = { ...draft, ...data };
          if (data.requestVersion?.increment) draft.requestVersion = version + data.requestVersion.increment;
          return draft;
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new EmployeeArchivesService({ $transaction: async (run: any) => run(tx) } as any, undefined, {} as any);
    const result = await service.createEmployee({
      draftId: draft.id, expectedVersion: 2, name: 'Synthetic', deptId: 'department', positionId: 'position',
      company: CompanyCode.fuede, employeeStatus, employmentType: EmploymentType.full_time,
      entryDate: new Date('2026-10-01'), effectiveFrom: new Date('2026-10-01'), effectiveTo,
    }, editor);
    return { result, tx };
  }

  it.each([UserStatus.active, UserStatus.probation])('re-enables arrival confirmation for a current %s resubmission', async employeeStatus => {
    const { result, tx } = await resubmit(employeeStatus, null);
    expect(result.requiresArrivalConfirmation).toBe(true);
    expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requiresArrivalConfirmation: true, onboardingStatus: 'submitted', profileReviewStatus: 'pending' }),
    }));
  });

  it.each([
    [UserStatus.resigned, null],
    [UserStatus.active, new Date('2026-10-31')],
  ] as const)('preserves the historical exemption for %s ending %s', async (employeeStatus, effectiveTo) => {
    const { result } = await resubmit(employeeStatus, effectiveTo);
    expect(result.requiresArrivalConfirmation).toBe(false);
  });
});
