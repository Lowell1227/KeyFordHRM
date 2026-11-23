import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { EmployeeArchiveIssuesService } from './employee-archive-issues.service';
const editor: any = { id: 'hr-1', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] };
function fixture() {
  const u: any = { id: 'employee-1', accountType: 'employee', archivedAt: null, deletedAt: null, status: 'active',
    entryDate: null, deptId: 'dept', employeeContracts: [{ id: 'c', isActive: true, effectiveFrom: new Date('2020-01-01'), expiresAt: new Date('2035-01-01') }] };
  let exemption: any = null;
  const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ id: u.id }]),
    user: { findUnique: jest.fn().mockResolvedValue(u) }, employeeDataChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    employeeArchiveIssueExemption: { findMany: jest.fn(async () => exemption ? [exemption] : []), findUnique: jest.fn(async () => exemption),
      create: jest.fn(async ({ data }) => exemption = { ...data, id: 'exemption-1', version: 1 }),
      updateMany: jest.fn(async ({ where, data }) => { if (!exemption || where.version !== exemption.version) return { count: 0 };exemption = { ...exemption, ...data, version: exemption.version + 1 };return { count: 1 }; }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) } };
  const prisma: any = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
  return { service: new EmployeeArchiveIssuesService(prisma), tx, u, state: () => exemption };
}
describe('reversible current issue exemptions', () => {
  it('automatically removes corrected issues without creating exemption state', async () => {
    const { service, u, tx } = fixture();expect((await service.listForEmployee(u.id, editor)).items).toHaveLength(1);
    u.entryDate = new Date('2020-01-01');expect((await service.listForEmployee(u.id, editor)).items).toEqual([]);
    expect(tx.employeeArchiveIssueExemption.create).not.toHaveBeenCalled();expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('lets HR check and uncheck exemption without changing formal employee data', async () => {
    const { service, u, tx } = fixture();const issue = (await service.listForEmployee(u.id, editor)).items[0], before = JSON.stringify(u);
    expect(await service.setExemption(u.id, issue.id, issue.fingerprint, true, 0, undefined, editor)).toMatchObject({ isExempt: true, version: 1 });
    const closed = await service.listForEmployee(u.id, editor);expect(closed.items).toEqual([]);expect(closed.exemptions).toHaveLength(1);
    expect(await service.setExemption(u.id, issue.id, issue.fingerprint, false, 1, undefined, editor)).toMatchObject({ isExempt: false, version: 2 });
    expect((await service.listForEmployee(u.id, editor)).items[0]).toMatchObject({ id: issue.id });
    expect(JSON.stringify(u)).toBe(before);expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create.mock.calls[0][0].data.newValue).toMatchObject({ message: '入职日期待补充', currentValue: '未填写入职日期', field: 'employee.entryDate' });
  });
  it('retains confirmed not-applicable facts from archived approved imports without resurfacing legacy warnings', async () => {
    const { service, u, tx } = fixture();u.entryDate = new Date('2020-01-01');u.employeeContracts = [];
    tx.employeeDataChangeRequest.findMany.mockResolvedValue([{ archivedAt: new Date(), sourceSystem: 'roster_import', proposedValue: {
      hrConfirmation20261123: { questions: [{ contractApplicability: '不适用' }] },
    } }]);
    expect((await service.listForEmployee(u.id, editor)).items).toEqual([]);
    expect(tx.employeeDataChangeRequest.findMany.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
  });
  it('denies changes to review-only HR and employees', async () => {
    const { service, tx, u } = fixture();
    for (const operator of [{ ...editor, hrCapabilities: ['employee_archive_review'] }, { ...editor, sysRole: SysRole.employee }]) {
      await expect(service.setExemption(u.id, 'current:entry-missing', 'a'.repeat(64), true, 0, undefined, operator)).rejects.toBeInstanceOf(ForbiddenException);
    }expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects changed facts and changed checkbox versions', async () => {
    const { service, u, tx } = fixture();const issue = (await service.listForEmployee(u.id, editor)).items[0];
    await expect(service.setExemption(u.id, issue.id, 'a'.repeat(64), true, 0, undefined, editor)).rejects.toBeInstanceOf(ConflictException);
    await service.setExemption(u.id, issue.id, issue.fingerprint, true, 0, '保留现状', editor);
    await expect(service.setExemption(u.id, issue.id, issue.fingerprint, false, 0, undefined, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('does not create an exemption if another HR already fixed the problem', async () => {
    const { service, u, tx } = fixture();const issue = (await service.listForEmployee(u.id, editor)).items[0];u.entryDate = new Date('2020-01-01');
    expect(await service.setExemption(u.id, issue.id, issue.fingerprint, true, 0, undefined, editor)).toMatchObject({ noLongerApplies: true });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('keeps an accessible exemption after data is corrected', async () => {
    const { service, u } = fixture();const issue = (await service.listForEmployee(u.id, editor)).items[0];
    await service.setExemption(u.id, issue.id, issue.fingerprint, true, 0, '历史日期无法取得', editor);u.entryDate = new Date('2020-01-01');
    const r = await service.listForEmployee(u.id, editor);expect(r.items).toEqual([]);expect(r.exemptions[0]).toMatchObject({ noLongerApplies: true });
    await service.setExemption(u.id, issue.id, issue.fingerprint, false, 1, undefined, editor);expect((await service.listForEmployee(u.id, editor)).items).toEqual([]);
  });
  it('records the original exemption facts when canceling after related dates change', async () => {
    const { service, u, tx } = fixture();u.entryDate = new Date('2020-01-01');u.actualRegularDate = new Date('2035-02-01');
    const issue = (await service.listForEmployee(u.id, editor)).items.find(i => i.id === 'current:future-actual-dates')!;
    await service.setExemption(u.id, issue.id, issue.fingerprint, true, 0, undefined, editor);
    u.actualRegularDate = new Date('2036-02-01');
    await service.setExemption(u.id, issue.id, issue.fingerprint, false, 1, undefined, editor);
    expect(tx.auditLog.create.mock.calls[1][0].data.newValue).toMatchObject({ fingerprint: issue.fingerprint, currentValue: issue.current.value });
    expect((await service.listForEmployee(u.id, editor)).items.find(i => i.id === issue.id)?.fingerprint).not.toBe(issue.fingerprint);
  });
});
