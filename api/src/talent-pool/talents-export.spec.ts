import * as ExcelJS from 'exceljs';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TalentsService } from './talents.service';
import type { AuthUser } from '@/common/types/auth.types';

const actor = { id: 'hr-one', name: 'Synthetic HR', sysRole: 'hr' } as AuthUser;
function fixture() {
  const rows = [{ id: 'candidate', name: '虚构人才', phone: '17000000000', ownerId: actor.id, createdById: actor.id,
    status: 'new', sourceChannel: 'referral', tags: [], expectSalaryMin: 5501, expectSalaryMax: 6809, expectSalaryUnit: 'yuan',
    updatedAt: new Date('2026-11-20T00:00:00Z'), applications: [
      { id: 'finance', candidateId: 'candidate', positionName: '财务', stage: 'rejected', ownerId: actor.id, onboardingRequests: [] },
      { id: 'operations', candidateId: 'candidate', positionName: '运营', stage: 'interviewing', ownerId: actor.id, onboardingRequests: [] },
    ], onboardingRequests: [], _count: { files: 0 } }];
  const prisma: any = {
    talentCandidate: { findMany: jest.fn(async () => rows), count: jest.fn(async () => 0) },
    talentApplication: { count: jest.fn(async () => 2), findMany: jest.fn(async () => [{ positionName: '财务' }, { positionName: '运营' }]) },
    user: { findMany: jest.fn(async () => [{ id: actor.id, name: '虚构经办' }]),
      findUnique: jest.fn(async () => ({ ...actor, status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false })) },
    $queryRaw: jest.fn(async () => []), auditLog: { create: jest.fn(async () => ({})) },
  };
  prisma.$transaction = jest.fn(async ops => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
  return { prisma, service: new TalentsService(prisma), rows };
}

describe('talent export uses the list scope and all matching applications', () => {
  it('denies a recruitment-only current actor even if the request still carries old HR permissions', async () => {
    const { service, prisma } = fixture();
    prisma.user.findUnique.mockResolvedValue({ ...actor, sysRole: 'employee', hrCapabilities: ['recruitment_view'],
      status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false });
    await expect(service.exportApplications({} as never, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['employee_archive_edit', 'employee_archive_review'])('retains existing hr_user export with %s', async capability => {
    const { service, prisma } = fixture();
    const current = { ...actor, sysRole: 'hr_user' as const, hrCapabilities: [capability, 'recruitment_view'],
      status: 'probation', archivedAt: null, deletedAt: null, isAssessorOnly: false };
    prisma.user.findUnique.mockResolvedValue(current);
    const file = await service.exportApplications({} as never, current);
    expect(file.getHeaders().type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a mixed assessor before loading any export rows', async () => {
    const { service, prisma } = fixture();
    prisma.user.findUnique.mockResolvedValue({ ...actor, status: 'active', isAssessorOnly: true });
    await expect(service.exportApplications({} as never, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('ignores pagination, writes a binary workbook and audits only counts and safe filter summaries', async () => {
    const { service, prisma } = fixture();
    const query = { keyword: 'private-keyword', salaryMinYuan: 5501, mineOnly: true, page: 3, pageSize: 20, skip: 40, take: 20 } as never;
    await service.list(query, actor);
    const listWhere = prisma.talentCandidate.findMany.mock.calls[0][0].where;
    const exported = await service.exportApplications(query, actor);
    const exportQuery = prisma.talentCandidate.findMany.mock.calls[1][0];
    expect(exportQuery.where).toEqual(listWhere);
    expect(exportQuery.skip).toBeUndefined();
    expect(exportQuery.take).toBeUndefined();
    expect(exportQuery.orderBy).toEqual(prisma.talentCandidate.findMany.mock.calls[0][0].orderBy);
    const chunks: Buffer[] = [];
    for await (const chunk of exported.getStream()) chunks.push(Buffer.from(chunk));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.concat(chunks) as never);
    expect(workbook.worksheets[0].rowCount).toBe(3);
    expect(exported.getHeaders().type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: actor.id,
      action: 'export_talent_applications', newValue: expect.objectContaining({ rowCount: 2, candidateCount: 1,
        filters: expect.objectContaining({ keywordApplied: true, salaryFilterApplied: true, mineOnly: true }) }) }) });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toMatch(/private-keyword|5501|17000000000|虚构人才/);
  });

  it('rejects over 5000 application output rows before loading candidates or producing an audit/download', async () => {
    const { service, prisma } = fixture();
    prisma.talentApplication.count.mockResolvedValue(5001);
    await expect(service.exportApplications({} as never, actor)).rejects.toThrow(BadRequestException);
    expect(prisma.talentCandidate.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('counts candidates without applications toward the same output-row limit', async () => {
    const { service, prisma } = fixture();
    prisma.talentApplication.count.mockResolvedValue(4999);
    prisma.talentCandidate.count.mockResolvedValue(2);
    await expect(service.exportApplications({} as never, actor)).rejects.toThrow('5000');
    expect(prisma.talentCandidate.count).toHaveBeenCalledWith({ where: { AND: [{ deletedAt: null }, { applications: { none: {} } }] } });
    expect(prisma.talentCandidate.findMany).not.toHaveBeenCalled();
  });

  it('matches position and stage on the same application and exports only those rows, including historical stages', async () => {
    const { service, prisma } = fixture();
    const query = { applicationPosition: '财务', applicationStage: 'rejected', skip: 0, take: 20 } as never;
    await service.list(query, actor);
    const listQuery = prisma.talentCandidate.findMany.mock.calls[0][0];
    expect(listQuery.where.AND).toContainEqual({ applications: { some: { positionName: '财务', stage: 'rejected' } } });
    expect(listQuery.include.applications.where).toEqual({ positionName: '财务', stage: 'rejected' });
    await service.exportApplications(query, actor);
    const exportQuery = prisma.talentCandidate.findMany.mock.calls[1][0];
    expect(exportQuery.select.applications.where).toEqual({ positionName: '财务', stage: 'rejected' });
    expect(prisma.talentApplication.count).toHaveBeenCalledWith({ where: { candidate: listQuery.where, positionName: '财务', stage: 'rejected' } });
    expect(prisma.talentCandidate.count).toHaveBeenCalledTimes(1); // only list total; no empty-application export rows
  });

  it('has no separate some predicates that could combine ended finance with active operations', async () => {
    const { service, prisma } = fixture();
    await service.list({ applicationPosition: '财务', applicationStage: 'interviewing', skip: 0, take: 20 } as never, actor);
    expect(prisma.talentCandidate.findMany.mock.calls[0][0].where.AND).toEqual([
      { applications: { some: { positionName: '财务', stage: 'interviewing' } } },
    ]);
  });

  it('lists position names across historical applications of undeleted candidates', async () => {
    const { service, prisma } = fixture();
    expect(await service.applicationPositions()).toEqual(['财务', '运营']);
    expect(prisma.talentApplication.findMany).toHaveBeenCalledWith({ where: { candidate: { deletedAt: null } },
      select: { positionName: true }, distinct: ['positionName'], orderBy: { positionName: 'asc' } });
  });

  it('uses the signed-in application owner, position and stage together for existence, list summary, export and count', async () => {
    const { service, prisma } = fixture();
    const query = { responsibilityScope: 'application', mineOnly: true, applicationPosition: '运营', applicationStage: 'interviewing' } as never;
    const sameApplication = { ownerId: actor.id, positionName: '运营', stage: 'interviewing' };
    await service.list(query, actor);
    const list = prisma.talentCandidate.findMany.mock.calls[0][0];
    expect(list.where.AND).toEqual([{ applications: { some: sameApplication } }]);
    expect(list.include.applications.where).toEqual(sameApplication);
    await service.exportApplications(query, actor);
    expect(prisma.talentCandidate.findMany.mock.calls[1][0].select.applications.where).toEqual(sameApplication);
    expect(prisma.talentApplication.count).toHaveBeenCalledWith({ where: { candidate: list.where, ...sameApplication } });
    await service.list({ responsibilityScope: 'all', mineOnly: true } as never, actor);
    expect(prisma.talentCandidate.findMany.mock.calls[2][0].where).toEqual({ deletedAt: null });
    await expect(service.list(query)).rejects.toBeInstanceOf(BadRequestException);
  });
});
