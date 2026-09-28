import { ValidationPipe } from '@nestjs/common';
import { CreateEmployeeDto, SaveEmployeeCreateDraftDto } from './employee-archive.dto';

describe('CreateEmployeeDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: true },
  });

  it('accepts the real name-only wizard draft payload with unfilled optional dates and department', async () => {
    const result = await pipe.transform({
      name: '草稿员工', deptId: '', entryDate: '', effectiveFrom: '',
      employee: { plannedRegularDate: '', actualRegularDate: '', leaveDate: '' },
      profile: { birthDate: '', graduationDate: '', socialSecurityStartDate: '', housingFundStartDate: '' },
      contracts: [{ signedAt: '', effectiveFrom: '', expiresAt: '' }],
    }, { type: 'body', metatype: SaveEmployeeCreateDraftDto });
    expect(result.deptId).toBeNull();
    expect(result.entryDate).toBeNull();
    expect(result.employee.leaveDate).toBeNull();
  });

  it('allows empty optional dates but still requires employment dates on submission', async () => {
    const body = { name: '新员工', company: 'fuede', deptId: '30000000-0000-4000-8000-000000000001',
      entryDate: '2026-09-26', effectiveFrom: '2026-09-26', employmentType: 'full_time',
      employeeStatus: 'probation', employee: { leaveDate: '', actualRegularDate: '' }, profile: { birthDate: '' } };
    await expect(pipe.transform(body, { type: 'body', metatype: CreateEmployeeDto })).resolves.toBeDefined();
    await expect(pipe.transform({ ...body, entryDate: '' }, { type: 'body', metatype: CreateEmployeeDto })).rejects.toThrow();
  });

  it('strips nested fields that are outside the employee creation wizard boundary', async () => {
    const value = await pipe.transform({
      name: '白名单员工', company: 'fuede', deptId: '30000000-0000-4000-8000-000000000001',
      entryDate: '2026-09-18', effectiveFrom: '2026-09-18',
      employmentType: 'full_time', employeeStatus: 'probation',
      employee: { jobGrade: 'P2', organizationEnsurePaths: [['不应创建的部门']], sysRole: 'admin' },
      profile: { education: '本科', unexpectedSecret: 'drop-me' },
      contracts: [{ contractType: 'contract', name: '劳动合同', organizationPath: ['drop-me'] }],
      performance: { managerId: null, canApproveAnything: true },
    }, { type: 'body', metatype: CreateEmployeeDto });

    expect(value.employee).toEqual({ jobGrade: 'P2' });
    expect(value.profile).toEqual({ education: '本科' });
    expect(value.contracts).toEqual([{ contractType: 'contract', name: '劳动合同' }]);
    expect(value.performance).toEqual({ managerId: null });
  });

  it('rejects impossible calendar dates in nested archive fields', async () => {
    await expect(pipe.transform({
      name: '日期校验员工', company: 'fuede', deptId: '30000000-0000-4000-8000-000000000001',
      entryDate: '2026-09-18', effectiveFrom: '2026-09-18',
      employmentType: 'full_time', employeeStatus: 'probation',
      employee: { plannedRegularDate: '2026-02-30' },
      profile: { birthDate: '1990-13-01' },
      contracts: [{ signedAt: 'not-a-date' }],
    }, { type: 'body', metatype: CreateEmployeeDto })).rejects.toThrow();
  });

  it('accepts valid UUID v5 manager IDs when saving a new-employee draft', async () => {
    const result = await pipe.transform({
      name: '草稿员工',
      rosterManagerId: '886313e1-3b8a-5372-9b90-0c9aee199e5d',
      performanceManagerId: '21f7f8de-8051-5b89-8680-0195ef798b6a',
      performance: { managerId: '21f7f8de-8051-5b89-8680-0195ef798b6a' },
    }, { type: 'body', metatype: SaveEmployeeCreateDraftDto });

    expect(result.rosterManagerId).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(result.performanceManagerId).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a');
    expect(result.performance.managerId).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a');
  });

  it('accepts valid UUID v5 manager IDs when submitting a new employee', async () => {
    const result = await pipe.transform({
      name: '新员工', company: 'fuede', deptId: '30000000-0000-4000-8000-000000000001',
      entryDate: '2026-09-29', effectiveFrom: '2026-09-29', employmentType: 'full_time',
      employeeStatus: 'probation', rosterManagerId: '886313e1-3b8a-5372-9b90-0c9aee199e5d',
      performanceManagerId: '21f7f8de-8051-5b89-8680-0195ef798b6a',
      performance: { managerId: '21f7f8de-8051-5b89-8680-0195ef798b6a' },
    }, { type: 'body', metatype: CreateEmployeeDto });

    expect(result.rosterManagerId).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(result.performanceManagerId).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a');
    expect(result.performance.managerId).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a');
  });

  it.each([
    [{ rosterManagerId: 'FD300055' }, '花名册直属主管信息无效，请重新选择'],
    [{ performanceManagerId: 'FD300055' }, '绩效直属上级信息无效，请重新选择'],
    [{ performance: { managerId: 'FD300055' } }, '绩效直属上级信息无效，请重新选择'],
  ])('returns a business-facing message for invalid manager input %#', async (managerInput, message) => {
    const validation = pipe.transform({ name: '草稿员工', ...managerInput }, {
      type: 'body', metatype: SaveEmployeeCreateDraftDto,
    });
    await expect(validation).rejects.toMatchObject({
      response: { message: [expect.stringContaining(message)] },
    });
    await expect(validation).rejects.not.toMatchObject({
      response: { message: [expect.stringContaining('must be a UUID')] },
    });
  });
});
