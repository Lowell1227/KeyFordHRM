import * as ExcelJS from 'exceljs';

export interface ParsedRosterEmployee {
  name: string | null;
  employeeNo: string | null;
  companyText: string | null;
  departmentPath: string[];
  position: string | null;
  jobGrade: string | null;
  jobFamily: string | null;
  managerName: string | null;
  entryDate: Date | null;
  workLocation: string | null;
  employmentTypeText: string | null;
  employeeStatusText: string | null;
  probationMonths: number | null;
  plannedRegularDate: Date | null;
  actualRegularDate: Date | null;
}

export interface ParsedRosterProfile {
  phone: string | null;
  gender: string | null;
  birthDate: Date | null;
  ethnicity: string | null;
  education: string | null;
  professionalTitle: string | null;
  school: string | null;
  graduationDate: Date | null;
  major: string | null;
  maritalStatus: string | null;
  childrenStatus: string | null;
  childrenCount: number | null;
  politicalStatus: string | null;
  nativePlace: string | null;
  householdType: string | null;
  idAddress: string | null;
  idNumber: string | null;
  currentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  socialSecurityStatus: string | null;
  socialSecurityStartDate: Date | null;
  housingFundStatus: string | null;
  housingFundStartDate: Date | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
}

export interface ParsedRosterContract {
  sequence: number;
  kind: 'contract' | 'renewal' | 'transfer';
  name: string | null;
  signedAt: Date | null;
  expiresAt: Date | null;
  termText: string | null;
  originalCompany: string | null;
  newCompany: string | null;
  confidentialityAgreement: string | null;
  nonCompeteAgreement: string | null;
  portraitAgreement: string | null;
}

export interface ParsedEmployeeRosterRow {
  rowNumber: number;
  employee: ParsedRosterEmployee;
  profile: ParsedRosterProfile;
  contracts: ParsedRosterContract[];
}

const PLACEHOLDERS = new Set(['', '/', '／', '#VALUE!']);

const TEMPLATE_HEADERS = [
  '姓名*', '工号*', '所属公司*', '一级部门*', '二级部门', '三级部门', '岗位', '职级', '职系', '直属主管',
  '入职日期*', '工作地点', '用工类型', '员工状态', '试用期（月）', '预计转正日期', '实际转正日期', '预留',
  '手机号', '性别', '出生日期', '年龄（无需填写）', '预留', '民族', '学历', '职称', '毕业院校', '毕业日期', '专业',
  '婚姻状况', '子女状况', '子女数量', '政治面貌', '籍贯', '户籍类型', '身份证地址', '身份证号', '现住址',
  '紧急联系人', '紧急联系人关系', '紧急联系人电话', '社保状态', '社保起始日期', '公积金状态', '公积金起始日期',
  '开户行', '开户支行', '银行卡号', '合同名称', '保密协议', '竞业协议', '肖像协议', '预留', '预留', '预留',
  '首签日期', '首签到期日', '首签期限', '续签1日期', '续签1到期日', '续签1期限', '续签2日期', '续签2到期日', '续签2期限',
  '续签3日期', '续签3到期日', '续签3期限', '续签4日期', '续签4期限', '转签1原公司', '转签1日期', '转签1到期日', '转签1新公司',
  '转签2原公司', '转签2日期', '转签2到期日', '转签2新公司', '转签3原公司', '转签3日期', '转签3到期日', '转签3新公司',
];

export async function buildEmployeeRosterTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('员工花名册');
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.addRow([
    '张三', 'KF0001', '孚德', '人事部', '', '', 'HR专员', '', '', '姚遥', '2026-08-01', '上海', '全职', '在职', 3,
    '2026-11-01', '', '', '13800000000', '女', '1995-01-01', '', '', '汉族', '本科', '', '示例大学', '2017-06-30', '人力资源',
  ]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(1).height = 34;
  sheet.columns.forEach((column, index) => {
    column.width = index < 17 ? 16 : 18;
  });
  sheet.autoFilter = { from: 'A1', to: 'CC1' };
  const notes = workbook.addWorksheet('填写说明');
  notes.addRows([
    ['花名册导入说明'],
    ['1', '请保留模板列顺序，不要删除或新增列。'],
    ['2', '带 * 的字段为必填；日期统一填写为 YYYY-MM-DD。'],
    ['3', '组织以本花名册为准，钉钉组织不会覆盖 HRM 数据。'],
    ['4', '上传后先生成差异预检，确认后仍需审核才会生效。'],
    ['5', '示例行仅用于说明，正式导入前请删除。'],
  ]);
  notes.getColumn(1).width = 12;
  notes.getColumn(2).width = 78;
  notes.getRow(1).font = { bold: true, size: 16 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseEmployeeRosterExcel(buffer: Buffer): Promise<ParsedEmployeeRosterRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: ParsedEmployeeRosterRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = readText(row, 1);
    const employeeNo = readText(row, 2);
    if (!name && !employeeNo) return;

    const departmentPath = [readText(row, 4), readText(row, 5), readText(row, 6)]
      .filter((value): value is string => Boolean(value));

    rows.push({
      rowNumber,
      employee: {
        name,
        employeeNo,
        companyText: readText(row, 3),
        departmentPath,
        position: readText(row, 7),
        jobGrade: readText(row, 8),
        jobFamily: readText(row, 9),
        managerName: readText(row, 10),
        entryDate: readDate(row, 11),
        workLocation: readText(row, 12),
        employmentTypeText: readText(row, 13),
        employeeStatusText: readText(row, 14),
        probationMonths: readInteger(row, 15),
        plannedRegularDate: readDate(row, 16),
        actualRegularDate: readDate(row, 17),
      },
      profile: {
        phone: readText(row, 19),
        gender: readText(row, 20),
        birthDate: readBirthDate(row),
        ethnicity: readText(row, 24),
        education: readText(row, 25),
        professionalTitle: readText(row, 26),
        school: readText(row, 27),
        graduationDate: readDate(row, 28),
        major: readText(row, 29),
        maritalStatus: readText(row, 30),
        childrenStatus: readText(row, 31),
        childrenCount: readInteger(row, 32),
        politicalStatus: readText(row, 33),
        nativePlace: readText(row, 34),
        householdType: readText(row, 35),
        idAddress: readText(row, 36),
        idNumber: readText(row, 37),
        currentAddress: readText(row, 38),
        emergencyContactName: readText(row, 39),
        emergencyContactRelation: readText(row, 40),
        emergencyContactPhone: readText(row, 41),
        socialSecurityStatus: readText(row, 42),
        socialSecurityStartDate: readDate(row, 43),
        housingFundStatus: readText(row, 44),
        housingFundStartDate: readDate(row, 45),
        bankName: readText(row, 46),
        bankBranch: readText(row, 47),
        bankAccount: readText(row, 48),
      },
      contracts: parseContracts(row),
    });
  });

  return rows;
}

