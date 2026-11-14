import { EmployeeArchivesService } from './employee-archives.service';
import { SysRole } from '@prisma/client';

const operator = { id: 'hr', sysRole: SysRole.hr } as any;
describe('archive contract subject references', () => {
  const fixture = (id: string | null = null) => {
    const current = { id: 'user', employeeNo: '001', name: '测试', status: 'active', directManagerId: null, updatedAt: new Date('2026-01-01'),
      employeeProfile: null, employeeContracts: [], employmentHistory: [{ company: 'fuede', companyText: '原名', contractSubjectId: id }] };
    const prisma = { $transaction: jest.fn(async callback => callback(prisma)), user: { findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn(async ({ data }) => Object.assign(current, data)) }, auditLog: { create: jest.fn() },
      contractSubject: { findUnique: jest.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '服务器名称', isActive: true, internalCompany: 'fansibao' }) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ id: 'request-1', ...data })) } };
    // These tests own proposal normalization; transaction application has its own dedicated suite.
    const reviews = { applyArchiveChange: jest.fn(async () => {
      const data = prisma.employeeDataChangeRequest.create.mock.calls.at(-1)![0].data;
      return { id: 'request-1', ...data, profileReviewStatus: 'approved', appliedAt: new Date() };
    }) };
    const service = new EmployeeArchivesService(prisma as any, undefined, undefined, undefined, undefined, reviews as any);
    return { prisma, reviews, service, baseVersion: (service as any).archiveVersion(current) };
  };
  it('recognizes an ID-only selection and freezes the server name', async () => {
    const { service, baseVersion } = fixture();
    const { request: result } = await service.submitDraft('user', { baseVersion, employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '伪造名称' }, profile: {} }, operator);
    if (!result) throw new Error('expected review request');
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '服务器名称', company: 'fansibao' } });
  });
  it('keeps an existing snapshot despite a supplied replacement name and directory rename', async () => {
    const { service, prisma, baseVersion } = fixture('11111111-1111-4111-8111-111111111111');
    const { request: result } = await service.submitDraft('user', { baseVersion, employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '伪造名称', position: '新岗位' }, profile: {} }, operator);
    if (!result) throw new Error('expected review request');
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '原名' } });
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });
  it('rejects a newly selected inactive subject', async () => {
    const { service, prisma, baseVersion } = fixture();
    prisma.contractSubject.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '停用主体', isActive: false });
    await expect(service.submitDraft('user', { baseVersion, employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111' }, profile: {} }, operator)).rejects.toThrow('合同主体不存在或已停用');
  });
  it('explicit null clears reference and snapshot', async () => {
    const { service, baseVersion } = fixture('11111111-1111-4111-8111-111111111111');
    const { request: result } = await service.submitDraft('user', { baseVersion, employee: { contractSubjectId: null }, profile: {} }, operator);
    if (!result) throw new Error('expected review request');
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: null, companyText: null } });
  });
  it('rejects malformed IDs before sending them to the database', async () => {
    const { service, prisma, baseVersion } = fixture();
    await expect(service.submitDraft('user', { baseVersion, employee: { contractSubjectId: 'invalid-uuid' }, profile: {} }, operator)).rejects.toThrow('合同主体信息无效');
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });
  it('recognizes ID-only changes even when the display name is identical', async () => {
    const { service, prisma, reviews, baseVersion } = fixture();
    prisma.contractSubject.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '原名', isActive: true, internalCompany: 'fuede' });
    const { request: result } = await service.submitDraft('user', { baseVersion, employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111' }, profile: {} }, operator);
    if (!result) throw new Error('expected review request');
    expect(prisma.employeeDataChangeRequest.create.mock.calls[0][0].data.profileReviewStatus).toBe('pending');
    expect(result.profileReviewStatus).toBe('approved');
    expect(reviews.applyArchiveChange).toHaveBeenCalledTimes(1);
  });
  it('retains new employee draft contract snapshots across directory renames', async () => {
    const { service, prisma } = fixture();
    const subject = '11111111-1111-4111-8111-111111111111';
    const payload = { employee: {}, contracts: [{ contractSubjectId: subject, signingCompany: '客户端新名称', sequence: 0 }] };
    await (service as any).normalizeSubjectPayload(prisma, payload, { employee: {}, contracts: [
      { contractSubjectId: subject, signingCompany: '原签约名称', sequence: 0 },
    ] });
    expect(payload.contracts[0].signingCompany).toBe('原签约名称');
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });

  it.each([undefined, '11111111-1111-4111-8111-111111111111'])('preserves formal company and snapshot on unrelated edits with subject %s', async contractSubjectId => {
    const { service, prisma, baseVersion } = fixture('11111111-1111-4111-8111-111111111111');
    const result = await service.submitDraft('user', { baseVersion, employee: {
      contractSubjectId, company: 'beijing_fuede', companyText: 'Forged', position: 'New position',
    }, profile: {} }, operator);
    expect(result.request?.proposedValue).toMatchObject({ employee: { company: 'fuede', companyText: '原名' } });
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });

  it('allows an unmapped archive draft but blocks submission even with a forged company', async () => {
    const { service, prisma, baseVersion } = fixture();
    prisma.contractSubject.findUnique.mockResolvedValue({ name: 'Synthetic', isActive: true, internalCompany: null });
    const input = { baseVersion, employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', company: 'fuede' }, profile: {} };
    const saved = await service.saveArchiveDraft('user', input, operator);
    expect(saved?.proposedValue).toMatchObject({ employee: { company: null, companyText: 'Synthetic' } });
    await expect(service.submitDraft('user', input, operator)).rejects.toThrow('内部公司映射');
  });
});
