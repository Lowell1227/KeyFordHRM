import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { EmployeeArchiveIssuesService } from './employee-archive-issues.service';

const editor = { id: 'editor-1', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] } as AuthUser;
const reviewer = { ...editor, hrCapabilities: ['employee_archive_review'] };
function fixture(warning = { field: 'employee.companyText', code: 'conflict', kind: 'conflict', message: 'Company requires confirmation', sourceValue: 'Source company' }) {
  const record: any = { id: 'request-1', userId: 'employee-1', requestVersion: 1, sourceSystem: 'roster_initialization',
    profileReviewStatus: 'approved', appliedAt: new Date(), recordStatus: 'submitted', archivedAt: null, cancelledAt: null,
    proposedValue: {}, validationWarnings: [warning] };
  const user: any = { id: 'employee-1', employeeNo: 'SYNTHETIC-1', employeeProfile: { phone: null }, employeeContracts: [], employmentHistory: [{
    id: 'employment-1', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, companyText: 'Current company',
  }] };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: record.id }]),
    user: { findUnique: jest.fn(async () => user) },
    employeeDataChangeRequest: { findUnique: jest.fn(async () => record), findMany: jest.fn(async () => [record]),
      update: jest.fn(async ({ data }) => Object.assign(record, data)) },
    auditLog: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
  return { service: new EmployeeArchiveIssuesService(prisma as any), prisma, tx, record, user };
}

describe('shared archive issue authorization and confirmation', () => {
  it('rejects employees including spoofed HR capability claims before any record query', async () => {
    const { service, tx, prisma } = fixture();
    const employee = { ...editor, sysRole: SysRole.employee };
    await expect(service.listForEmployee('employee-1', employee)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.confirmCurrent('request-1', 'issue', 'a'.repeat(64), employee)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('gives review-only HR a read projection without a write action', async () => {
    const { service, prisma } = fixture();
    const result = await service.listForRequest('request-1', reviewer);
    expect(result.items[0].canConfirmCurrent).toBe(false);
    expect(result.items[0].confirmBlockedReason).toContain('维护权限');
    await expect(service.confirmCurrent('request-1', result.items[0].id, result.items[0].fingerprint, reviewer)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses the legacy internal phone fact consistently in request and employee detail without exposing it', async () => {
    const { service, tx, user } = fixture({ field: 'phone', code: 'missing', kind: 'missing', message: 'Contact missing', sourceValue: '' });
    user.phone = 'synthetic-formal-contact';
    expect((await service.listForRequest('request-1', editor)).items).toEqual([]);
    expect((await service.listForEmployee('employee-1', editor)).items).toEqual([]);
    expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ phone: true }) }));
    user.phone = null;
    const result = await service.listForRequest('request-1', editor);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].current.value).toBeNull();
    expect(JSON.stringify(result)).not.toContain('synthetic-formal-contact');
  });

  it('updates only the issue resolution, audits once, and repeats without any write', async () => {
    const { service, tx, record, user } = fixture();
    const { items: [issue] } = await service.listForRequest('request-1', editor);
    const base = JSON.stringify(record.proposedValue);
    expect(await service.confirmCurrent(record.id, issue.id, issue.fingerprint, editor)).toMatchObject({ alreadyConfirmed: false });
    expect(tx.employeeDataChangeRequest.update.mock.calls[0][0].data).toEqual({ validationWarnings: expect.any(Array) });
    expect(record.validationWarnings[0].resolution).toMatchObject({ decision: 'keep_current', by: editor.id, warningSourceDigest: expect.any(String) });
    expect(JSON.stringify(record.proposedValue)).toBe(base);
    user.employmentHistory[0].companyText = 'A later normal company change';
    record.requestVersion++;
    expect((await service.listForRequest(record.id, editor)).items).toEqual([]);
    expect(await service.confirmCurrent(record.id, issue.id, issue.fingerprint, editor)).toMatchObject({ alreadyConfirmed: true });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeDataChangeRequest.update).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects an old popup when the current formal fact changed before the first confirmation', async () => {
    const { service, tx, user } = fixture();
    const { items: [issue] } = await service.listForRequest('request-1', editor);
    user.employmentHistory[0].companyText = 'Changed by another HR';
    await expect(service.confirmCurrent('request-1', issue.id, issue.fingerprint, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not resolve missing fields by confirming the current empty value', async () => {
    const { service, tx } = fixture({ field: 'profile.phone', code: 'missing', kind: 'missing', message: 'Phone missing', sourceValue: '' });
    const { items: [issue] } = await service.listForRequest('request-1', editor);
    await expect(service.confirmCurrent('request-1', issue.id, issue.fingerprint, editor)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
  });

  it('uses serializable confirmation and reports a database race without automatic retry or replay', async () => {
    const { service, tx, prisma } = fixture();
    const { items: [issue] } = await service.listForRequest('request-1', editor);
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(service.confirmCurrent('request-1', issue.id, issue.fingerprint, editor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(tx.employeeDataChangeRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
