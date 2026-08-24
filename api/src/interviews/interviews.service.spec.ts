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
