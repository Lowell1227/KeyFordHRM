import { ConfirmationStatus, SysRole, UserStatus } from '@prisma/client';
import { ConfirmationService } from './confirmation.service';

describe('employee confirmation draft', () => {
  const employeeId = '11111111-1111-4111-8111-111111111111';
  const managerId = '22222222-2222-4222-8222-222222222222';
  const employee = {
    id: employeeId,
    name: '试用期员工',
    status: UserStatus.probation,
    directManagerId: managerId,
    deletedAt: null,
  };
  const viewer = {
    id: employeeId,
    name: employee.name,
    sysRole: SysRole.employee,
    deptId: null,
    isAssessorOnly: false,
    canViewAll: false,
  };
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    department: { findMany: jest.fn() },
    confirmationApplication: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    confirmationMeetingAttachment: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { uploadFile: jest.fn() };
  const dataScope = { getConfirmationEmployeeFilter: jest.fn().mockResolvedValue({}) };
  const notifications = { create: jest.fn().mockResolvedValue('notification-1') };
  const service = new ConfirmationService(prisma as never, storage as never, dataScope as never, notifications as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === employeeId ? { ...employee, deptId: 'dept-1' }
        : { id: where.id, status: UserStatus.active, deletedAt: null });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(1);
    prisma.confirmationApplication.findFirst.mockResolvedValue(null);
    const draft = {
      id: '33333333-3333-4333-8333-333333333333',
      workflowVersion: 2,
      submissionVersion: 0,
      status: ConfirmationStatus.draft,
      employeeId,
      managerId,
      hrId: null,
      companyApproverId: null,
      probationReviewId: null,
      summary: '完成目标与改进计划',
      salary: null,
      voteResult: null,
      voteParticipants: [],
      voteComment: null,
      voteMeetingTime: null,
      actualRegularDate: null,
      managerComment: null,
      managerApprovedAt: null,
      hrComment: null,
      hrApprovedAt: null,
      companyComment: null,
      companyApprovedAt: null,
      rejectedById: null,
      rejectedAt: null,
      rejectReason: null,
      createdBy: employeeId,
      createdAt: new Date(),
      updatedAt: new Date(),
      employee: { id: employeeId, name: employee.name },
      manager: { id: managerId, name: '花名册直属主管' },
      hr: null,
      companyApprover: null,
      rejectedBy: null,
    };
    prisma.confirmationApplication.create.mockResolvedValue(draft);
    prisma.confirmationApplication.findUnique.mockResolvedValue(draft);
    prisma.confirmationApplication.update.mockResolvedValue(draft);
    prisma.confirmationApplication.updateMany.mockResolvedValue({ count: 1 });
    prisma.confirmationApplication.count.mockResolvedValue(1);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.department.findMany.mockResolvedValue([{ id: 'dept-1', name: '人事组', parentId: null,
      leaderId: null, approverId: '55555555-5555-4555-8555-555555555555', leader: null, approver: null }]);
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  });

  it('lets the probation employee create only their own draft and freezes the roster manager', async () => {
    await service.create({ summary: '完成目标与改进计划' } as never, viewer);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: employeeId } }));
    expect(prisma.confirmationApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employeeId, workflowVersion: 2 }),
    }));
    expect(prisma.confirmationApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workflowVersion: 2,
        status: ConfirmationStatus.draft,
        employee: { connect: { id: employeeId } },
        manager: { connect: { id: managerId } },
        summary: '完成目标与改进计划',
      }),
    }));
  });

  it('lets only the employee revise the summary and ignores approval or pay fields', async () => {
    await service.update('33333333-3333-4333-8333-333333333333', {
      summary: '更新工作小结',
      salary: 999999,
      hrId: '44444444-4444-4444-8444-444444444444',
    } as never, viewer);

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '33333333-3333-4333-8333-333333333333', employeeId, status: ConfirmationStatus.draft },
      data: { summary: '更新工作小结' },
    }));
  });

  it('does not overwrite a submitted application from a stale draft page', async () => {
    prisma.confirmationApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('33333333-3333-4333-8333-333333333333', {
      summary: '页面上的旧草稿',
    }, viewer)).rejects.toThrow('申请状态已变化');
  });

  it('submits a saved draft using roster manager and effective org approver without an HR assignee', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === employeeId ? { ...employee, deptId: 'dept-1' }
        : { id: where.id, status: UserStatus.active, deletedAt: null });
    await service.submit('33333333-3333-4333-8333-333333333333', viewer);
    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ConfirmationStatus.submitted, managerId,
        hrId: null, companyApproverId: '55555555-5555-4555-8555-555555555555' }),
    }));
  });

  it('routes company approval to the top department leader manager instead of the parent department leader', async () => {
    const departmentLeaderId = '44444444-4444-4444-8444-444444444444';
    const divisionApproverId = '55555555-5555-4555-8555-555555555555';
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept-1', name: '人事组', parentId: 'dept-parent', leaderId: null, approverId: null,
        leader: null, approver: null },
      { id: 'dept-parent', name: '人事行政部', parentId: null, leaderId: departmentLeaderId, approverId: null,
        leader: { name: '部门负责人', directManagerId: divisionApproverId, directManager: { name: '分管总' } }, approver: null },
    ]);

    await service.submit('33333333-3333-4333-8333-333333333333', viewer);

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyApproverId: divisionApproverId }),
    }));
  });

  it('keeps the draft when the organization has no effective company approver', async () => {
    prisma.department.findMany.mockResolvedValue([{ id: 'dept-1', name: '人事组', parentId: null,
      leaderId: null, approverId: null, leader: null, approver: null }]);
    await expect(service.submit('33333333-3333-4333-8333-333333333333', viewer))
      .rejects.toThrow('尚无有效的最终业务审批人');
    expect(prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes stale approval fields from the roster when a returned draft is submitted again', async () => {
    const currentManagerId = '77777777-7777-4777-8777-777777777777';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.draft, employeeId, managerId,
      hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '88888888-8888-4888-8888-888888888888',
      summary: '补充后的工作小结', returnReason: '补充项目结果',
    });
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === employeeId ? { ...employee, deptId: 'dept-1', directManagerId: currentManagerId }
        : { id: where.id, status: UserStatus.active, deletedAt: null });
    await service.submit('33333333-3333-4333-8333-333333333333', viewer);
    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ managerId,
        hrId: '44444444-4444-4444-8444-444444444444',
        companyApproverId: '88888888-8888-4888-8888-888888888888' }),
      data: expect.objectContaining({ managerId: currentManagerId, hrId: null,
        companyApproverId: '55555555-5555-4555-8555-555555555555' }),
    }));
  });

  it('increments the submission version when an employee resubmits returned work', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      submissionVersion: 1, status: ConfirmationStatus.draft, employeeId,
      managerId, hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      summary: '补充后的工作小结', returnReason: '请补充项目结果',
    });
    await service.submit('33333333-3333-4333-8333-333333333333', viewer);
    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ submissionVersion: 1, summary: '补充后的工作小结',
        managerId, hrId: '44444444-4444-4444-8444-444444444444' }),
      data: expect.objectContaining({
        status: ConfirmationStatus.submitted,
        submissionVersion: { increment: 1 },
        returnReason: null,
      }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'confirmation_employee_submitted' }),
    }));
  });

  it('records a negative manager recommendation and still forwards it for HR review', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2,
      status: ConfirmationStatus.submitted,
      managerId,
      hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '55555555-5555-4555-8555-555555555555',
    });
    const manager = { ...viewer, id: managerId, name: '花名册直属主管' };
    await service.approve('33333333-3333-4333-8333-333333333333', {
      comment: '工作需要改进，暂不建议转正',
      recommendation: false,
    } as never, manager);

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '33333333-3333-4333-8333-333333333333', status: ConfirmationStatus.submitted, managerId },
      data: expect.objectContaining({
        status: ConfirmationStatus.manager_approved,
        managerRecommendation: false,
        managerComment: '工作需要改进，暂不建议转正',
      }),
    }));
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not record a stale manager evaluation after another action changes the application', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, status: ConfirmationStatus.submitted, managerId,
    });
    prisma.confirmationApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('33333333-3333-4333-8333-333333333333', {
      recommendation: true, comment: '工作表现良好',
    } as never, { ...viewer, id: managerId })).rejects.toThrow('申请状态已变化');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('labels only the assigned current handler as pending in the returned list', async () => {
    const applicationId = '33333333-3333-4333-8333-333333333333';
    prisma.confirmationApplication.findMany.mockResolvedValue([{
      id: applicationId, workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.submitted, employeeId, managerId,
      hrId: null, companyApproverId: null, employee: { id: employeeId, name: employee.name },
      manager: { id: managerId, name: '直属主管' }, hr: null, companyApprover: null,
    }]);
    const result = await service.findPending({ page: 1, pageSize: 10, skip: 0, take: 10 } as never, { ...viewer, id: managerId });
    expect(result.items[0].pendingRole).toBe('manager');
    expect(prisma.confirmationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ workflowVersion: 2 })]) }),
    }));
  });

  it('shows the HR stage to authorized HR in scope without a preassigned handler', async () => {
    const hr = { ...viewer, id: '44444444-4444-4444-8444-444444444444', sysRole: SysRole.hr_user,
      hrCapabilities: ['confirmation_manage'] };
    prisma.confirmationApplication.findMany.mockResolvedValue([{
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.manager_approved, employeeId, managerId, hrId: null,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      employee: { id: employeeId, name: employee.name }, manager: null, hr: null, companyApprover: null,
    }]);
    const result = await service.findPending({ page: 1, pageSize: 10, skip: 0, take: 10 } as never, hr);
    expect(result.items[0].pendingRole).toBe('hr');
    expect(prisma.confirmationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({ status: ConfirmationStatus.manager_approved,
          employee: { is: {} } })]),
      })]) }),
    }));
    prisma.user.count.mockResolvedValue(0);
    const outside = await service.findPending({ page: 1, pageSize: 10, skip: 0, take: 10 } as never, hr);
    expect(outside.items[0].pendingRole).toBeNull();
  });

  it('lets HR administrators manage records but requires explicit confirmation permission to approve', async () => {
    const hrAdmin = { ...viewer, id: '44444444-4444-4444-8444-444444444444', sysRole: SysRole.hr };
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.manager_approved, employeeId, managerId, hrId: null,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      employee: { id: employeeId, name: employee.name }, voteParticipants: [], meetingAttachments: [],
    });

    await expect(service.findOne('33333333-3333-4333-8333-333333333333', hrAdmin))
      .resolves.toMatchObject({ employeeId, canApprove: false, canViewInternalMeeting: true });
    await expect(service.approve('33333333-3333-4333-8333-333333333333', {
      voteResult: 'pass', voteComment: '评议通过', proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
    } as never, hrAdmin)).rejects.toThrow('仅本公司有转正办理权限的 HR');
  });

  it('does not let the company approver use HR authority on the same application', async () => {
    const approverId = '55555555-5555-4555-8555-555555555555';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, status: ConfirmationStatus.manager_approved, employeeId, managerId,
      companyApproverId: approverId,
    });
    await expect(service.approve('33333333-3333-4333-8333-333333333333', {} as never,
      { ...viewer, id: approverId, sysRole: SysRole.hr })).rejects.toThrow('仅本公司有转正办理权限的 HR');
    expect(prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
  });

  it('lets an authorized HR manager read a scoped application while blocking out-of-scope HR and system admins', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, employeeId, managerId,
      hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      status: ConfirmationStatus.submitted, submissionVersion: 1,
      employee: { id: employeeId, name: employee.name },
      voteParticipants: [],
    });
    const unrelated = { ...viewer, id: '66666666-6666-4666-8666-666666666666', sysRole: SysRole.hr };
    await expect(service.findOne('33333333-3333-4333-8333-333333333333', unrelated)).resolves.toMatchObject({ employeeId });
    prisma.user.count.mockResolvedValueOnce(0);
    await expect(service.findOne('33333333-3333-4333-8333-333333333333', {
      ...unrelated, sysRole: SysRole.hr_user, hrCapabilities: ['confirmation_manage'],
    })).rejects.toThrow('无权查看');
    await expect(service.findOne('33333333-3333-4333-8333-333333333333', { ...unrelated, sysRole: SysRole.system_admin }))
      .rejects.toThrow('无权查看');
  });

  it('does not treat a legacy preassigned HR as the actual actor or grant them internal access', async () => {
    const oldAssigneeId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.manager_approved, employeeId, managerId,
      hrId: oldAssigneeId, hrApprovedAt: null,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      employee: { id: employeeId, name: employee.name },
      hr: { id: oldAssigneeId, name: '历史预填 HR' }, voteParticipants: [],
      meetingAttachments: [],
    });
    await expect(service.findOne('33333333-3333-4333-8333-333333333333',
      { ...viewer, id: oldAssigneeId })).rejects.toThrow('无权查看');
    const scopedHr = await service.findOne('33333333-3333-4333-8333-333333333333',
      { ...viewer, id: '66666666-6666-4666-8666-666666666666', sysRole: SysRole.hr });
    expect(scopedHr).toMatchObject({ hrId: null, hr: null, canApprove: false, canViewInternalMeeting: true });
  });

  it('does not expose an unsubmitted employee draft to its future manager or company approver', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, status: ConfirmationStatus.draft, employeeId, managerId,
      hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '55555555-5555-4555-8555-555555555555',
    });
    await expect(service.findOne('33333333-3333-4333-8333-333333333333', { ...viewer, id: managerId }))
      .rejects.toThrow('无权查看');
    await expect(service.findOne('33333333-3333-4333-8333-333333333333', { ...viewer, id: '55555555-5555-4555-8555-555555555555' }))
      .rejects.toThrow('无权查看');
  });

  it('shows an assigned manager a handled application in history instead of current pending', async () => {
    prisma.confirmationApplication.findMany.mockResolvedValue([]);
    await service.findAssignedHistory({ page: 1, pageSize: 10, skip: 0, take: 10 } as never, { ...viewer, id: managerId });
    expect(prisma.confirmationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([
        expect.objectContaining({ workflowVersion: 2, AND: expect.arrayContaining([
          { OR: [{ managerId }, { companyApproverId: managerId },
            { hrId: managerId, hrApprovedAt: { not: null }, employee: { is: { id: { in: [] } } } }] },
          { NOT: expect.objectContaining({ OR: expect.arrayContaining([{ status: ConfirmationStatus.submitted, managerId }]) }) },
        ]) }),
      ]) }),
    }));
  });

  it('shows HR managers scoped draft records', async () => {
    prisma.confirmationApplication.findMany.mockResolvedValue([]);
    const hrId = '44444444-4444-4444-8444-444444444444';
    await service.findAll({ page: 1, pageSize: 10, skip: 0, take: 10, keyword: '张' } as never,
      { ...viewer, id: hrId, sysRole: SysRole.hr });
    expect(prisma.confirmationApplication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([
        expect.objectContaining({ employee: { is: {} } }),
        expect.objectContaining({ employee: { name: { contains: '张', mode: 'insensitive' } } }),
      ]) }),
    }));
  });

  it('warns HR about missing planned regularization dates as well as due dates', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: employeeId, name: employee.name,
      employeeNo: 'E001', dept: { name: '业务部' }, plannedRegularDate: null }]);
    prisma.confirmationApplication.findMany.mockResolvedValue([]);
    const result = await service.warnings({ ...viewer, id: '44444444-4444-4444-8444-444444444444', sysRole: SysRole.hr });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([{ plannedRegularDate: null }]) }),
    }));
    expect(result).toEqual([expect.objectContaining({ employeeId, plannedRegularDate: null, daysUntil: null, hasApplication: false })]);
  });

  it('allows a scoped authorized HR to add an internal meeting attachment', async () => {
    const applicationId = '33333333-3333-4333-8333-333333333333';
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: applicationId, employeeId, workflowVersion: 2, hrId: null, status: ConfirmationStatus.manager_approved,
    });
    const file = { originalname: '评议依据.pdf' } as Express.Multer.File;
    await expect(service.addMeetingAttachment(applicationId, file, viewer)).rejects.toThrow('仅本公司有转正办理权限的 HR');
    expect(storage.uploadFile).not.toHaveBeenCalled();

    storage.uploadFile.mockResolvedValue({
      name: '评议依据.pdf', size: 123, mimeType: 'application/pdf',
      url: '/storage/download?key=confirmation-internal%2F2026%2F09%2F14%2Ffile.pdf',
    });
    prisma.confirmationMeetingAttachment.create.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666', applicationId,
      objectKey: 'confirmation-internal/2026/09/14/file.pdf', name: '评议依据.pdf',
      size: 123, mimeType: 'application/pdf', uploadedById: hrId, createdAt: new Date(),
    });
    const result = await service.addMeetingAttachment(applicationId, file, { ...viewer, id: hrId,
      sysRole: SysRole.hr_user, hrCapabilities: ['confirmation_manage'] });
    expect(storage.uploadFile).toHaveBeenCalledWith(file, 'confirmation-internal');
    expect(result).not.toHaveProperty('objectKey');
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('does not let HR add new evidence after the conclusion has moved to company approval', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, employeeId, hrId, status: ConfirmationStatus.hr_approved, submissionVersion: 1,
    });
    await expect(service.addMeetingAttachment('33333333-3333-4333-8333-333333333333',
      { originalname: '事后材料.pdf' } as Express.Multer.File, { ...viewer, id: hrId,
        sysRole: SysRole.hr_user, hrCapabilities: ['confirmation_manage'] }))
      .rejects.toThrow('当前环节不能上传');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('lets only the assigned HR and company approver resolve the internal attachment key', async () => {
    const applicationId = '33333333-3333-4333-8333-333333333333';
    const attachmentId = '66666666-6666-4666-8666-666666666666';
    const hrId = '44444444-4444-4444-8444-444444444444';
    const companyApproverId = '55555555-5555-4555-8555-555555555555';
    prisma.confirmationMeetingAttachment.findUnique.mockResolvedValue({
      id: attachmentId, applicationId, objectKey: 'confirmation-internal/2026/09/14/file.pdf',
      application: { id: applicationId, workflowVersion: 2, hrId, companyApproverId },
    });
    await expect(service.meetingAttachmentKey(applicationId, attachmentId, viewer)).rejects.toThrow('无权下载内部评议附件');
    await expect(service.meetingAttachmentKey(applicationId, attachmentId, { ...viewer, sysRole: SysRole.system_admin })).rejects.toThrow('无权下载内部评议附件');
    await expect(service.meetingAttachmentKey(applicationId, attachmentId, { ...viewer, id: hrId, sysRole: SysRole.hr })).resolves.toBe('confirmation-internal/2026/09/14/file.pdf');
    await expect(service.meetingAttachmentKey(applicationId, attachmentId, { ...viewer, id: companyApproverId })).resolves.toBe('confirmation-internal/2026/09/14/file.pdf');
  });

  it('lets scoped HR record an attachment-backed conclusion and saves the actual actor', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.manager_approved, employeeId,
      managerId, hrId: null, companyApproverId: '55555555-5555-4555-8555-555555555555',
    });
    prisma.confirmationMeetingAttachment.count.mockResolvedValue(1);

    await service.approve('33333333-3333-4333-8333-333333333333', {
      voteResult: 'extend',
      proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
      comment: '已线下评议，建议延长试用',
    } as never, { ...viewer, id: hrId, sysRole: SysRole.hr_user,
      hrCapabilities: ['confirmation_manage'] });

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '33333333-3333-4333-8333-333333333333', status: ConfirmationStatus.manager_approved },
      data: expect.objectContaining({
        status: ConfirmationStatus.hr_approved,
        hrId,
        voteResult: 'extend',
        meetingDate: null,
        proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
        voteRecordedAt: expect.any(Date),
        voteRecordedById: hrId,
      }),
    }));
    expect(prisma.confirmationApplication.updateMany.mock.calls[0]?.[0]?.data)
      .not.toHaveProperty('voteRecordedBy');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('keeps manager evaluation and HR approval as two separate actions for the same person', async () => {
    const dualRoleHandler = { ...viewer, id: managerId, name: '方园', sysRole: SysRole.hr_user,
      hrCapabilities: ['confirmation_manage'] };
    prisma.confirmationApplication.findUnique.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.submitted, employeeId, managerId, hrId: null,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      employee: { id: employeeId, name: employee.name, dept: { company: 'fuede' } },
    });

    const managerResult = await service.approve('33333333-3333-4333-8333-333333333333', {
      recommendation: true, comment: '建议转正',
    } as never, dualRoleHandler);

    expect(managerResult.status).toBe(ConfirmationStatus.manager_approved);
    const managerUpdate = prisma.confirmationApplication.updateMany.mock.calls.at(-1)?.[0];
    expect(managerUpdate).toMatchObject({
      where: { id: '33333333-3333-4333-8333-333333333333', status: ConfirmationStatus.submitted, managerId },
      data: { status: ConfirmationStatus.manager_approved },
    });
    expect(managerUpdate?.data).not.toHaveProperty('hrId');
    expect(prisma.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sysRole: SysRole.hr_user,
        hrCapabilities: { has: 'confirmation_manage' },
        dept: { is: { company: 'fuede' } },
      }),
    }));
    expect(prisma.user.findMany.mock.calls.at(-1)?.[0]?.where).not.toHaveProperty('OR');

    prisma.confirmationApplication.findUnique.mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2, submissionVersion: 1,
      status: ConfirmationStatus.manager_approved, employeeId, managerId, hrId: null,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
    });
    const hrResult = await service.approve('33333333-3333-4333-8333-333333333333', {
      voteResult: 'pass', voteComment: '评议通过', proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
    } as never, dualRoleHandler);

    expect(hrResult.status).toBe(ConfirmationStatus.hr_approved);
    expect(prisma.confirmationApplication.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ConfirmationStatus.manager_approved }),
      data: expect.objectContaining({ status: ConfirmationStatus.hr_approved, hrId: managerId }),
    }));
  });

  it('does not disclose the internal meeting basis to the employee or roster manager', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    const companyApproverId = '55555555-5555-4555-8555-555555555555';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.hr_approved, employeeId, managerId, hrId, companyApproverId,
      employee: { id: employeeId, name: '试用期员工' }, manager: { id: managerId, name: '主管' },
      hr: { id: hrId, name: 'HR' }, companyApprover: { id: companyApproverId, name: '审批人' },
      voteResult: 'pass', voteComment: '内部依据', voteParticipants: [],
      meetingDate: new Date('2026-09-14T00:00:00.000Z'),
      proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
      voteRecordedAt: new Date(), hrComment: '内部办理意见',
      meetingAttachments: [{ id: 'file-1', name: '会议附件.pdf', size: 123, mimeType: 'application/pdf', uploadedById: hrId, createdAt: new Date() }],
    });

    const employeeDetail = await service.findOne('33333333-3333-4333-8333-333333333333', viewer);
    const managerDetail = await service.findOne('33333333-3333-4333-8333-333333333333', { ...viewer, id: managerId });
    const hrDetail = await service.findOne('33333333-3333-4333-8333-333333333333', { ...viewer, id: hrId, sysRole: SysRole.hr });
    expect(employeeDetail).toMatchObject({ voteResult: null, voteComment: null, meetingAttachments: [] });
    expect(managerDetail).toMatchObject({ voteResult: null, voteComment: null, meetingAttachments: [] });
    expect(employeeDetail.steps.find((step) => step.role === 'hr')?.comment).toBeNull();
    expect(hrDetail.meetingAttachments).toHaveLength(1);
    expect(hrDetail.voteComment).toBe('内部依据');
  });

  it('shows resubmission history but hides internal attachment events from the employee', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, employeeId, managerId, hrId,
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      status: ConfirmationStatus.submitted, employee: { id: employeeId, name: employee.name },
    });
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'log-1', action: 'confirmation_returned_for_supplement', createdAt: new Date(),
        oldValue: { submissionVersion: 1, summary: '原工作小结', managerComment: '主管旧评价',
          managerRecommendation: true, voteComment: '内部评议依据', hrComment: 'HR 旧意见' },
        newValue: { reason: '请补充项目结果' }, user: { name: '直属主管' } },
      { id: 'log-2', action: 'confirmation_employee_submitted', createdAt: new Date(),
        oldValue: { submissionVersion: 1 }, newValue: { submissionVersion: 2 }, user: { name: employee.name } },
      { id: 'log-3', action: 'confirmation_meeting_attachment_added', createdAt: new Date(),
        oldValue: null, newValue: { name: '内部材料.pdf' }, user: { name: 'HR' } },
      { id: 'log-4', action: 'confirmation_company_approver_corrected', createdAt: new Date(),
        oldValue: { submissionVersion: 2 },
        newValue: { submissionVersion: 2, reason: '按最新组织审批链更正为李宏' }, user: null },
    ]);
    const employeeDetail = await service.findOne('33333333-3333-4333-8333-333333333333', viewer);
    expect(employeeDetail.history.map((event) => event.label)).toEqual(['退回员工补充', '员工提交申请', '分管审批人已更正']);
    expect(employeeDetail.history[1].submissionVersion).toBe(2);
    expect(employeeDetail.history[0].snapshot).toEqual({ summary: '原工作小结' });
    expect(employeeDetail.history[2].note).toBe('按最新组织审批链更正为李宏');
    expect(JSON.stringify(employeeDetail.history)).not.toContain('内部材料');
    const hrDetail = await service.findOne('33333333-3333-4333-8333-333333333333', { ...viewer, id: hrId, sysRole: SysRole.hr });
    expect(hrDetail.history).toHaveLength(4);
    expect(hrDetail.history[0].snapshot).toMatchObject({ summary: '原工作小结', managerComment: '主管旧评价', voteComment: '内部评议依据' });
  });

  it('lets the actual HR actor backfill a date after approval without changing the decision', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.approved, hrId, voteResult: 'pass', meetingDate: null,
    });
    const date = new Date('2026-09-12T00:00:00.000Z');
    await expect(service.backfillMeetingDate('33333333-3333-4333-8333-333333333333', { meetingDate: date }, viewer))
      .rejects.toThrow('仅记录评议结论的 HR');

    await service.backfillMeetingDate('33333333-3333-4333-8333-333333333333', { meetingDate: date }, { ...viewer, id: hrId, sysRole: SysRole.hr });
    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith({
      where: {
        id: '33333333-3333-4333-8333-333333333333', hrId,
        status: { in: [ConfirmationStatus.hr_approved, ConfirmationStatus.approved, ConfirmationStatus.rejected] },
        voteResult: { not: null },
      }, data: { meetingDate: date },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'confirmation_meeting_date_backfilled' }),
    }));
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not backfill a meeting date after the application is concurrently returned', async () => {
    const hrId = '44444444-4444-4444-8444-444444444444';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, status: ConfirmationStatus.hr_approved, hrId, voteResult: 'pass', meetingDate: null,
    });
    prisma.confirmationApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.backfillMeetingDate('33333333-3333-4333-8333-333333333333', {
      meetingDate: new Date('2026-09-14T00:00:00.000Z'),
    }, { ...viewer, id: hrId, sysRole: SysRole.hr })).rejects.toThrow('申请状态已变化');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('requires the company approver to confirm HR proposed date before activating the employee', async () => {
    const approverId = '55555555-5555-4555-8555-555555555555';
    const proposedDate = new Date('2026-10-01T00:00:00.000Z');
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.hr_approved, employeeId, managerId,
      hrId: '44444444-4444-4444-8444-444444444444', companyApproverId: approverId,
      proposedRegularDate: proposedDate,
    });
    await service.approve('33333333-3333-4333-8333-333333333333', {
      confirmedRegularDate: proposedDate,
      comment: '同意转正',
    } as never, { ...viewer, id: approverId });

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ConfirmationStatus.hr_approved, companyApproverId: approverId }),
      data: expect.objectContaining({ status: ConfirmationStatus.approved, actualRegularDate: proposedDate }),
    }));
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: employeeId, status: UserStatus.probation }),
      data: { actualRegularDate: proposedDate, status: UserStatus.active },
    }));
  });

  it('keeps the employee on probation when the company approver declines without an optional reason', async () => {
    const approverId = '55555555-5555-4555-8555-555555555555';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      status: ConfirmationStatus.hr_approved, submissionVersion: 1, employeeId,
      hrId: '44444444-4444-4444-8444-444444444444', companyApproverId: approverId,
    });
    await service.reject('33333333-3333-4333-8333-333333333333', {}, { ...viewer, id: approverId });

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ConfirmationStatus.rejected, rejectReason: null }),
    }));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: employeeId, type: 'confirmation_declined', extraData: { applicationId: '33333333-3333-4333-8333-333333333333' },
    }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: '44444444-4444-4444-8444-444444444444', type: 'confirmation_declined',
    }));
  });

  it('marks the company step as declined in a rejected application detail', async () => {
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      workflowVersion: 2, status: ConfirmationStatus.rejected, employeeId, managerId,
      hrId: '44444444-4444-4444-8444-444444444444',
      companyApproverId: '55555555-5555-4555-8555-555555555555',
      employee: { id: employeeId, name: employee.name },
      managerApprovedAt: new Date(), hrApprovedAt: new Date(), rejectedAt: new Date(),
    });
    const detail = await service.findOne('33333333-3333-4333-8333-333333333333', viewer);
    expect(detail.steps.find((step) => step.role === 'company')).toMatchObject({ status: 'rejected', actedAt: expect.any(Date) });
  });

  it('returns an HR-reviewed application to the employee and clears old approvals for a fresh round', async () => {
    const approverId = '55555555-5555-4555-8555-555555555555';
    prisma.confirmationApplication.findUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', workflowVersion: 2,
      submissionVersion: 1, status: ConfirmationStatus.hr_approved,
      employeeId, managerId, hrId: '44444444-4444-4444-8444-444444444444', companyApproverId: approverId,
      summary: '原工作小结', managerRecommendation: true, managerComment: '原主管意见',
      hrComment: '原 HR 意见', voteResult: 'pass', voteComment: '原结论依据',
      meetingDate: null, proposedRegularDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    await service.returnForSupplement('33333333-3333-4333-8333-333333333333', {
      reason: '请补充项目结果',
    }, { ...viewer, id: approverId });

    expect(prisma.confirmationApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ConfirmationStatus.draft,
        returnReason: '请补充项目结果',
        managerRecommendation: null,
        voteResult: null,
        proposedRegularDate: null,
      }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'confirmation_returned_for_supplement',
        oldValue: expect.objectContaining({ voteComment: '原结论依据', submissionVersion: 1 }),
      }),
    }));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
