import { Prisma } from '@prisma/client';
import { TasksService } from './tasks.service';
import { TaskQueryDto } from './dto/task-query.dto';
import { AuthUser } from '@/common/types/auth.types';

describe('department review task records', () => {
  const viewer = { id: 'head-1', sysRole: 'hr', canViewAll: true } as AuthUser;
  const earlier = new Date('2026-09-01T10:00:00Z');
  const latest = new Date('2026-09-08T10:00:00Z');
  const review = (action: 'approve' | 'reject', createdAt = latest, extraData: unknown = null) => ({ nodeType: 'dept_review', action, createdAt, extraData });

  function setup() {
    const row = (id: string, status: string, overrides = {}) => ({
      id, status, cycleId: 'cycle-1', deptHeadId: viewer.id, employeeId: `employee-${id}`,
      employee: { name: `虚拟员工 ${id}`, employeeNo: `E-${id}`, position: '测试岗位' }, cycle: { name: '测试周期' }, dept: { name: '测试部门' }, deptId: 'dept-1',
      managerId: 'manager-1', isExempt: false, exemptReason: null, updatedAt: latest,
      gradeResult: { calculatedScore: new Prisma.Decimal(85), rawGrade: 'B', calibratedGrade: 'A' }, flowRecords: [] as ReturnType<typeof review>[], ...overrides,
    });
    const rows = [
      row('pending', 'dept_review'),
      row('approved', 'hr_calibration', { flowRecords: [review('approve')] }),
      row('combined', 'approval', { flowRecords: [review('approve', latest, { type: 'combined_department_review' })] }),
      row('returned', 'manager_scoring', { flowRecords: [review('approve', earlier), review('reject')] }),
      row('not-started', 'indicator_setting', { gradeResult: null }),
      row('legacy', 'published', { deptReviewedAt: earlier }),
      row('other-cycle', 'dept_review', { cycleId: 'cycle-2' }),
      row('self', 'dept_review', { employeeId: viewer.id }),
      row('unrelated', 'dept_review', { deptHeadId: 'head-2' }),
      row('exempt', 'dept_review', { isExempt: true }),
    ];
    const matches = (where: any, task: any) => (!where.deptHeadId || task.deptHeadId === where.deptHeadId)
      && task.employeeId !== where.employeeId?.not
      && (where.isExempt === undefined || task.isExempt === where.isExempt)
      && (!where.status || task.status === where.status)
      && (!where.cycleId || task.cycleId === where.cycleId)
      && (!where.deptId || task.deptId === where.deptId)
      && (!where.employee?.OR || where.employee.OR.some((condition: any) => {
        const [field, filter] = Object.entries(condition)[0] as [string, any];
        return String(task.employee[field] ?? '').toLowerCase().includes(filter.contains.toLowerCase());
      }));
    const prisma = { assessmentTask: {
      count: jest.fn(async ({ where }) => rows.filter(task => matches(where, task)).length),
      findMany: jest.fn(async ({ where, skip, take, include }) => rows.filter(task => matches(where, task)).slice(skip, skip + take).map(task => ({
        ...task,
        flowRecords: include.flowRecords ? task.flowRecords
          .filter(record => record.nodeType === include.flowRecords.where.nodeType && include.flowRecords.where.action.in.includes(record.action))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, include.flowRecords.take) : undefined,
      }))),
    } };
    const service = new TasksService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, rows };
  }

  it('retains pending, completed and not-started records within the frozen reviewer scope despite global HR visibility', async () => {
    const { service, prisma } = setup();
    const result = await service.findDepartmentReviews(new TaskQueryDto(), viewer);
    expect(result.items.map(item => item.id)).toEqual(['pending', 'approved', 'combined', 'returned', 'not-started', 'legacy', 'other-cycle']);
    expect(result).toMatchObject({ total: 7, pendingTotal: 2 });
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      deptHeadId: viewer.id, employeeId: { not: viewer.id }, isExempt: false,
    }, orderBy: [{ cycle: { startDate: 'desc' } }, { updatedAt: 'desc' }, { id: 'asc' }] }));
  });

  it('counts pending items across stages and pages while retaining the selected cycle and employee scope', async () => {
    const { service } = setup();
    const result = await service.findDepartmentReviews(Object.assign(new TaskQueryDto(), { status: 'hr_calibration', cycleId: 'cycle-1', pageSize: 1 }), viewer);
    expect(result).toMatchObject({ total: 1, pendingTotal: 1, page: 1, pageSize: 1 });
    expect(result.items.map(item => item.id)).toEqual(['approved']);
    const searched = await service.findDepartmentReviews(Object.assign(new TaskQueryDto(), { status: 'hr_calibration', cycleId: 'cycle-1', keyword: 'approved' }), viewer);
    expect(searched).toMatchObject({ total: 1, pendingTotal: 0 });
    const secondPage = await service.findDepartmentReviews(Object.assign(new TaskQueryDto(), { page: 2, pageSize: 2 }), viewer);
    expect(secondPage).toMatchObject({ total: 7, pendingTotal: 2 });
    expect(secondPage.items.map(item => item.id)).toEqual(['combined', 'returned']);
  });

  it('combines the selected department with employee name or number without weakening frozen reviewer scope', async () => {
    const { service, prisma } = setup();
    await service.findDepartmentReviews(Object.assign(new TaskQueryDto(), {
      cycleId: 'cycle-1', deptId: 'dept-1', keyword: 'E-approved',
    }), viewer);

    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deptHeadId: viewer.id,
        employeeId: { not: viewer.id },
        isExempt: false,
        cycleId: 'cycle-1',
        deptId: 'dept-1',
        employee: { OR: [
          { name: { contains: 'E-approved', mode: 'insensitive' } },
          { employeeNo: { contains: 'E-approved', mode: 'insensitive' } },
        ] },
      },
    }));
  });

  it('returns only the most recent actual department decision and identifies combined handling from its audit record', async () => {
    const { service, prisma } = setup();
    const result = await service.findDepartmentReviews(new TaskQueryDto(), viewer);
    const byId = (id: string) => result.items.find(item => item.id === id);
    expect(byId('pending')).toMatchObject({ departmentReview: { canReview: true, latest: null } });
    expect(byId('approved')).toMatchObject({ departmentReview: { canReview: false, latest: { action: 'approve', createdAt: latest, combined: false } } });
    expect(byId('combined')).toMatchObject({ departmentReview: { canReview: false, latest: { action: 'approve', createdAt: latest, combined: true } } });
    expect(byId('returned')).toMatchObject({ departmentReview: { canReview: false, latest: { action: 'reject', createdAt: latest, combined: false } } });
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ flowRecords: {
      where: { nodeType: 'dept_review', action: { in: ['approve', 'reject'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
      select: { action: true, createdAt: true, extraData: true },
    } }) }));
  });

  it('returns the employee display metadata and calibrated result without changing reviewer scope', async () => {
    const { service, prisma } = setup();
    const result = await service.findDepartmentReviews(new TaskQueryDto(), viewer);

    expect(result.items[0]).toMatchObject({
      employeeNo: 'E-pending',
      position: '测试岗位',
      approvedAt: null,
      rawGrade: 'B',
      calibratedGrade: 'A',
    });
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deptHeadId: viewer.id, employeeId: { not: viewer.id }, isExempt: false },
      include: expect.objectContaining({
        employee: { select: { name: true, employeeNo: true, position: true } },
        gradeResult: { select: { calculatedScore: true, rawGrade: true, calibratedGrade: true } },
      }),
    }));
  });

  it('does not invent review history from the task stage or a legacy review timestamp', async () => {
    const { service } = setup();
    const result = await service.findDepartmentReviews(new TaskQueryDto(), viewer);
    for (const id of ['not-started', 'legacy']) expect(result.items.find(item => item.id === id)).toMatchObject({ departmentReview: { canReview: false, latest: null } });
    expect(result.items.find(item => item.id === 'not-started')).toMatchObject({ totalScore: null, rawGrade: null });
  });
});
