import { SysRole } from '@prisma/client';
import { EmployeeArchivesService } from './employee-archives.service';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

const editor = { id: 'editor', name: 'Editor', sysRole: SysRole.hr, deptId: null, canViewAll: true, isAssessorOnly: false };
const candidateId = '11111111-1111-4111-8111-111111111111';

function setup() {
  const candidate: any = { id: candidateId, name: 'Synthetic', deletedAt: null, convertedUserId: null };
  let draft: any = null;
  let duplicate: any = null;
  const tx: any = {
    $queryRaw: jest.fn(async () => [{ id: candidateId }]),
    talentCandidate: { findUnique: jest.fn(async () => candidate) },
    employeeDataChangeRequest: {
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
    const result = await service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId } as any, editor);
    expect(result).toMatchObject({ talentCandidateId: candidateId, requiresArrivalConfirmation: true, intakeType: 'new_hire', onboardingStatus: 'draft' });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.talentCandidate.findUnique).toHaveBeenCalled();
  });

  it('preserves the source on autosave, including after candidate deletion', async () => {
    const { service, candidate } = setup();
    const first = await service.saveEmployeeCreateDraft({ name: 'Synthetic', talentCandidateId: candidateId } as any, editor);
    candidate.deletedAt = new Date();
    const result = await service.saveEmployeeCreateDraft({ draftId: first.id, expectedVersion: 1, name: 'Updated' }, editor);
    expect(result.talentCandidateId).toBe(candidateId);
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