function parseContracts(row: ExcelJS.Row): ParsedRosterContract[] {
  const common = {
    name: readText(row, 49),
    confidentialityAgreement: readText(row, 50),
    nonCompeteAgreement: readText(row, 51),
    portraitAgreement: readText(row, 52),
  };
  const contracts: ParsedRosterContract[] = [];
  const segments = [
    { sequence: 0, start: 56, end: 57, term: 58 },
    { sequence: 1, start: 59, end: 60, term: 61 },
    { sequence: 2, start: 62, end: 63, term: 64 },
    { sequence: 3, start: 65, end: 66, term: 67 },
    { sequence: 4, start: 68, end: 0, term: 69 },
  ];

  for (const segment of segments) {
    const signedAt = readDate(row, segment.start);
    const expiresAt = segment.end ? readDate(row, segment.end) : null;
    const termText = readText(row, segment.term);
    if (!signedAt && !expiresAt && !termText) continue;
    contracts.push({
      sequence: segment.sequence,
      kind: segment.sequence === 0 ? 'contract' : 'renewal',
      ...common,
      signedAt,
      expiresAt,
      termText,
      originalCompany: null,
      newCompany: null,
    });
  }

  const transfers = [
    { sequence: 5, original: 70, signed: 71, expires: 72, next: 73 },
    { sequence: 6, original: 74, signed: 75, expires: 76, next: 77 },
    { sequence: 7, original: 78, signed: 79, expires: 80, next: 81 },
  ];
  for (const transfer of transfers) {
    const originalCompany = readText(row, transfer.original);
    const signedAt = readDate(row, transfer.signed);
    const expiresAt = readDate(row, transfer.expires);
    const newCompany = readText(row, transfer.next);
    if (!originalCompany && !signedAt && !expiresAt && !newCompany) continue;
    contracts.push({
      sequence: transfer.sequence,
      kind: 'transfer',
      ...common,
      signedAt,
      expiresAt,
      termText: null,
      originalCompany,
      newCompany,
    });
  }

  return contracts;
}

function readText(row: ExcelJS.Row, column: number): string | null {
  const cell = row.getCell(column);
  const raw = unwrapFormula(cell.value);
  let text: string;
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) text = cell.text || raw.toISOString().slice(0, 10);
  else if (typeof raw === 'object' && 'text' in raw) text = String(raw.text);
  else text = cell.text || String(raw);
  text = text.trim();
  return PLACEHOLDERS.has(text) ? null : text;
}

function readInteger(row: ExcelJS.Row, column: number): number | null {
  const text = readText(row, column);
  if (!text) return null;
  const match = /-?\d+/.exec(text);
  return match ? Number(match[0]) : null;
}

function readDate(row: ExcelJS.Row, column: number): Date | null {
  const raw = unwrapFormula(row.getCell(column).value);
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : startOfUtcDay(raw);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000);
  }
  const text = readText(row, column);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed);
}

function readBirthDate(row: ExcelJS.Row): Date | null {
  const cellValue = readDate(row, 21);
  if (cellValue) return cellValue;

  const idNumber = readText(row, 37)?.replace(/\s+/g, '');
  const match = idNumber
    ? /^\d{6}(\d{4})(\d{2})(\d{2})\d{3}[\dXx]$/.exec(idNumber)
    : null;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? candidate
    : null;
}

function unwrapFormula(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value && typeof value === 'object' && 'formula' in value) {
    return value.result as ExcelJS.CellValue;
  }
  return value;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
