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

  it('历史宽松配置不再改变固定审核规则，也不重写历史配置', async () => {
    const { prisma, systemConfig } = buildPrisma({ mode: 'relaxed' });
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.getReviewMode()).resolves.toBe('standard');
    expect(systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('配置值异常时回退标准模式', async () => {
    const { prisma } = buildPrisma({ mode: 'unknown' });
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.getReviewMode()).resolves.toBe('standard');
  });

  it('旧客户端不能重新开启宽松模式', async () => {
    const { prisma, systemConfig, auditLog } = buildPrisma(undefined);
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.setReviewMode('relaxed', operatorId)).rejects.toThrow('宽松审核模式已取消');
    expect(systemConfig.upsert).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('旧客户端设置标准规则为幂等兼容操作', async () => {
    const { prisma, systemConfig } = buildPrisma({ mode: 'relaxed' });
    const service = new PersonnelConfigService(prisma as any);
    await expect(service.setReviewMode('standard', operatorId)).resolves.toEqual({ mode: 'standard' });
    expect(systemConfig.upsert).not.toHaveBeenCalled();
  });
});
