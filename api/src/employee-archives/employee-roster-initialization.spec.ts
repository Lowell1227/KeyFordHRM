import { CompanyCode } from '@prisma/client';
import { validateInitializationTargets, initializationWarnings, initializeConfirmedRoster } from './employee-roster-initialization';

const target = (row: number, no: string, userId: string | null = null) => ({
  sheet: '在职整理', row, userId, employeeNo: no, company: CompanyCode.fuede,
  deptId: null, positionId: null, status: 'active' as const,
});

function initializationFixture(targets: ReturnType<typeof target>[], oldUsers: any[], initialNumbers: any[] = []) {
  const users = oldUsers.map((user) => ({ accountType: 'employee', sysRole: 'employee', deletedAt: null,
    updatedAt: new Date('2026-10-09T00:00:00Z'), employmentHistory: [], employeeContracts: [], ...user }));
  const numbers = initialNumbers.map((number) => ({ ...number }));
  const contracts: any[] = users.flatMap((user) => user.employeeContracts.map((contract: any) => ({ ...contract, userId: user.id })));
  const requests: any[] = [];
  const matchesNumber = (number: any, where: any) => number.userId === where.userId
    && (!where.status || number.status === where.status)
    && (!where.employeeNo || (typeof where.employeeNo === 'string'
      ? number.employeeNo === where.employeeNo : number.employeeNo !== where.employeeNo.not));
  const tx = {
    $executeRaw: jest.fn(),
    user: {
      findMany: async () => users,
      findUnique: async ({ where }: any) => where.id === 'admin' ? { id: 'admin', sysRole: 'system_admin' } : users.find((user) => user.id === where.id),
      findUniqueOrThrow: async ({ where }: any) => users.find((user) => user.id === where.id),
      update: async ({ where, data }: any) => Object.assign(users.find((user) => user.id === where.id), data),
      create: async ({ data }: any) => { users.push(data); return data; },
    },
    employeeNumberAssignment: {
      findMany: async () => numbers.filter((number) => number.status !== 'released'),
      updateMany: async ({ where, data }: any) => { numbers.filter((number) => matchesNumber(number, where)).forEach((number) => Object.assign(number, data)); },
      upsert: async ({ where, create, update }: any) => {
        const existing = numbers.find((number) => matchesNumber(number, where.userId_employeeNo));
        if (existing) Object.assign(existing, update);
        else numbers.push(create);
      },
    },
    employeeContract: {
      updateMany: async ({ where, data }: any) => contracts.filter((contract) => contract.userId === where.userId
        && contract.contractType === where.contractType && contract.sequence === where.sequence && contract.isActive === where.isActive)
        .forEach((contract) => Object.assign(contract, data)),
      create: async ({ data }: any) => {
        if (contracts.some((contract) => contract.isActive && contract.userId === data.userId
          && contract.contractType === data.contractType && contract.sequence === data.sequence)) throw new Error('active contract key collision');
        const stored = { id: `contract-${contracts.length}`, isActive: true, ...data };
        contracts.push(stored);
        return stored;
      },
    },
    employeeImportBatch: { findFirst: async () => null, create: async () => ({ id: 'batch' }), update: jest.fn() },
    employeeDataChangeRequest: { count: async () => 0, create: async ({ data }: any) => { requests.push(data); return data; } },
    employmentRecord: { updateMany: jest.fn(), create: jest.fn() },
    employeeProfile: { upsert: jest.fn() }, employeeImportRow: { create: jest.fn() }, auditLog: { create: jest.fn() },
  };
  const input = {
    fileHash: 'a'.repeat(64), fileName: 'confirmed.xlsx', effectiveDate: new Date('2026-10-10T00:00:00Z'), operatorId: 'admin',
    targets, retireUserIds: [], numberCorrections: [],
    rows: targets.map((item, index) => ({ rowNumber: index + 1, source: { sheetName: item.sheet, rowNumber: item.row },
      employee: { name: users.find((user) => user.id === item.userId)?.name ?? `新增员工${index}`, entryDate: null },
      profile: {}, contracts: [], warnings: [] })),
    expectedUsers: users.map((user) => ({ id: user.id, name: user.name, employeeNo: user.employeeNo, updatedAt: user.updatedAt.toISOString() })),
  };
  return { input, users, numbers, requests, contracts,
    run: () => initializeConfirmedRoster({ $transaction: async (callback: any) => callback(tx) } as any,
      { prepareProfile: () => ({}), encryptSourceEvidence: () => 'encrypted-test-evidence' } as any, input as any) };
}

