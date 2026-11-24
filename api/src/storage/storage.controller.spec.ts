import { SysRole } from '@prisma/client';
import { StorageController } from './storage.controller';

describe('StorageController contract material access', () => {
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  function resumeSetup(actor: Record<string, unknown>) {
    const storage = { pipeDownload: jest.fn(), uploadFile: jest.fn().mockResolvedValue({ name: 'synthetic.pdf' }) };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'actor', status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false, ...actor }) } };
    const controller = new (StorageController as any)(storage, {}, prisma) as StorageController;
    return { controller, storage, prisma };
  }

  it('lets explicitly granted employees download resumes, not contracts or upload resumes', async () => {
    const actor = { id: 'actor', sysRole: SysRole.employee, hrCapabilities: ['recruitment_view'], isAssessorOnly: false } as any;
    const { controller, storage } = resumeSetup(actor);
    await expect(controller.download('talent-resume/fixture.pdf', response() as any, actor)).resolves.toBeUndefined();
    expect(storage.pipeDownload).toHaveBeenCalledTimes(1);
    await expect(controller.download('employee-contracts/fixture.pdf', response() as any, actor)).rejects.toThrow();
    await expect(controller.upload({ originalname: 'synthetic.pdf' } as any, 'talent-resume', actor)).rejects.toThrow();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it.each(['hr', 'system_admin', 'hr_user'])('blocks mixed assessor-only %s resume downloads and uploads', async sysRole => {
    const actor = { id: 'actor', sysRole, hrCapabilities: ['employee_archive_edit', 'employee_archive_review', 'recruitment_view'], isAssessorOnly: true } as any;
    const { controller, storage } = resumeSetup(actor);
    await expect(controller.download('talent-resume/fixture.pdf', response() as any, actor)).rejects.toThrow();
    await expect(controller.upload({ originalname: 'synthetic.pdf' } as any, 'talent-resume', actor)).rejects.toThrow();
    expect(storage.pipeDownload).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('allows active HR resume uploads without status in AuthUser, using trusted current qualification', async () => {
    const actor = { id: 'actor', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'], isAssessorOnly: false } as any;
    const { controller, storage, prisma } = resumeSetup(actor);
    await expect(controller.upload({ originalname: 'synthetic.pdf' } as any, 'talent-resume', actor)).resolves.toEqual({ name: 'synthetic.pdf' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'actor' } }));
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'resigned' }, { status: 'pending_entry' }, { archivedAt: new Date() }, { deletedAt: new Date() },
    { isAssessorOnly: true }, { sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] },
    { sysRole: 'employee', hrCapabilities: ['recruitment_view'] },
  ])('rejects current DB ineligibility despite a previously valid request: %j', async change => {
    const actor = { id: 'actor', sysRole: SysRole.hr, isAssessorOnly: false } as any;
    const { controller, storage } = resumeSetup({ ...actor, ...change });
    await expect(controller.upload({ originalname: 'synthetic.pdf' } as any, 'talent-resume', actor)).rejects.toThrow();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('requires task or upload ownership before downloading a general attachment', async () => {
    const storage = { pipeDownload: jest.fn() };
    const access = { assertDownload: jest.fn().mockRejectedValue(new Error('forbidden')) };
    const controller = new (StorageController as any)(storage, access);
    await expect(controller.download('uploads/2026/11/16/private.pdf', response(), {
      id: 'unrelated', sysRole: SysRole.employee,
    })).rejects.toThrow('forbidden');
    expect(storage.pipeDownload).not.toHaveBeenCalled();
  });

  it('普通员工不能通过对象 key 下载合同材料', async () => {
    const storage = { pipeDownload: jest.fn() };
    const controller = new StorageController(storage as any, {} as any, {} as any);

    await expect((controller as any).download(
      'employee-contracts%2Fattachments%2F2026%2F08%2F28%2Fcontract.pdf',
      response(),
      { id: 'employee-1', sysRole: SysRole.employee, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '无权限访问合同材料' }) });
    expect(storage.pipeDownload).not.toHaveBeenCalled();
  });

  it('具备员工档案编辑能力的 HR 可以下载合同材料', async () => {
    const storage = { pipeDownload: jest.fn().mockResolvedValue(undefined) };
    const controller = new StorageController(storage as any, {} as any, {} as any);
    const res = response();

    await (controller as any).download(
      'employee-contracts%2Fimages%2F2026%2F08%2F28%2Fcontract.jpg',
      res,
      { id: 'hr-1', sysRole: SysRole.hr_user, hrCapabilities: ['employee_archive_edit'] },
    );

    expect(storage.pipeDownload).toHaveBeenCalledWith(
      'employee-contracts/images/2026/08/28/contract.jpg',
      res,
    );
  });

  it('普通员工不能上传合同材料', async () => {
    const storage = { uploadFile: jest.fn() };
    const controller = new StorageController(storage as any, {} as any, {} as any);

    await expect((controller as any).upload(
      { originalname: '合同.pdf' },
      'employee-contract-attachment',
      { id: 'employee-1', sysRole: SysRole.employee, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '无权限管理合同材料' }) });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('does not expose internal confirmation meeting files through generic download', async () => {
    const storage = { pipeDownload: jest.fn() };
    const controller = new StorageController(storage as any, {} as any, {} as any);

    await expect((controller as any).download(
      'confirmation-internal%2F2026%2F09%2F14%2Fminutes.pdf',
      response(),
      { id: 'admin-1', sysRole: SysRole.system_admin, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '请从转正申请中下载内部评议附件' }) });
    expect(storage.pipeDownload).not.toHaveBeenCalled();
  });

  it('does not expose monthly review evidence through generic download', async () => {
    const storage = { pipeDownload: jest.fn() };
    const controller = new StorageController(storage as any, {} as any, {} as any);

    await expect((controller as any).download(
      'performance-evidence%2F2027%2F02%2Fevidence.png',
      response(),
      { id: 'employee-1', sysRole: SysRole.employee, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '请从月度自评中查看附件' }) });
    expect(storage.pipeDownload).not.toHaveBeenCalled();
  });
});
