import { ForbiddenException } from '@nestjs/common';
import { LegacyTaskAttachmentsService } from './legacy-task-attachments.service';

describe('legacy performance attachment authorization', () => {
  const key = 'uploads/2026/11/16/file.pdf';
  const url = `/storage/download?key=${encodeURIComponent(key)}`;
  const viewer = (id: string, extra = {}) => ({ id, sysRole: 'employee', canViewAll: false, ...extra }) as any;
  const task = (extra = {}) => ({
    employeeId: 'employee', managerId: 'manager', deptHeadId: 'head', approverId: 'approver',
    status: 'manager_scoring', approvedAt: null, publishedAt: null, gradeResult: null,
    cycle: { publishVisibleFields: { manager_comment: true } }, ...extra,
  });
  let db: any;
  let storage: any;
  let service: LegacyTaskAttachmentsService;
  beforeEach(() => {
    db = {
      selfEvalSummary: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      managerEvalSummary: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    };
    storage = { statObject: jest.fn().mockResolvedValue({ metaData: {} }) };
    service = new LegacyTaskAttachmentsService(db, storage);
  });

  it('denies a known legacy key to an unrelated authenticated employee', async () => {
    db.selfEvalSummary.findMany.mockResolvedValue([{ task: task() }]);
    await expect(service.assertDownload(key, viewer('other'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.statObject).not.toHaveBeenCalled();
  });
  it.each(['employee', 'manager', 'head', 'approver'])('preserves task relation access for %s', async (id) => {
    db.selfEvalSummary.findMany.mockResolvedValue([{ task: task() }]);
    await expect(service.assertDownload(key, viewer(id))).resolves.toBeUndefined();
    expect(db.selfEvalSummary.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.arrayContaining([{ attachments: { array_contains: [{ url }] } }]) },
    }));
  });
  it.each(['hr', 'system_admin'])('preserves existing global role %s', async (sysRole) => {
    db.selfEvalSummary.findMany.mockResolvedValue([{ task: task() }]);
    await expect(service.assertDownload(key, viewer('global', { sysRole }))).resolves.toBeUndefined();
  });
  it('a removed manager cannot fall back to historical uploader ownership', async () => {
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'former-manager' } });
    db.managerEvalSummary.findMany.mockResolvedValue([{ task: task() }]);
    await expect(service.assertDownload(key, viewer('former-manager'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([
    task(),
    task({ status: 'published', cycle: { publishVisibleFields: { manager_comment: false } } }),
  ])('does not bypass employee result visibility', async (record) => {
    db.managerEvalSummary.findMany.mockResolvedValue([{ task: record }]);
    await expect(service.assertDownload(key, viewer('employee'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows visible approved manager materials and own unpublished upload previews', async () => {
    db.managerEvalSummary.findMany.mockResolvedValue([{ task: task({ status: 'approval', approvedAt: new Date() }) }]);
    await expect(service.assertDownload(key, viewer('employee'))).resolves.toBeUndefined();
    db.managerEvalSummary.findMany.mockResolvedValue([]);
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'employee' } });
    await expect(service.assertDownload(key, viewer('employee'))).resolves.toBeUndefined();
    await expect(service.assertDownload(key, viewer('other'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('fails closed for unbound ownerless legacy files and unknown prefixes', async () => {
    await expect(service.assertDownload(key, viewer('employee'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertDownload('other/private.pdf', viewer('employee', { sysRole: 'hr' }))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('retains a saved historical reference without requiring new metadata', async () => {
    db.selfEvalSummary.findUnique.mockResolvedValue({ attachments: [{ url }] });
    await expect(service.assertCanAttach('task', 'self', [{ url }], viewer('employee'))).resolves.toBeUndefined();
    expect(storage.statObject).not.toHaveBeenCalled();
  });
  it('rejects a stolen reference before it can create a download grant', async () => {
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'other' } });
    await expect(service.assertCanAttach('task', 'self', [{ url }], viewer('employee'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertCanAttach('task', 'manager', [{ url }], viewer('manager'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('cannot reattach a formerly owned bound file after losing its task permission', async () => {
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'former-manager' } });
    db.managerEvalSummary.findMany.mockResolvedValue([{ task: task() }]);
    await expect(service.assertCanAttach('own-task', 'self', [{ url }], viewer('former-manager'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects URL variants that cannot be resolved by the persisted-reference lookup', async () => {
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'employee' } });
    for (const variant of [`${url}&download=1`, `${url}#attachment`]) {
      await expect(service.assertCanAttach('task', 'self', [{ url: variant }], viewer('employee'))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
  it('accepts own new files, rejects external and protected-prefix links', async () => {
    storage.statObject.mockResolvedValue({ metaData: { 'hrm-uploader': 'employee' } });
    await expect(service.assertCanAttach('task', 'self', [{ url }], viewer('employee'))).resolves.toBeUndefined();
    for (const invalid of ['https://other.test/file', '/storage/download?key=confirmation-internal/file', '/storage/download?key=uploads/a&key=uploads/b']) {
      await expect(service.assertCanAttach('task', 'self', [{ url: invalid }], viewer('employee'))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
