import { SysRole } from '@prisma/client';
import { StorageController } from './storage.controller';

describe('StorageController contract material access', () => {
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it('普通员工不能通过对象 key 下载合同材料', async () => {
    const storage = { pipeDownload: jest.fn() };
    const controller = new StorageController(storage as any);

    await expect((controller as any).download(
      'employee-contracts%2Fattachments%2F2026%2F08%2F28%2Fcontract.pdf',
      response(),
      { id: 'employee-1', sysRole: SysRole.employee, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '无权限访问合同材料' }) });
    expect(storage.pipeDownload).not.toHaveBeenCalled();
  });

  it('具备员工档案编辑能力的 HR 可以下载合同材料', async () => {
    const storage = { pipeDownload: jest.fn().mockResolvedValue(undefined) };
    const controller = new StorageController(storage as any);
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
    const controller = new StorageController(storage as any);

    await expect((controller as any).upload(
      { originalname: '合同.pdf' },
      'employee-contract-attachment',
      { id: 'employee-1', sysRole: SysRole.employee, hrCapabilities: [] },
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '无权限管理合同材料' }) });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
});
