import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { recruitmentDemandWorkbenchWhere } from './talent-workbench.service';

const user = { id: 'actor' } as AuthUser;
function setup(hrCapabilities: string[]) {
  const actor = { id: user.id, name: 'Synthetic', sysRole: 'employee', hrCapabilities,
    status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(actor) },
    recruitmentDemand: { count: jest.fn().mockResolvedValue(9), findMany: jest.fn().mockResolvedValue([]) },
    talentApplication: { findMany: jest.fn() } };
  return { sut: new RecruitmentDemandsService(prisma as never), prisma, actor };
}

describe('recruitment demand workbench full-list filters', () => {
  it.each(['review', 'returned'] as const)('keeps the %s full list identical to the workbench predicate', async workQueue => {
    const { sut, prisma, actor } = setup(['recruitment_edit', 'recruitment_demand_review']);
    const query = Object.assign(new PaginationDto(), { workQueue, page: 2, pageSize: 10 });
    const result = await sut.list(query as never, user);
    expect(result).toMatchObject({ total: 9, page: 2, pageSize: 10 });
    expect(prisma.recruitmentDemand.count).toHaveBeenCalledWith({ where: {
      AND: [{}, recruitmentDemandWorkbenchWhere(workQueue, actor)],
    } });
    expect(prisma.recruitmentDemand.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10,
      where: (prisma.recruitmentDemand.count.mock.calls as any[])[0][0].where }));
    expect(prisma.talentApplication.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['review', ['recruitment_edit']], ['returned', ['recruitment_demand_review']],
  ])('does not imply extra permission for %s with %j', async (workQueue, capabilities) => {
    const { sut, prisma } = setup(capabilities as string[]);
    await expect(sut.list(Object.assign(new PaginationDto(), { workQueue }) as never, user)).rejects.toThrow(ForbiddenException);
    expect(prisma.recruitmentDemand.findMany).not.toHaveBeenCalled();
  });
});
