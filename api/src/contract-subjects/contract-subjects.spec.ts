import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SysRole } from '@prisma/client';
import { ContractSubjectsService } from './contract-subjects.service';
import { ContractSubjectsController } from './contract-subjects.controller';
import { ContractSubjectQueryDto, CreateContractSubjectDto, UpdateContractSubjectDto } from './contract-subjects.dto';
import { RolesGuard } from '@/common/guards/roles.guard';
import { normalizeContractSubject, validateContractSubject } from './contract-subject-reference';

describe('contract subject directory', () => {
  it.each(['false', 'true', 0, 1])('rejects non-boolean write status %s despite implicit conversion', async (isActive) => {
    const input = plainToInstance(UpdateContractSubjectDto, { isActive }, { enableImplicitConversion: true });
    expect((await validate(input)).map((error) => error.property)).toContain('isActive');
  });
  it.each([true, false])('accepts JSON boolean write status %s', async (isActive) => {
    const input = plainToInstance(UpdateContractSubjectDto, { isActive }, { enableImplicitConversion: true });
    expect(input.isActive).toBe(isActive);
    expect(await validate(input)).toEqual([]);
  });
  it.each(['', ' ', '甲'.repeat(151)])('rejects invalid normalized names', async (name) => {
    expect((await validate(plainToInstance(CreateContractSubjectDto, { name }))).length).toBeGreaterThan(0);
  });
  it.each(['true', 'false'])('parses explicit query boolean %s', async (value) => {
    const query = plainToInstance(ContractSubjectQueryDto, { includeInactive: value }, { enableImplicitConversion: true });
    expect(query.includeInactive).toBe(value === 'true');
    expect(await validate(query)).toEqual([]);
  });
  it('creates a trimmed unique name and audit in the same transaction', async () => {
    const tx = { contractSubject: { create: jest.fn(async ({ data }) => ({ id: '11111111-1111-4111-8111-111111111111', isActive: true, ...data })) }, auditLog: { create: jest.fn() } };
    const service = new ContractSubjectsService({ $transaction: async (run: any) => run(tx) } as any);
    expect(await service.create({ name: ' 主体甲 ' }, { id: 'hr' } as any)).toMatchObject({ name: '主体甲' });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityId: '11111111-1111-4111-8111-111111111111', action: 'create_contract_subject' }) });
    tx.contractSubject.create.mockRejectedValueOnce({ code: 'P2002' } as never);
    await expect(service.create({ name: '主体甲' }, { id: 'hr' } as any)).rejects.toThrow('合同主体名称已存在');
  });
  it.each([
    [SysRole.hr, [], true, true], [SysRole.system_admin, [], true, true],
    [SysRole.hr_user, ['employee_archive_edit'], true, true],
    [SysRole.hr_user, ['employee_archive_review'], true, false],
    [SysRole.hr_user, ['organization_edit'], false, false],
    [SysRole.employee, ['employee_archive_edit'], false, false],
    [SysRole.hr_user, [], false, false], [SysRole.employee, [], false, false],
  ])('enforces read and write permissions for %s / %s', (sysRole, hrCapabilities, canRead, canWrite) => {
    const guard = new RolesGuard(new Reflector());
    const allowed = (handler: Function) => {
      try { return guard.canActivate({ getHandler: () => handler, getClass: () => ContractSubjectsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { sysRole, hrCapabilities } }) }) } as any); } catch { return false; }
    };
    expect(allowed(ContractSubjectsController.prototype.findAll)).toBe(canRead);
    expect(allowed(ContractSubjectsController.prototype.create)).toBe(canWrite);
    expect(allowed(ContractSubjectsController.prototype.update)).toBe(canWrite);
  });
});

describe('frozen references on approval and old JSON', () => {
  it('retains an inactive reference and snapshot when the old JSON omits the ID', async () => {
    const value = { companyText: '客户端名称' } as any;
    await normalizeContractSubject({} as any, value, { contractSubjectId: 'old', companyText: '原名' }, 'companyText');
    expect(value).toEqual({ contractSubjectId: 'old', companyText: '原名' });
    await expect(validateContractSubject({} as any, value, { contractSubjectId: 'old' })).resolves.toBeUndefined();
  });
  it('validates newly selected references without refreshing their frozen names', async () => {
    const client = { contractSubject: { findUnique: jest.fn().mockResolvedValue({ name: '改名后', isActive: true }) } };
    const value = { contractSubjectId: '22222222-2222-4222-8222-222222222222', signingCompany: '提交时原名' };
    await validateContractSubject(client as any, value, {});
    expect(value.signingCompany).toBe('提交时原名');
    client.contractSubject.findUnique.mockResolvedValue({ name: '改名后', isActive: false });
    await expect(validateContractSubject(client as any, value, {})).rejects.toThrow('合同主体不存在或已停用');
  });
});
