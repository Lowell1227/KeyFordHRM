import { PersonnelConfigService } from './personnel-config.service';

describe('PersonnelConfigService 人事审核模式', () => {
  const operatorId = '20000000-0000-4000-8000-000000000099';

  const buildPrisma = (storedValue: unknown) => {
    const systemConfig = {
      findUnique: jest.fn().mockResolvedValue(
        storedValue === undefined ? null : { value: storedValue },
      ),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const prisma: any = { systemConfig, auditLog };
    prisma.$transaction = jest.fn((run: any) => run({ systemConfig, auditLog }));
    return { prisma, systemConfig, auditLog };
  };

  it('未配置时默认标准模式', async () => {
    const { prisma } = buildPrisma(undefined);
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.getReviewMode()).resolves.toBe('standard');
  });

  it('读取已配置的宽松模式', async () => {
    const { prisma } = buildPrisma({ mode: 'relaxed' });
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.getReviewMode()).resolves.toBe('relaxed');
  });

  it('配置值异常时回退标准模式', async () => {
    const { prisma } = buildPrisma({ mode: 'unknown' });
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.getReviewMode()).resolves.toBe('standard');
  });

  it('切换模式写入 systemConfig 并记录审计', async () => {
    const { prisma, systemConfig, auditLog } = buildPrisma(undefined);
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.setReviewMode('relaxed', operatorId)).resolves.toEqual({ mode: 'relaxed' });
    expect(systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'personnel_review_mode' },
      create: expect.objectContaining({ value: { mode: 'relaxed' } }),
      update: { value: { mode: 'relaxed' }, updatedBy: operatorId },
    }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'update_personnel_review_mode', userId: operatorId }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
