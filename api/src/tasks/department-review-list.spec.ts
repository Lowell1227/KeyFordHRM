import { TasksService } from './tasks.service';
import { TaskQueryDto } from './dto/task-query.dto';
import { AuthUser } from '@/common/types/auth.types';

describe('department review task inbox', () => {
  it('limits pending tasks to the frozen reviewer, regardless of broad HR visibility', async () => {
    const prisma = { assessmentTask: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([{ id: 't1', cycleId: 'c1', employeeId: 'e1', employee: { name: '虚拟员工' }, cycle: { name: '测试周期' }, dept: { name: '人事组' }, status: 'dept_review', isExempt: false }]),
    } };
    const service = new TasksService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const query = Object.assign(new TaskQueryDto(), { cycleId: 'c1' });
    const viewer = { id: 'head-1', sysRole: 'hr', canViewAll: true } as AuthUser;
    const result = await (service as any).findDepartmentReviews(query, viewer);
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(['t1']);
    expect(result.total).toBe(1);
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deptHeadId: 'head-1', employeeId: { not: 'head-1' }, status: 'dept_review', isExempt: false, cycleId: 'c1' } }));
    expect(prisma.assessmentTask.count).toHaveBeenCalledWith({ where: { deptHeadId: 'head-1', employeeId: { not: 'head-1' }, status: 'dept_review', isExempt: false, cycleId: 'c1' } });
  });
});
