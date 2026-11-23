import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
const viewer: any = { id: 'hr', sysRole: 'hr', hrCapabilities: [], canViewAll: true };
function fixture() {
  const rows: any[] = ['a', 'b', 'c'].map(id => ({ id, name: id, employeeNo: id, accountType: 'employee', status: 'active', archivedAt: null,
    deptId: 'dept', dept: { name: '部门' }, entryDate: id === 'a' ? new Date('2020-01-01') : null,
    externalIdentityBindings: [], employeeNumberAssignments: [], employeeChangeRequests: [], employmentHistory: [],
    employeeProfile: {}, employeeContracts: [{ id: `contract-${id}`, isActive: true, effectiveFrom: new Date('2020-01-01'), expiresAt: new Date('2035-01-01') }] }));
  const allowed = (args: any) => {
    let ids = args?.where?.id?.in;
    const and = args?.where?.AND;
    if (Array.isArray(and)) ids = and.find((x: any) => x.id?.in)?.id.in ?? ids;
    return rows.filter(r => !ids || ids.includes(r.id));
  };
  const prisma: any = { user: { findMany: jest.fn(async args => allowed(args).slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take)),
    count: jest.fn(async args => allowed(args).length), groupBy: jest.fn().mockResolvedValue([]) },
    employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) }, employeeArchiveIssueExemption: { findMany: jest.fn().mockResolvedValue([]) } };
  const service = new UsersService(prisma, { getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}) } as any,
    { getIdentitySummariesForUsers: jest.fn().mockResolvedValue(new Map()) } as any);
  return { service, rows, prisma };
}
describe('maintenance filter and current counts use the same full employee scope', () => {
  it('counts current issues in the ordinary list', async () => {
    const { service } = fixture();const r = await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, viewer);
    expect(r.items.map(u => u.archiveIssueCount)).toEqual([0, 1, 1]);
  });
  it('filters before pagination and automatically removes corrected employees', async () => {
    const { service, rows } = fixture();const query: any = { needsMaintenance: true, page: 2, pageSize: 1, skip: 1, take: 1 };
    const r = await service.findAll(query, viewer);expect(r.total).toBe(2);expect(r.items.map(u => u.id)).toEqual(['c']);
    rows[1].entryDate = new Date('2020-01-01');
    const changed = await service.findAll({ ...query, page: 1, skip: 0 }, viewer);
    expect(changed.total).toBe(1);expect(changed.items.map(u => u.id)).toEqual(['c']);
  });
  it('denies private issue filtering to users who cannot read archives', async () => {
    const { service, prisma } = fixture();
    await expect(service.findAll({ needsMaintenance: true } as any, { ...viewer, sysRole: 'employee' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
