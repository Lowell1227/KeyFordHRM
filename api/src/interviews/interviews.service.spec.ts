import { ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { InterviewsService } from './interviews.service';

const interview = {
  id: 'interview-1',
  employeeId: 'employee-1',
  interviewerId: 'interviewer-1',
  status: 'pending',
  employeeSignedAt: null,
  task: {
    status: 'published',
    employee: { name: 'Employee' },
    dept: { name: 'Department' },
    manager: { name: 'Interviewer' },
  },
};

describe('InterviewsService exact responsibility', () => {
  it('filters the visible interview list by cycle, department, status and employee name or number', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = new InterviewsService({ performanceInterview: { findMany, count } } as any);

    await service.findAll({
      cycleId: 'cycle-1', deptId: 'dept-1', status: 'pending', keyword: 'E001',
      page: 1, pageSize: 20, skip: 0, take: 20,
    } as any, {
      id: 'admin', name: 'Admin', sysRole: SysRole.system_admin, deptId: null,
      isAssessorOnly: false, canViewAll: true,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        cycleId: 'cycle-1',
        status: 'pending',
        task: {
          deptId: 'dept-1',
          employee: { OR: [
            { name: { contains: 'E001', mode: 'insensitive' } },
            { employeeNo: { contains: 'E001', mode: 'insensitive' } },
          ] },
        },
      },
    }));
  });

  it.each([
    { sysRole: SysRole.hr, canViewAll: false },
    { sysRole: SysRole.employee, canViewAll: true },
  ])('does not let $sysRole/$canViewAll replace the assigned interviewer', async (access) => {
    const update = jest.fn().mockResolvedValue(interview);
    const service = new InterviewsService({
      performanceInterview: {
        findUnique: jest.fn().mockResolvedValue(interview),
        update,
      },
    } as any);

    await expect(service.update('interview-1', { content: '代填' } as any, {
      id: 'other-user',
      name: 'Other',
      sysRole: access.sysRole,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: access.canViewAll,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });
});
