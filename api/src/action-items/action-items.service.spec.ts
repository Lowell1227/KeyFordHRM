import { SysRole } from '@prisma/client';
import { ActionItemsService } from './action-items.service';

describe('ActionItemsService relationship authorization', () => {
  it('lets a standard user manage an action item assigned to their direct report', async () => {
    const existing = {
      id: 'item-1', objectiveId: 'objective-1', title: 'Follow up', description: null,
      assigneeId: 'employee-1', startDate: null, dueDate: null, status: 'todo',
      parentId: null, progress: 0, createdBy: 'other-user', createdAt: new Date(), updatedAt: new Date(),
      assignee: { id: 'employee-1', name: 'Employee' }, creator: { id: 'other-user', name: 'Other' },
      objective: { id: 'objective-1', title: 'Objective' },
    };
    const updated = { ...existing, progress: 25 };
    const service = new ActionItemsService({
      actionItem: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { count: jest.fn().mockResolvedValue(1) },
      objective: { update: jest.fn() },
    } as any);

    await expect(service.updateProgress('item-1', { progress: 25 }, {
      id: 'standard-manager', name: 'Manager', sysRole: SysRole.employee,
      deptId: null, isAssessorOnly: false, canViewAll: false,
    })).resolves.toEqual(expect.objectContaining({ progress: 25 }));
  });
});
