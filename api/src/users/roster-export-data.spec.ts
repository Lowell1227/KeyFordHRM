import * as ExcelJS from 'exceljs';
import { rosterArchiveCells, selectRosterContracts, rosterContractDateStatus } from './roster-export-data';
import { buildRosterWorkbook, RosterWorkbookItem } from './users.excel';
import { rosterExportFieldGroups, parseRosterExportColumns, DEFAULT_ROSTER_EXPORT_COLUMNS } from './roster-export-catalog';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const employee = (overrides: Partial<RosterWorkbookItem> = {}): RosterWorkbookItem => ({
  id: 'fictional-employee', employeeNo: '00042', name: '=SUM(1,2)', phone: null, email: null, avatarUrl: null,
  deptId: 'fictional-department', deptName: '示例部门', position: null, sysRole: 'employee', systemPermission: 'standard_user',
  hrCapabilities: [], businessIdentities: [], status: 'active', employmentType: 'full_time', directManagerId: null,
  directManagerName: null, directReportCount: 0, isAssessorOnly: false, canViewAll: false, entryDate: null,
  companyTenure: '待完善', dingtalkBindingState: 'unbound', archivedAt: null, matchedHistoricalEmployeeNo: null,
  ...overrides,
});

describe('roster archive export', () => {
  it('returns eight ordered groups without default-selecting additional personal fields', () => {
    const groups = rosterExportFieldGroups({ sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] });
    expect(groups.map(group => group.key)).toEqual(['employment', 'personal', 'contact', 'insurance', 'bank', 'contract', 'history', 'system']);
    const defaults = groups.flatMap(group => group.fields).filter(field => field.defaultSelected).map(field => field.key);
    expect(defaults).toEqual(expect.arrayContaining([...DEFAULT_ROSTER_EXPORT_COLUMNS, 'latestContractType', 'latestEffectiveFrom', 'latestContractStatus']));
    expect(defaults).not.toContain('contractHistory');
    expect(DEFAULT_ROSTER_EXPORT_COLUMNS).toHaveLength(9);
    expect(rosterExportFieldGroups({ sysRole: 'hr_user', hrCapabilities: ['organization_edit'] }).flatMap(group => group.fields)).toHaveLength(10);
    expect(() => parseRosterExportColumns('contractHistory', { sysRole: 'hr_user', hrCapabilities: ['organization_edit'] })).toThrow('权限');
    expect(() => parseRosterExportColumns('bankAccountEncrypted', { sysRole: 'hr' })).toThrow('有效');
  });

  it('defaults to current contract fields only for archive viewers, keeping organization-only access unchanged', async () => {
    const hr = { sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
    const organization = { sysRole: 'hr_user', hrCapabilities: ['organization_edit'] };
    const columns = parseRosterExportColumns(undefined, hr);
    expect(columns).toContain('latestContractType');
    expect(columns).not.toContain('contractHistory');
    expect(parseRosterExportColumns(undefined, organization)).toEqual(DEFAULT_ROSTER_EXPORT_COLUMNS);
    const workbook = await buildRosterWorkbook([employee()], columns);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['花名册']);
  });

  it('selects the later effective transfer rather than a later signature or ancillary material', () => {
    const contracts = [
      { id: 'initial', contractType: 'contract', signedAt: day('2026-11-12'), effectiveFrom: day('2026-08-01') },
      { id: 'transfer', contractType: 'transfer', signedAt: day('2026-11-01'), effectiveFrom: day('2026-11-01') },
      { id: 'removed', contractType: 'renewal', effectiveFrom: day('2028-01-01'), isActive: false },
      { id: 'material', contractType: 'attachment', effectiveFrom: day('2029-01-01') },
    ];
    expect(selectRosterContracts(contracts).latest?.id).toBe('transfer');
    expect(selectRosterContracts(contracts).history).toHaveLength(3);
    expect(selectRosterContracts([{ id: 'future', contractType: 'renewal', effectiveFrom: day('2099-01-01') }]).latest?.id).toBe('future');
  });

  it('keeps pending current contracts in one group and exports their Shanghai-day status', async () => {
    const contract = { id: 'pending', contractType: 'renewal', effectiveFrom: day('2026-12-01'), expiresAt: day('2029-11-30') };
    expect(rosterContractDateStatus(contract, new Date('2026-11-30T15:59:59Z'))).toBe('待生效');
    expect(rosterContractDateStatus(contract, new Date('2026-11-30T16:00:00Z'))).toBe('正常');
    expect(rosterContractDateStatus(contract, new Date('2029-11-30T16:00:00Z'))).toBe('已到期');
    const built = await buildRosterWorkbook([employee({ contracts: [{ ...contract, effectiveFrom: day('2099-01-01'), expiresAt: day('2100-01-01') }] })],
      ['latestContractType', 'latestContractStatus']);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await built.xlsx.writeBuffer() as any);
    expect(book.getWorksheet('花名册')!.getRow(3).values).toEqual([undefined, '续签', '待生效']);
    expect(book.getWorksheet('历史合同')).toBeUndefined();
  });

  it('does not let an undated legacy signature displace a dated current transfer in the workbook', async () => {
    const legacy = { id: 'legacy', contractType: 'contract', signedAt: day('2026-11-12'), effectiveFrom: null };
    const transfer = { id: 'transfer', contractType: 'transfer', effectiveFrom: day('2026-11-01') };
    expect(selectRosterContracts([legacy, transfer]).latest).toBe(transfer);
    expect(selectRosterContracts([legacy]).latest).toBe(legacy);
    const book = await buildRosterWorkbook([employee({ contracts: [legacy, transfer] })], ['latestContractType', 'latestEffectiveFrom']);
    expect(book.getWorksheet('花名册')!.getRow(3).values).toEqual([undefined, '转签', day('2026-11-01')]);
  });

  it('uses formal employment at the business date and does not select a future record', () => {
    const current = { id: 'current', effectiveFrom: day('2026-01-01'), effectiveTo: null, company: 'fuede',
      companyText: '示例合同主体', probationMonths: 0, jobGrade: 'G1', jobFamily: '示例职系',
      plannedRegularDate: day('2026-04-01'), actualRegularDate: day('2026-04-02'), leaveDate: null,
      directManager: { name: '示例主管' }, workLocation: '示例地点' };
    const cells = rosterArchiveCells({ status: 'active', employmentType: 'full_time', entryDate: day('2026-01-01'),
      plannedRegularDate: day('1999-01-01'), dept: { name: '三级组', fullPath: '一级部 / 二级部 / 三级组' },
      employeeProfile: { birthDate: day('2000-11-14'), childrenCount: 0, idNumberFingerprint: 'private-fingerprint',
        bankAccountEncrypted: 'private-cipher', bankAccountFingerprint: 'private-bank-fingerprint' },
      employmentHistory: [current, { ...current, id: 'future', effectiveFrom: day('2027-01-01'), companyText: '未来公司' }],
    }, day('2026-11-13'));
    expect(cells).toMatchObject({ companyText: '示例合同主体', organization: '孚德', departmentLevel1: '一级部',
      departmentLevel2: '二级部', departmentLevel3: '三级组', age: 25, childrenCount: 0, probationMonths: 0,
      plannedRegularDate: current.plannedRegularDate, actualRegularDate: current.actualRegularDate, leaveDate: null,
      idNumberConfigured: '已录入', bankAccountConfigured: '已录入' });
    expect(JSON.stringify(cells)).not.toMatch(/private-|Encrypted|Fingerprint/);
  });

  it('keeps missing fields empty, rejects future birth dates, and uses latest formal former employment', () => {
    expect(rosterArchiveCells({ status: 'active' }, day('2026-11-13'))).toMatchObject({ companyText: '', birthDate: null, age: null, idNumberConfigured: '' });
    expect(rosterArchiveCells({ status: 'active', employeeProfile: { birthDate: day('2027-01-01') } }, day('2026-11-13')).age).toBeNull();
    expect(rosterArchiveCells({ status: 'resigned', employmentHistory: [{ id: 'ended', effectiveFrom: day('2020-01-01'),
      effectiveTo: day('2021-01-01'), companyText: '历史主体', leaveDate: day('2021-01-01') }] }, day('2026-11-13')))
      .toMatchObject({ companyText: '历史主体', leaveDate: day('2021-01-01') });
  });

  it('round-trips selected fields, real dates, literal strings, leading zeroes and styled two-row headers', async () => {
    const built = await buildRosterWorkbook([employee({ archiveFields: { entryDate: day('2026-10-01'), phone: '0012345', bankAccountConfigured: '已录入' } })],
      ['name', 'employeeNo', 'entryDate', 'phone']);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await built.xlsx.writeBuffer() as any);
    const sheet = workbook.getWorksheet('花名册')!;
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(['姓名', '工号', '入职日期', '手机号']);
    expect((sheet.getRow(3).values as unknown[]).slice(1)).toEqual(['=SUM(1,2)', '00042', day('2026-10-01'), '0012345']);
    expect(sheet.getCell('A3').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('B3').numFmt).toBe('@');
    expect(sheet.getCell('C3').numFmt).toBe('yyyy-mm-dd');
    expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFC04F15' } });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 2 });
    expect(sheet.autoFilter).toBe('A2:D3');
    expect(sheet.columnCount).toBe(4);
  });

  it('exports current and historical contracts separately without renumbering or repeating the latest contract', async () => {
    const contracts = [
      { id: 'old', sequence: 7, contractType: 'renewal', name: '旧合同', signedAt: day('2024-01-01'), isActive: true },
      { id: 'latest', sequence: 3, contractType: 'contract', name: '最新合同', effectiveFrom: day('2026-10-01'), isActive: true },
      { id: 'disabled', sequence: 9, contractType: 'transfer', name: '停用合同', signedAt: day('2027-01-01'), isActive: false },
    ];
    expect(selectRosterContracts(contracts).latest?.id).toBe('latest');
    const workbook = await buildRosterWorkbook([employee({ contracts })], ['name', 'latestContractName', 'latestEffectiveFrom', 'contractHistory']);
    const main = workbook.getWorksheet('花名册')!;
    expect((main.getRow(3).values as unknown[]).slice(1)).toEqual(['=SUM(1,2)', '最新合同', day('2026-10-01')]);
    const history = workbook.getWorksheet('历史合同')!;
    expect(history.getCell('C2').value).toBe('原记录序号');
    expect(history.getCell('C3').value).toBe(10);
    expect(history.getCell('P3').value).toBe('已停用');
    expect(history.getCell('C4').value).toBe(8);
    expect(history.getCell('E4').value).toBe('旧合同');
    expect(history.rowCount).toBe(4);
    expect(main.columnCount).toBe(3);
  });

  it('supports a history-only selection and empty results without blank data rows or an unused main sheet', async () => {
    const historyOnly = await buildRosterWorkbook([], ['contractHistory']);
    expect(historyOnly.worksheets.map(sheet => sheet.name)).toEqual(['历史合同']);
    expect(historyOnly.worksheets[0].rowCount).toBe(2);
    const oneColumn = await buildRosterWorkbook([], ['name']);
    expect(oneColumn.worksheets[0].rowCount).toBe(2);
    expect(oneColumn.worksheets[0].views[0]).toMatchObject({ xSplit: 0, ySplit: 2 });
    await expect(oneColumn.xlsx.writeBuffer()).resolves.toBeDefined();
  });
});
