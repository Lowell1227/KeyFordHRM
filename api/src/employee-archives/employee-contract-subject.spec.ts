import { EmployeeArchivesService } from './employee-archives.service';
import { SysRole } from '@prisma/client';

const operator = { id: 'hr', sysRole: SysRole.hr } as any;
describe('archive contract subject references', () => {
  const fixture = (id: string | null = null) => {
    const current = { id: 'user', employeeNo: '001', name: '测试', status: 'active', directManagerId: null,
      employeeProfile: null, employeeContracts: [], employmentHistory: [{ company: 'fuede', companyText: '原名', contractSubjectId: id }] };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(current) },
      contractSubject: { findUnique: jest.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '服务器名称', isActive: true }) },
      employeeDataChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => data) } };
    return { prisma, service: new EmployeeArchivesService(prisma as any) };
  };
  it('recognizes an ID-only selection and freezes the server name', async () => {
    const { service } = fixture();
    const result = await service.submitDraft('user', { employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '伪造名称' }, profile: {} }, operator);
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '服务器名称' } });
  });
  it('keeps an existing snapshot despite a supplied replacement name and directory rename', async () => {
    const { service, prisma } = fixture('11111111-1111-4111-8111-111111111111');
    const result = await service.submitDraft('user', { employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '伪造名称', position: '新岗位' }, profile: {} }, operator);
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111', companyText: '原名' } });
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });
  it('rejects a newly selected inactive subject', async () => {
    const { service, prisma } = fixture();
    prisma.contractSubject.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '停用主体', isActive: false });
    await expect(service.submitDraft('user', { employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111' }, profile: {} }, operator)).rejects.toThrow('合同主体不存在或已停用');
  });
  it('explicit null clears reference and snapshot', async () => {
    const { service } = fixture('11111111-1111-4111-8111-111111111111');
    const result = await service.submitDraft('user', { employee: { contractSubjectId: null }, profile: {} }, operator);
    expect(result.proposedValue).toMatchObject({ employee: { contractSubjectId: null, companyText: null } });
  });
  it('rejects malformed IDs before sending them to the database', async () => {
    const { service, prisma } = fixture();
    await expect(service.submitDraft('user', { employee: { contractSubjectId: 'invalid-uuid' }, profile: {} }, operator)).rejects.toThrow('合同主体信息无效');
    expect(prisma.contractSubject.findUnique).not.toHaveBeenCalled();
  });
  it('recognizes ID-only changes even when the display name is identical', async () => {
    const { service, prisma } = fixture();
    prisma.contractSubject.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: '原名', isActive: true });
    const result = await service.submitDraft('user', { employee: { contractSubjectId: '11111111-1111-4111-8111-111111111111' }, profile: {} }, operator);
    expect(result.profileReviewStatus).toBe('pending');
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
});
