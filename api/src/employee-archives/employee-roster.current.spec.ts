import * as ExcelJS from 'exceljs';
import { parseEmployeeRosterExcel } from './employee-roster.excel';

function currentSheet(workbook: ExcelJS.Workbook, name = '在职整理') {
  const sheet = workbook.addWorksheet(name);
  const offset = name === '离职' ? 4 : 0;
  const headers: Record<number, string> = {
    1: '姓名', 2: '工号', 3: '所属公司', 11: '入职时间',
    [19 + offset]: '手机号', [37 + offset]: '身份证号',
    [43 + offset]: offset ? '社保停缴时间' : '社保起缴时间',
    [45 + offset]: offset ? '公积金停缴时间' : '公积金起缴时间',
    [48 + offset]: '银行账号', [49 + offset]: '是否打卡',
    [52 + offset]: '合同名称', [59 + offset]: '最新合同签署时间',
    [60 + offset]: '最新合同到期时间',
    [61 + offset]: offset ? '合同签署时间' : '首份合同签署时间',
    [62 + offset]: offset ? '合同到期时间' : '首份合同到期时间',
    [64 + offset]: '合同开始时间', [65 + offset]: '合同结束时间',
    [75 + offset]: '原合同主体', [76 + offset]: '转签时间',
    [77 + offset]: '合同到期时间', [78 + offset]: '新主体',
  };
  if (offset) {
    headers[12] = '离职时间（算薪截止日）';
    headers[13] = '离职具体时间（最后工作日）';
  }
  for (const [column, text] of Object.entries(headers)) {
    sheet.getRow(1).getCell(Number(column)).value = text;
    sheet.getRow(2).getCell(Number(column)).value = text;
  }
  return sheet;
}

function person(sheet: ExcelJS.Worksheet, rowNumber = 3) {
  const row = sheet.getRow(rowNumber);
  row.getCell(1).value = '合成员工';
  row.getCell(2).value = `SYNTHETIC-${rowNumber}`;
  return row;
}

async function parse(workbook: ExcelJS.Workbook) {
  return parseEmployeeRosterExcel(Buffer.from(await workbook.xlsx.writeBuffer()));
}

