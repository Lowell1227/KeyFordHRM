import { BadRequestException, ConflictException } from '@nestjs/common';
import { TalentsService } from './talents.service';
import { TalentFilesService } from './talent-files.service';
import { TalentFollowUpsService } from './talent-follow-ups.service';
import { TalentSharesService } from './talent-shares.service';
import type { AuthUser } from '@/common/types/auth.types';

const hr = { id: 'hr', name: 'HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false } as AuthUser;
function setup() {
  const candidate = { id: 'candidate', name: 'Synthetic', phone: '17000000000', status: 'new', deletedAt: null, updatedAt: new Date('2026-11-12T00:00:00Z') };
  const prisma = {
    talentCandidate: { findFirst: jest.fn().mockResolvedValue(candidate), findUnique: jest.fn().mockResolvedValue(candidate), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    talentInterview: { findMany: jest.fn().mockResolvedValue([{ id: 'invite', status: 'scheduled', version: 1, startsAt: new Date() }]) },
    employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    talentFollowUp: { create: jest.fn().mockResolvedValue({ id: 'followup' }) },
    talentShare: { findUnique: jest.fn().mockResolvedValue({ id: 'share', token: 'secret-share-token', candidateId: candidate.id, revokedAt: null }), update: jest.fn() },
    auditLog: { create: jest.fn() }, user: { findUnique: jest.fn().mockResolvedValue({ id: 'employee' }) },
    $queryRaw: jest.fn().mockResolvedValue([candidate]), $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => typeof fn === 'function' ? fn(prisma) : Promise.all(fn));
  return { candidate, prisma, sut: new TalentsService(prisma as never) };
}

describe('talent lifecycle narrow risks', () => {
  it('rejects arbitrary manual conversion before looking up an employee', async () => {
    const { sut, prisma } = setup();
    await expect(sut.convert('candidate', 'employee', hr)).rejects.toThrow('请通过入离职办理并确认到岗');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('rejects missing-object binds even when client supplies size', async () => {
    const talents = { findActive: jest.fn(), countFiles: jest.fn().mockResolvedValue(0), createFileRecord: jest.fn() };
    const sut = new TalentFilesService(talents as never, { statObject: jest.fn().mockRejectedValue(new Error('not found')) } as never);
    await expect(sut.bind('candidate', { objectKey: 'talent-resume/missing.pdf', fileName: 'cv.pdf', fileSize: 123, mimeType: 'application/pdf' }, hr)).rejects.toThrow(BadRequestException);
    expect(talents.createFileRecord).not.toHaveBeenCalled();
  });
  it('followup date update is monotonic under concurrent older inserts', async () => {
    const { prisma, sut } = setup();
    await new TalentFollowUpsService(prisma as never, sut).create('candidate', { occurredAt: '2026-01-01', channel: 'phone', summary: 'synthetic' }, hr);
    expect(prisma.talentCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'candidate', deletedAt: null, OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lt: new Date('2026-01-01') } }] } }));
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
  });
  it('share revoke audit never persists the token', async () => {
    const { prisma, sut } = setup();
    await new TalentSharesService(prisma as never, sut).revoke('share', hr);
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('secret-share-token');
  });
  it('deletion requires current impact and explicit force, preserving linked interviews', async () => {
    const { sut, prisma } = setup();
    const impact = await sut.deleteImpact('candidate');
    expect(impact.requiresForce).toBe(true);
    await expect(sut.remove('candidate', hr, { impactVersion: impact.version, force: false })).rejects.toThrow(ConflictException);
    await sut.remove('candidate', hr, { impactVersion: impact.version, force: true });
    expect(prisma.talentCandidate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('17000000000');
    expect(prisma.employeeDataChangeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ talentCandidateId: 'candidate' }) }));
  });
  it('stale impact is refused with fresh impact payload', async () => {
    const { sut, prisma } = setup();
    const impact = await sut.deleteImpact('candidate');
    prisma.talentInterview.findMany.mockResolvedValue([{ id: 'invite', status: 'scheduled', version: 2, startsAt: new Date() }]);
    await expect(sut.remove('candidate', hr, { impactVersion: impact.version, force: true })).rejects.toMatchObject({ response: expect.objectContaining({ data: expect.objectContaining({ impact: expect.any(Object) }) }) });
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
  });
  it('repeated soft deletion is idempotent without touching preserved processes', async () => {
    const { candidate, sut, prisma } = setup();
    prisma.talentCandidate.findUnique.mockResolvedValue({ ...candidate, deletedAt: new Date() });
    await expect(sut.remove('candidate', hr)).resolves.toEqual({ id: 'candidate', deleted: true });
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
    expect(prisma.talentInterview.findMany).not.toHaveBeenCalled();
  });
});
