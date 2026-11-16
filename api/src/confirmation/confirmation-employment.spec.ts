import { ConfirmationService } from './confirmation.service';
import { EmployeeEffectiveDateService } from '@/employee-archives/employee-effective-date.service';

describe('confirmation follows the approved employment', () => {
  const at = new Date('2026-11-16T04:00:00.000Z');
  const regularDate = new Date('2026-11-16T00:00:00.000Z');
  const viewer = { id: 'employee', sysRole: 'employee' } as any;
  const approver = { id: 'company-approver', sysRole: 'employee' } as any;

  function fixture() {
    const user: any = { id: viewer.id, name: '虚构员工', employeeNo: 'QA-101', accountType: 'employee',
      status: 'probation', deletedAt: null, archivedAt: null, deptId: 'department', positionId: null,
      position: '虚构岗位', directManagerId: 'performance-manager', employmentType: 'full_time',
      entryDate: new Date('2026-09-01T00:00:00.000Z'), plannedRegularDate: regularDate,
      actualRegularDate: null, leaveDate: null };
    const employment: any = { id: 'employment-current', userId: user.id, employeeNo: user.employeeNo,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null, company: null,
      companyText: '虚构公司', contractSubjectId: null, deptId: user.deptId, positionId: null,
      position: user.position, directManagerId: 'roster-manager', employmentType: user.employmentType,
      employeeStatus: 'probation', entryDate: user.entryDate, plannedRegularDate: regularDate,
      actualRegularDate: null, leaveDate: null, jobGrade: null, jobFamily: null, workLocation: null,
      probationMonths: 3, changeType: 'hire', reason: null, sourceType: null, sourceRequestId: null,
      sourceBatchId: null, createdById: null, createdAt: user.entryDate, updatedAt: user.entryDate };
    const records = [employment];
    const app: any = { id: 'application', workflowVersion: 2, status: 'hr_approved', employeeId: user.id,
      employmentRecordId: employment.id, managerId: 'frozen-roster-manager', hrId: 'hr',
      companyApproverId: approver.id, proposedRegularDate: regularDate, submissionVersion: 1,
      summary: '虚构工作小结', createdAt: new Date('2026-11-01T00:00:00.000Z') };
    Object.assign(app, { employee: user, voteResult: 'pass', meetingDate: null, meetingAttachments: [] });
    const attachments: any[] = [];
    const prisma: any = {
      user: {
        findMany: jest.fn(async () => [{ ...user }]),
        count: jest.fn(async () => 1),
        findUnique: jest.fn(async ({ where }: any) => where.id === user.id ? { ...user }
          : { id: where.id, status: 'active', deletedAt: null, archivedAt: null, accountType: 'employee' }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.id !== user.id || (where.status && where.status !== user.status)
            || (where.employeeNo && where.employeeNo !== user.employeeNo)) return { count: 0 };
          Object.assign(user, data); return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
      },
      employmentRecord: {
        findMany: jest.fn(async () => records),
        findFirst: jest.fn(async () => records.find(record => record.effectiveFrom <= regularDate
          && (!record.effectiveTo || record.effectiveTo >= regularDate)) ?? null),
        findUnique: jest.fn(async ({ where }: any) => records.find(record => record.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(records.find(record => record.id === where.id)!, data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const found = records.find(record => record.id === where.id
            && (!where.employeeStatus || record.employeeStatus === where.employeeStatus));
          if (!found) return { count: 0 };
          Object.assign(found, data); return { count: 1 };
        }),
        create: jest.fn(async ({ data }: any) => { const record = { ...data, id: 'employment-confirmation' }; records.push(record); return record; }),
      },
      confirmationApplication: {
        findUnique: jest.fn(async () => ({ ...app })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!Object.entries(where).every(([key, value]: [string, any]) => value === undefined
            || (value?.in ? value.in.includes(app[key]) : value?.not !== undefined ? app[key] !== value.not
              : value instanceof Date ? app[key]?.getTime() === value.getTime() : app[key] === value))) return { count: 0 };
          for (const [key, value] of Object.entries(data)) app[key] = (value as any)?.increment ? app[key] + (value as any).increment : value;
          return { count: 1 };
        }),
      },
      confirmationMeetingAttachment: { create: jest.fn(async ({ data }: any) => {
        const attachment = { id: 'attachment', ...data }; attachments.push(attachment); return attachment;
      }) },
      employeeDataChangeRequest: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      position: { findMany: jest.fn(async () => []) },
      department: { findMany: jest.fn(async () => [{ id: 'department', name: '虚构部门', parentId: null,
        leaderId: null, approverId: approver.id, leader: null, approver: null }]) },
      auditLog: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (work: ((tx: any) => Promise<any>) | Promise<any>[]) => {
        if (Array.isArray(work)) return Promise.all(work);
        const before = structuredClone({ user, records, app });
        try { return await work(prisma); } catch (error) {
          Object.assign(user, before.user); Object.assign(app, before.app);
          records.splice(0, records.length, ...before.records); throw error;
        }
      }),
    };
    const notifications = { create: jest.fn(async () => ({})) };
    const storage = { uploadFile: jest.fn(async () => ({ url: '/download?key=confirmation-internal/synthetic.pdf',
      name: 'synthetic.pdf', size: 1, mimeType: 'application/pdf' })), removeObject: jest.fn(async () => {}) };
    const service = new ConfirmationService(prisma, storage as any,
      { getConfirmationEmployeeFilter: async () => ({}) } as any, notifications as any);
    return { service, prisma, user, employment, records, app, notifications, storage, attachments,
      refresh: (time = at) => new EmployeeEffectiveDateService(prisma).refreshUserProjection(user.id, time) };
  }

  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(at); });
  afterEach(() => jest.useRealTimers());

  it('keeps the employee regular after approval and the next real employment projection refresh', async () => {
    const f = fixture();
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver);
    await f.refresh();
    expect(f.app.status).toBe('approved');
    expect(f.user).toMatchObject({ status: 'active', actualRegularDate: regularDate });
    expect(f.employment).toMatchObject({ employeeStatus: 'probation', actualRegularDate: null,
      effectiveTo: new Date('2026-11-15T00:00:00.000Z') });
    expect(f.records[1]).toMatchObject({ employeeStatus: 'active', actualRegularDate: regularDate,
      effectiveFrom: regularDate, sourceRequestId: null });
  });

  it('submits to the current employment roster manager when the performance manager differs', async () => {
    const f = fixture();
    Object.assign(f.app, { status: 'draft', submissionVersion: 0, employmentRecordId: null });
    await f.service.submit(f.app.id, viewer, { submissionVersion: f.app.submissionVersion });
    expect(f.app).toMatchObject({ status: 'submitted', managerId: 'roster-manager', employmentRecordId: 'employment-current' });
    expect(f.user.directManagerId).toBe('performance-manager');
  });

  it('uses the stable current selection despite a historical overlapping employment', async () => {
    const f = fixture();
    Object.assign(f.app, { status: 'draft', submissionVersion: 0 });
    const older = { ...f.employment, id: 'older-overlap', directManagerId: 'old-manager',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z') };
    f.records.unshift(older);
    await f.service.submit(f.app.id, viewer, { submissionVersion: f.app.submissionVersion });
    expect(f.app.managerId).toBe('roster-manager');
    Object.assign(f.app, { status: 'hr_approved', proposedRegularDate: regularDate });
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate } as any, approver);
    await f.refresh();
    expect(f.user.status).toBe('active');
    expect(older).toMatchObject({ employeeStatus: 'probation', effectiveTo: null, actualRegularDate: null });
  });

  it('does not block confirmation because a closed historical overlap intersects a past regular date', async () => {
    const f = fixture();
    const old = { ...f.employment, id: 'older-closed-overlap', effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-11-12T00:00:00.000Z') };
    f.records.unshift(old);
    const past = new Date('2026-11-10T00:00:00.000Z');
    f.app.proposedRegularDate = past;
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: past } as any, approver);
    expect(f.app.status).toBe('approved');
    expect(old.actualRegularDate).toBeNull();
  });

  it('reads employment inside the per-user batch transaction after an intervening confirmation', async () => {
    const f = fixture();
    f.prisma.employmentRecord.findMany.mockImplementation(async () => structuredClone(f.records));
    f.prisma.user.findMany.mockImplementationOnce(async () => {
      const users = [{ ...f.user }];
      await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate } as any, approver);
      return users;
    });
    await new EmployeeEffectiveDateService(f.prisma).refreshEffectiveProjections(at);
    expect(f.app.status).toBe('approved');
    expect(f.user).toMatchObject({ status: 'active', actualRegularDate: regularDate });
  });

  it.each(['manager approval', 'HR approval', 'manager return', 'HR return', 'company return', 'company rejection'] as const)(
    'rejects a stale %s after the request was returned and resubmitted', async (action) => {
      const f = fixture();
      const manager = { id: f.app.managerId, sysRole: 'employee' } as any;
      const hr = { id: 'hr', sysRole: 'hr_user', hrCapabilities: ['confirmation_manage'] } as any;
      f.app.status = action.startsWith('manager') ? 'submitted' : action.startsWith('HR') ? 'manager_approved' : 'hr_approved';
      f.prisma.confirmationApplication.findUnique.mockImplementationOnce(async () => {
        const snapshot = { ...f.app };
        f.app.submissionVersion = 2;
        f.app.employmentRecordId = 'resubmitted-employment';
        return snapshot;
      });
      const operation = action === 'manager approval'
        ? f.service.approve(f.app.id, { submissionVersion: 1, recommendation: true, comment: '第一轮意见' } as any, manager)
        : action === 'HR approval' ? f.service.approve(f.app.id, { submissionVersion: 1, voteResult: 'pass', voteComment: '第一轮依据', proposedRegularDate: regularDate } as any, hr)
        : action === 'company rejection' ? f.service.reject(f.app.id, { submissionVersion: 1 } as any, approver)
        : f.service.returnForSupplement(f.app.id, { submissionVersion: 1, reason: '第一轮退回' } as any,
          action === 'manager return' ? manager : action === 'HR return' ? hr : approver);
      await expect(operation).rejects.toThrow('申请状态已变化');
      expect(f.app.submissionVersion).toBe(2);
      expect(f.app.employmentRecordId).toBe('resubmitted-employment');
      expect(f.notifications.create).not.toHaveBeenCalled();
    });

  it.each([undefined, 0, 2])('rejects final approval from a page with missing or stale round %s', async (submissionVersion) => {
    const f = fixture();
    await expect(f.service.approve(f.app.id, { submissionVersion, confirmedRegularDate: regularDate } as any, approver))
      .rejects.toThrow('申请状态已变化');
    expect(f.app.status).toBe('hr_approved');
  });

  it.each(['approval', 'return', 'rejection', 'attachment'] as const)(
    'reports a stale round for %s even after the application has returned to draft', async (action) => {
      const f = fixture();
      Object.assign(f.app, { status: 'draft', submissionVersion: 2 });
      const hr = { id: 'hr', sysRole: 'hr_user', hrCapabilities: ['confirmation_manage'] } as any;
      const operation = action === 'approval'
        ? f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)
        : action === 'return' ? f.service.returnForSupplement(f.app.id, { submissionVersion: 1, reason: '旧轮次意见' }, approver)
        : action === 'rejection' ? f.service.reject(f.app.id, { submissionVersion: 1 }, approver)
        : f.service.addMeetingAttachment(f.app.id, {} as any, hr, { submissionVersion: 1 });
      await expect(operation).rejects.toMatchObject({ status: 409 });
      expect(f.prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
      expect(f.storage.uploadFile).not.toHaveBeenCalled();
    });

  it.each(['approval', 'return', 'rejection', 'attachment'] as const)(
    'preserves access denial for an unrelated viewer attempting a stale %s', async (action) => {
      const f = fixture();
      const unrelated = { id: 'unrelated', sysRole: 'employee' } as any;
      const operation = action === 'approval'
        ? f.service.approve(f.app.id, { submissionVersion: 0, confirmedRegularDate: regularDate }, unrelated)
        : action === 'return' ? f.service.returnForSupplement(f.app.id, { submissionVersion: 0, reason: '无权意见' }, unrelated)
        : action === 'rejection' ? f.service.reject(f.app.id, { submissionVersion: 0 }, unrelated)
        : f.service.addMeetingAttachment(f.app.id, {} as any, unrelated, { submissionVersion: 0 });
      await expect(operation).rejects.toMatchObject({ status: 403 });
      expect(f.prisma.confirmationApplication.updateMany).not.toHaveBeenCalled();
      expect(f.storage.uploadFile).not.toHaveBeenCalled();
    });

  it.each(['draft update', 'meeting date', 'attachment upload'] as const)(
    'rejects a stale in-flight %s when a newer submission already exists', async (action) => {
      const f = fixture();
      const hr = { id: 'hr', sysRole: 'hr_user', hrCapabilities: ['confirmation_manage'] } as any;
      f.app.status = action === 'draft update' ? 'draft' : action === 'meeting date' ? 'hr_approved' : 'manager_approved';
      f.prisma.confirmationApplication.findUnique.mockImplementationOnce(async () => {
        const snapshot = { ...f.app };
        f.app.submissionVersion = 2;
        f.app.employmentRecordId = 'new-round-employment';
        return snapshot;
      });
      const operation = action === 'draft update'
        ? f.service.update(f.app.id, { submissionVersion: 1, summary: '旧页面内容' } as any, viewer)
        : action === 'meeting date' ? f.service.backfillMeetingDate(f.app.id, { submissionVersion: 1, meetingDate: regularDate } as any, hr)
        : (f.service.addMeetingAttachment as any)(f.app.id, {} as any, hr, { submissionVersion: 1 });
      await expect(operation).rejects.toThrow('申请状态已变化');
      expect(f.app.submissionVersion).toBe(2);
      expect(f.attachments).toHaveLength(0);
      if (action === 'attachment upload') expect(f.storage.removeObject).toHaveBeenCalledWith('confirmation-internal/synthetic.pdf');
    });

  it.each(['draft update', 'submit', 'meeting date', 'attachment upload'] as const)(
    'rejects %s from a page that opened before the current submission round', async (action) => {
      const f = fixture();
      const hr = { id: 'hr', sysRole: 'hr_user', hrCapabilities: ['confirmation_manage'] } as any;
      f.app.status = action === 'draft update' || action === 'submit' ? 'draft'
        : action === 'meeting date' ? 'hr_approved' : 'manager_approved';
      const operation = action === 'draft update'
        ? f.service.update(f.app.id, { submissionVersion: 0, summary: '旧页面内容' } as any, viewer)
        : action === 'submit' ? (f.service.submit as any)(f.app.id, viewer, { submissionVersion: 0 })
        : action === 'meeting date' ? f.service.backfillMeetingDate(f.app.id, { submissionVersion: 0, meetingDate: regularDate } as any, hr)
        : (f.service.addMeetingAttachment as any)(f.app.id, {} as any, hr, { submissionVersion: 0 });
      await expect(operation).rejects.toThrow('申请状态已变化');
      expect(f.storage.uploadFile).not.toHaveBeenCalled();
      expect(f.attachments).toHaveLength(0);
    });

  it('does not change a submitted manager snapshot when the current roster manager changes', async () => {
    const f = fixture();
    f.employment.directManagerId = 'new-roster-manager';
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver);
    expect(f.app.managerId).toBe('frozen-roster-manager');
  });

  it('does not apply an old application to a subsequent employment number', async () => {
    const f = fixture();
    f.user.employeeNo = 'QA-202';
    f.records.push({ ...f.employment, id: 'employment-reentry', employeeNo: 'QA-202',
      effectiveFrom: new Date('2026-11-01T00:00:00.000Z') });
    f.employment.effectiveTo = new Date('2026-10-31T00:00:00.000Z');
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)).rejects.toThrow();
    expect(f.app.status).toBe('hr_approved');
    expect(f.user.status).toBe('probation');
    expect(f.records[1].employeeStatus).toBe('probation');
  });

  it('keeps a future approval on probation until its calendar effective date', async () => {
    const f = fixture();
    const future = new Date('2026-11-20T00:00:00.000Z');
    f.app.proposedRegularDate = future;
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: future }, approver);
    await f.refresh();
    expect(f.user).toMatchObject({ status: 'probation', actualRegularDate: null });
    expect(f.employment.effectiveTo).toEqual(new Date('2026-11-19T00:00:00.000Z'));
    await f.refresh(new Date('2026-11-20T00:00:00.000Z'));
    expect(f.user).toMatchObject({ status: 'active', actualRegularDate: future });
  });

  it('retains a scheduled resignation boundary when a future confirmation fits before it', async () => {
    const f = fixture();
    const future = new Date('2026-11-20T00:00:00.000Z');
    const end = new Date('2026-11-25T00:00:00.000Z');
    f.app.proposedRegularDate = future;
    f.employment.effectiveTo = end;
    const resignation = { ...f.employment, id: 'employment-resignation', effectiveFrom: new Date('2026-11-26T00:00:00.000Z'),
      effectiveTo: null, employeeStatus: 'resigned' };
    f.records.push(resignation);
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: future }, approver);
    expect(f.records[2]).toMatchObject({ effectiveFrom: future, effectiveTo: end, employeeStatus: 'active' });
    expect(resignation).toMatchObject({ effectiveFrom: new Date('2026-11-26T00:00:00.000Z'), employeeStatus: 'resigned' });
    await f.refresh(new Date('2026-11-20T00:00:00.000Z'));
    expect(f.user.status).toBe('active');
  });

  it('rejects a regular date after the current employment ends', async () => {
    const f = fixture();
    f.employment.effectiveTo = new Date('2026-11-19T00:00:00.000Z');
    const future = new Date('2026-11-20T00:00:00.000Z');
    f.app.proposedRegularDate = future;
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: future }, approver)).rejects.toMatchObject({
      response: { data: { fieldErrors: { proposedRegularDate: expect.any(String) } } },
    });
    expect(f.records).toHaveLength(1);
    expect(f.app.status).toBe('hr_approved');
  });

  it('requires a real roster manager instead of falling back to the performance manager', async () => {
    const f = fixture();
    Object.assign(f.app, { status: 'draft', submissionVersion: 0 });
    f.employment.directManagerId = null;
    await expect(f.service.submit(f.app.id, viewer, { submissionVersion: f.app.submissionVersion })).rejects.toThrow('花名册直属主管');
    expect(f.app.status).toBe('draft');
  });

  it('preserves the probation interval before a past regular date', async () => {
    const f = fixture();
    const past = new Date('2026-11-10T00:00:00.000Z');
    f.app.proposedRegularDate = past;
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: past }, approver);
    expect(f.employment).toMatchObject({ employeeStatus: 'probation', actualRegularDate: null,
      effectiveTo: new Date('2026-11-09T00:00:00.000Z') });
    expect(f.records[1]).toMatchObject({ employeeStatus: 'active', effectiveFrom: past, actualRegularDate: past });
  });

  it('keeps earlier closed employment records unchanged when confirming a later correction', async () => {
    const f = fixture();
    const original = { ...f.employment, effectiveTo: new Date('2026-11-11T00:00:00.000Z') };
    Object.assign(f.employment, { id: 'employment-correction', effectiveFrom: new Date('2026-11-12T00:00:00.000Z') });
    f.records.unshift(original);
    const past = new Date('2026-11-10T00:00:00.000Z');
    f.app.proposedRegularDate = past;
    await f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: past }, approver);
    expect(original).toMatchObject({ employeeStatus: 'probation', actualRegularDate: null,
      effectiveTo: new Date('2026-11-11T00:00:00.000Z') });
    expect(f.employment).toMatchObject({ employeeStatus: 'active', actualRegularDate: past });
  });

  it('rejects a conflicting scheduled employment without changing the approval or either interval', async () => {
    const f = fixture();
    const scheduled = { ...f.employment, id: 'employment-scheduled', effectiveFrom: new Date('2026-11-22T00:00:00.000Z') };
    f.records.push(scheduled);
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)).rejects.toMatchObject({
      response: { data: { fieldErrors: { proposedRegularDate: expect.any(String) } } },
    });
    expect(f.app.status).toBe('hr_approved');
    expect(f.employment.effectiveTo).toBeNull();
    expect(scheduled.employeeStatus).toBe('probation');
  });

  it('rejects an approval without a trustworthy employment identity and permits returning it', async () => {
    const f = fixture();
    f.app.employmentRecordId = null;
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)).rejects.toThrow('退回');
    await f.service.returnForSupplement(f.app.id, { submissionVersion: 1, reason: '请确认本次任职后重新提交' }, approver);
    expect(f.app.status).toBe('draft');
    expect(f.user.status).toBe('probation');
  });

  it('rolls back application and employment changes when updating the current account fails', async () => {
    const f = fixture();
    f.prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)).rejects.toThrow();
    expect(f.app.status).toBe('hr_approved');
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({ employeeStatus: 'probation', effectiveTo: null });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it.each(['submission', 'company approval'] as const)('maps a serialization conflict during %s to a refreshable conflict', async action => {
    const f = fixture();
    if (action === 'submission') Object.assign(f.app, { status: 'draft', submissionVersion: 0 });
    f.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    const operation = action === 'submission'
      ? f.service.submit(f.app.id, viewer, { submissionVersion: 0 })
      : f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver);
    await expect(operation).rejects.toMatchObject({ status: 409 });
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it('rolls back employment changes when a concurrent return invalidates final approval', async () => {
    const f = fixture();
    f.prisma.confirmationApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.approve(f.app.id, { submissionVersion: 1, confirmedRegularDate: regularDate }, approver)).rejects.toThrow('申请状态已变化');
    expect(f.user).toMatchObject({ status: 'probation', actualRegularDate: null });
    expect(f.records).toHaveLength(1);
    expect(f.records[0].effectiveTo).toBeNull();
    expect(f.notifications.create).not.toHaveBeenCalled();
  });
});
