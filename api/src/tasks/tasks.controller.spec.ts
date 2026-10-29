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
  it('forwards employee displayed version to confirmation service', () => {
    const tasks = {confirmIndicators: jest.fn()};
    const controller = new TasksController(tasks as any, {} as any);
    const viewer = {id:'employee'} as AuthUser;
    controller.confirmIndicators('task', viewer, {expectedUpdatedAt:'2026-10-29T00:00:00.000Z'});
    expect(tasks.confirmIndicators).toHaveBeenCalledWith('task', viewer, '2026-10-29T00:00:00.000Z');
  });

});