describe('current two-sheet employee roster', () => {
  it('excludes both header rows and includes hidden former staff with distinct global keys', async () => {
    const workbook = new ExcelJS.Workbook();
    const active = person(currentSheet(workbook));
    active.getCell(14).value = '正式';
    const formerSheet = currentSheet(workbook, '离职');
    const former = person(formerSheet);
    former.hidden = true;
    former.getCell(18).value = '正式';
    former.getCell(12).value = '2026-04-30';
    former.getCell(13).value = '2026-04-20';
    former.getCell(20).value = '2025-01-01';
    former.getCell(47).value = '2026-05-01';
    former.getCell(49).value = '2026-06-01';
    former.getCell(52).value = 'SYNTHETIC-BANK';
    former.getCell(53).value = '是';
    const rows = await parse(workbook);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(rows[0]).toMatchObject({ source: { sheetName: '在职整理', rowNumber: 3 }, employee: { employeeStatusText: '在职' } });
    expect(rows[1]).toMatchObject({
      source: { sheetName: '离职', rowNumber: 3 },
      employee: { employeeStatusText: '已离职', leaveDate: new Date('2026-04-20'), payrollCutoffDate: new Date('2026-04-30'), plannedRegularDate: null },
      profile: { socialSecurityStartDate: null, housingFundStartDate: null, socialSecurityStopDate: new Date('2026-05-01'), housingFundStopDate: new Date('2026-06-01'), bankAccount: 'SYNTHETIC-BANK' },
      contracts: [],
      sourceFields: { T3: '2025-01-01', BA3: '是' },
    });
  });

  it('only accepts the current layout when its contract and insurance headers match', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = currentSheet(workbook);
    person(sheet);
    sheet.getRow(2).getCell(52).value = '社保缴纳';
    await expect(parse(workbook)).rejects.toThrow(/表头/);
  });

  it('splits multiple renewal ranges and preserves known dates without inventing signing dates', async () => {
    const workbook = new ExcelJS.Workbook();
    const row = person(currentSheet(workbook));
    row.getCell(49).value = '考勤规则';
    row.getCell(52).value = '合成劳动合同';
    row.getCell(61).value = '2020-01-01';
    row.getCell(62).value = '2020-12-31';
    row.getCell(64).value = '2021-01-01';
    row.getCell(65).value = '2021-12-31';
    row.getCell(73).value = '2022.1.1-2022.12.31；2023.1.1-2023.12.31；2024.1.1-2024.12.31；2025.1.1-2025.12.31；2026/1/1-2026/12/31；';
    row.getCell(59).value = '2026-01-01';
    row.getCell(60).value = '2026-12-31';
    const [parsed] = await parse(workbook);
    expect(parsed.contracts).toHaveLength(7);
    expect(parsed.contracts.map((contract) => contract.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parsed.contracts[0]).toMatchObject({ kind: 'contract', signedAt: new Date('2020-01-01'), expiresAt: new Date('2020-12-31'), name: '合成劳动合同' });
    expect(parsed.contracts[1]).toMatchObject({ kind: 'renewal', signedAt: null, effectiveFrom: new Date('2021-01-01') });
    expect(parsed.contracts[6]).toMatchObject({ kind: 'renewal', effectiveFrom: new Date('2026-01-01'), expiresAt: new Date('2026-12-31'), sourceCells: ['BU3', 'BV3'] });
  });

  it('reads a former renewal range in an end cell without treating the stop dates as contracts', async () => {
    const workbook = new ExcelJS.Workbook();
    const row = person(currentSheet(workbook, '离职'));
    row.getCell(69).value = '2024.9.23-2029.9.22';
    row.getCell(47).value = '未缴';
    const [parsed] = await parse(workbook);
    expect(parsed.contracts).toHaveLength(1);
    expect(parsed.contracts[0]).toMatchObject({ kind: 'renewal', signedAt: null, effectiveFrom: new Date('2024-09-23'), expiresAt: new Date('2029-09-22') });
    expect(parsed.profile.socialSecurityStartDate).toBeNull();
  });

  it('retains ambiguous raw dates and flags incomplete contracts without assuming an open end', async () => {
    const workbook = new ExcelJS.Workbook();
    const row = person(currentSheet(workbook));
    row.getCell(61).value = '2015/616';
    row.getCell(62).value = '2020-02-30';
    row.getCell(63).value = '3年';
    row.getCell(64).value = '2023-01-01';
    row.getCell(65).value = '无固定期限';
    row.getCell(75).value = '合成原公司';
    row.getCell(78).value = '合成新公司';
    const [parsed] = await parse(workbook);
    expect(parsed.contracts).toHaveLength(3);
    expect(parsed.contracts[0]).toMatchObject({ signedAt: null, expiresAt: null, isOpenEnded: false });
    expect(parsed.contracts[1]).toMatchObject({ expiresAt: null, isOpenEnded: true, termText: '无固定期限' });
    expect(parsed.contracts[2]).toMatchObject({ kind: 'transfer', signedAt: null, effectiveFrom: null, expiresAt: null, isOpenEnded: false });
    expect(parsed).toMatchObject({ sourceFields: { BI3: '2015/616', BJ3: '2020-02-30' }, warnings: expect.arrayContaining([
      expect.objectContaining({ field: 'contracts.signedAt', code: 'invalid_date', contractSequence: 0 }),
      expect.objectContaining({ field: 'contracts.expiresAt', code: 'missing', contractSequence: 2 }),
    ]) });
  });

  it('preserves an unmatched latest summary as an unclassified candidate', async () => {
    const workbook = new ExcelJS.Workbook();
    const row = person(currentSheet(workbook));
    row.getCell(61).value = '2020-01-01';
    row.getCell(62).value = '2021-01-01';
    row.getCell(59).value = '2025-10-01';
    row.getCell(60).value = '2028-09-30';
    const [parsed] = await parse(workbook);
    expect(parsed.contracts).toHaveLength(2);
    expect(parsed.contracts[1]).toMatchObject({ kind: 'unclassified', signedAt: new Date('2025-10-01'), expiresAt: new Date('2028-09-30'), sourceCells: ['BG3', 'BH3'] });
    expect(parsed).toMatchObject({ warnings: expect.arrayContaining([expect.objectContaining({ field: 'contracts.kind', code: 'review', contractSequence: 1 })]) });
  });

  it('uses the workbook epoch for numeric dates and rejects partial date strings', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.properties.date1904 = true;
    const row = person(currentSheet(workbook));
    row.getCell(11).value = 0;
    row.getCell(43).value = '2024年';
    const [parsed] = await parse(workbook);
    expect(parsed.employee.entryDate).toEqual(new Date('1904-01-01'));
    expect(parsed.profile.socialSecurityStartDate).toBeNull();
    expect(parsed).toMatchObject({ warnings: expect.arrayContaining([expect.objectContaining({ field: 'profile.socialSecurityStartDate', code: 'invalid_date' })]) });
  });

  it('does not flag birth dates successfully recovered from the identity field after a broken cached formula', async () => {
    const workbook = new ExcelJS.Workbook();
    const row = person(currentSheet(workbook));
    row.getCell(37).value = '000000199001020000';
    row.getCell(21).value = { formula: 'TEXT(MID(AK3,7,8),"0000-00-00")', result: '1990-01-02' };
    row.getCell(21).numFmt = 'mm-dd-yy';
    const [parsed] = await parse(workbook);
    expect(parsed.profile.birthDate).toEqual(new Date('1990-01-02'));
    expect(parsed).toMatchObject({ warnings: expect.not.arrayContaining([expect.objectContaining({ field: 'profile.birthDate' })]) });
  });
});
