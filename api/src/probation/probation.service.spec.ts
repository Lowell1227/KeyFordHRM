import { ForbiddenException } from '@nestjs/common';
import { ProbationReviewStatus, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { ProbationReviewQueryDto } from './dto/probation-review-query.dto';
import { ProbationService } from './probation.service';

describe('ProbationService list ownership', () => {
  const viewer: AuthUser = {
    id: 'viewer', name: 'Test viewer', sysRole: SysRole.employee,
    deptId: null, isAssessorOnly: false, canViewAll: false,
  };

  function setup() {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ProbationService({ probationReview: { count, findMany } } as any);
    return { service, count, findMany };
  }

  it.each([
    { method: 'findMine' as const, ownership: { employeeId: 'viewer' } },
    { method: 'findManaged' as const, ownership: { managerId: 'viewer' } },
  ])('$method intersects DTO filters with ownership for both items and total', async ({ method, ownership }) => {
    const { service, count, findMany } = setup();
    const query = Object.assign(new ProbationReviewQueryDto(), {
      employeeId: 'other-employee', managerId: 'other-manager',
      status: ProbationReviewStatus.self_eval, keyword: 'Test', page: 2, pageSize: 10,
    });

    await expect(service[method](query, viewer)).resolves.toEqual({ items: [], total: 0, page: 2, pageSize: 10 });

    const where = {
      AND: [ownership], employeeId: 'other-employee', managerId: 'other-manager',
      status: ProbationReviewStatus.self_eval,
      OR: [
        { employee: { name: { contains: 'Test', mode: 'insensitive' } } },
        { manager: { name: { contains: 'Test', mode: 'insensitive' } } },
      ],
    };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 10, take: 10 }));
  });

  it.each([
    { method: 'findMine' as const, ownership: { employeeId: 'viewer' } },
    { method: 'findManaged' as const, ownership: { managerId: 'viewer' } },
  ])('$method retains ownership without optional filters even for HR', async ({ method, ownership }) => {
    const { service, count, findMany } = setup();

    await service[method](new ProbationReviewQueryDto(), { ...viewer, sysRole: SysRole.hr });

    expect(count).toHaveBeenCalledWith({ where: { AND: [ownership] } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [ownership] } }));
  });

  it.each([SysRole.hr, SysRole.system_admin])('preserves the unrestricted HR query for %s', async (sysRole) => {
    const { service, count, findMany } = setup();
    const query = Object.assign(new ProbationReviewQueryDto(), {
      employeeId: 'other-employee', managerId: 'other-manager',
    });

    await service.findAll(query, { ...viewer, sysRole });

    const where = { AND: [{}], employeeId: 'other-employee', managerId: 'other-manager' };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it('does not grant employees the unrestricted HR query', async () => {
    const { service, count, findMany } = setup();

    await expect(service.findAll(new ProbationReviewQueryDto(), viewer)).rejects.toBeInstanceOf(ForbiddenException);
    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