describe('confirmed roster initialization', () => {
  it('rejects duplicate source rows, reused identities and occupied target numbers before any write', () => {
    expect(() => validateInitializationTargets([target(3, '001'), target(3, '002')])).toThrow();
    expect(() => validateInitializationTargets([target(3, '001', 'u1'), target(4, '002', 'u1')])).toThrow();
    expect(() => validateInitializationTargets([target(3, '001'), target(4, '001')])).toThrow();
    expect(() => validateInitializationTargets([target(3, '093'), target(4, '0093')])).not.toThrow();
  });

  it('keeps unknown dates and department as nonblocking maintenance warnings, not invented facts', () => {
    const row = { employee: { entryDate: null, companyText: null, departmentPath: [], leaveDate: null }, warnings: [] } as any;
    const warnings = initializationWarnings(row, { ...target(3, '001'), status: 'resigned' });
    expect(warnings.map((warning) => warning.field)).toEqual(expect.arrayContaining([
      'employee.entryDate', 'employee.companyText', 'employee.deptId', 'employee.leaveDate',
    ]));
    expect(row.employee.entryDate).toBeNull();
    expect(row.employee.leaveDate).toBeNull();
    expect(initializationWarnings({ ...row, employee: { ...row.employee, companyText: '孚德', entryDate: new Date('2020-01-01') } },
      { ...target(3, '001'), deptId: 'd1' }).map((warning) => warning.field)).not.toContain('employee.leaveDate');
  });

  it('moves an approved number to the exact new source row rather than the first null identity', async () => {
    const fixture = initializationFixture([target(3, '824'), target(85, '12355', 'previous'), target(45, '347')],
      [{ id: 'previous', name: '原工号持有人', employeeNo: '347' }],
      [{ userId: 'previous', employeeNo: '347', status: 'current' }]);
    (fixture.input.numberCorrections as any[]).push({ employeeNo: '347', previousUserId: 'previous', targetSheet: '在职整理', targetRow: 45 });

    await expect(fixture.run()).resolves.toMatchObject({ applied: 3 });
    const recipient = fixture.users.find((user) => user.name === '新增员工2')!;
    expect(recipient.employeeNo).toBe('347');
    expect(fixture.users.find((user) => user.name === '新增员工0')!.employeeNo).toBe('824');
    expect(fixture.numbers.find((number) => number.userId === recipient.id && number.employeeNo === '347')?.status).toBe('current');
    expect(fixture.numbers.find((number) => number.userId === 'previous' && number.employeeNo === '347')?.status).toBe('released');
  });

  it('refuses a correction whose approved source row does not own the destination number', async () => {
    const fixture = initializationFixture([target(3, '824'), target(85, '12355', 'previous'), target(45, '347')],
      [{ id: 'previous', name: '原工号持有人', employeeNo: '347' }]);
    (fixture.input.numberCorrections as any[]).push({ employeeNo: '347', previousUserId: 'previous', targetSheet: '在职整理', targetRow: 3 });

    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.users[0].employeeNo).toBe('347');
    expect(fixture.requests).toHaveLength(0);
  });

  it('clears the historical end date when restoring the current number without replacing its original start', async () => {
    const originalStart = new Date('2015-06-16T00:00:00Z');
    const fixture = initializationFixture([target(108, '093', 'restored')],
      [{ id: 'restored', name: '恢复工号员工', employeeNo: '12354' }],
      [{ userId: 'restored', employeeNo: '093', status: 'historical', effectiveFrom: originalStart, effectiveTo: new Date('2026-09-17T00:00:00Z') },
        { userId: 'restored', employeeNo: '12354', status: 'current', effectiveFrom: new Date('2026-09-18T00:00:00Z'), effectiveTo: null }]);

    await fixture.run();
    expect(fixture.numbers.find((number) => number.employeeNo === '093')).toMatchObject({ status: 'current', effectiveFrom: originalStart, effectiveTo: null });
    expect(fixture.numbers.find((number) => number.employeeNo === '12354')).toMatchObject({ status: 'historical', effectiveTo: new Date('2026-10-09T00:00:00Z') });
  });

  it('retains conflicting contract values and attachments as history without ending unmapped contracts', async () => {
    const old = { id: 'old', contractType: 'labor', sequence: 0, isActive: true, name: '旧合同',
      expiresAt: new Date('2027-01-01'), images: ['private-image-ref'], attachments: ['private-file-ref'] };
    const unmapped = { ...old, id: 'unmapped', sequence: 4 };
    const fixture = initializationFixture([target(3, '001', 'u1')],
      [{ id: 'u1', name: '测试员工', employeeNo: '001', employeeContracts: [old, unmapped] }]);
    (fixture.input.rows[0].contracts as any[]).push({ kind: 'labor', sequence: 0, name: '新来源合同', expiresAt: null });
    await fixture.run();
    expect(fixture.contracts.find(contract => contract.id === 'old')).toMatchObject({ ...old, isActive: false, endedAt: expect.any(Date) });
    expect(fixture.contracts.find(contract => contract.id === 'unmapped')).toMatchObject(unmapped);
    expect(fixture.contracts.filter(contract => contract.isActive && contract.sequence === 0)).toHaveLength(1);
    expect(fixture.requests[0].proposedValue.contracts[0]).toMatchObject({ id: 'contract-2', sequence: 0, signingCompany: null });
  });
});
