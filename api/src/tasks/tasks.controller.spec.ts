import 'reflect-metadata';
import { SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { TeamTaskQueryDto } from './dto/team-task-query.dto';
import { TasksController } from './tasks.controller';

describe('TasksController', () => {
  it('forwards the authenticated manager to the team task service', () => {
    const tasksService = {};
    const teamTasksService = { findAll: jest.fn().mockReturnValue({ items: [] }) };
    const controller = new TasksController(tasksService as any, teamTasksService as any);
    const query = Object.assign(new TeamTaskQueryDto(), { stage: 'goal-review' as const });
    const viewer: AuthUser = {
      id: 'manager-1',
      name: 'Manager',
      sysRole: SysRole.manager,
      deptId: null,
      isAssessorOnly: false,
      canViewAll: false,
    };

    const result = controller.findTeam(query, viewer);

    expect(teamTasksService.findAll).toHaveBeenCalledWith(query, viewer);
    expect(result).toEqual({ items: [] });
  });
});
