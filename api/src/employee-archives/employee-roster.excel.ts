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
  signingCompany?: string | null;
  signedAt: Date | null;
  effectiveFrom?: Date | null;
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

const PROFILE_HEADERS = [
  '姓名*', '工号*', '手机号', '性别', '出生日期', '民族', '学历', '职称', '毕业院校', '毕业日期', '专业',
  '婚姻状况', '子女状况', '子女数量', '政治面貌', '籍贯', '户籍类型', '身份证地址', '身份证号', '现住址',
  '紧急联系人', '紧急联系人关系', '紧急联系人电话', '社保状态', '社保起始日期', '公积金状态',
  '公积金起始日期', '开户行', '开户支行', '银行卡号',
];

const EMPLOYMENT_HEADERS = [
  '工号*', '所属公司*', '一级部门*', '二级部门', '三级部门', '岗位', '职级', '职系', '花名册直属主管',
  '入职日期*', '工作地点', '用工类型', '员工状态', '试用期（月）', '预计转正日期', '实际转正日期',
];

const CONTRACT_HEADERS = [
  '工号*', '合同序号*', '合同类型*', '合同名称', '签约公司', '签订日期', '生效日期', '到期日期',
  '合同期限', '原公司', '新公司', '保密协议', '竞业协议', '肖像协议',
];

export async function buildEmployeeRosterTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KeyFord HRM';
  workbook.created = new Date();

  const profileSheet = workbook.addWorksheet('员工主档');
  profileSheet.addRow(PROFILE_HEADERS);
  profileSheet.addRow([
    '张三', 'KF0001', '13800000000', '女', new Date(Date.UTC(1995, 0, 1)), '汉族', '本科', '',
    '示例大学', new Date(Date.UTC(2017, 5, 30)), '人力资源', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '',
  ]);
  styleTemplateSheet(profileSheet, PROFILE_HEADERS.length, [5, 10, 25, 27], [2, 3, 19, 23, 30]);

  const employmentSheet = workbook.addWorksheet('任职记录');
  employmentSheet.addRow(EMPLOYMENT_HEADERS);
  employmentSheet.addRow([
    'KF0001', '孚德', '人事部', '', '', 'HR专员', '', '', '姚遥', new Date(Date.UTC(2026, 7, 1)),
    '上海', '全职', '在职', 3, new Date(Date.UTC(2026, 10, 1)), '',
  ]);
  styleTemplateSheet(employmentSheet, EMPLOYMENT_HEADERS.length, [10, 15, 16], [1]);

  const contractSheet = workbook.addWorksheet('合同记录');
  contractSheet.addRow(CONTRACT_HEADERS);
  contractSheet.addRow([
    'KF0001', 1, '首签', '劳动合同', '孚德', new Date(Date.UTC(2026, 7, 1)),
    new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2029, 6, 31)), '3年', '', '', '已签', '无', '已签',
  ]);
  styleTemplateSheet(contractSheet, CONTRACT_HEADERS.length, [6, 7, 8], [1]);

  const notes = workbook.addWorksheet('填写说明');
  notes.addRows([
    ['花名册 V2 填写说明'],
    ['模板版本', 'roster-v2-2026-09'],
    ['关联方式', '员工主档、任职记录和合同记录均使用工号关联。员工主档及任职记录每个工号各填一行；合同记录可填多行。'],
    ['必填字段', '带 * 的字段为必填。日期请填写 Excel 日期或 YYYY-MM-DD。'],
    ['公司', '孚德、北京孚德、孚德体育文化、凡思堡。'],
    ['用工类型', '全职、兼职、返聘、外包。'],
    ['员工状态', '在职、试用期、待入职、已离职。'],
    ['合同类型', '首签、续签、转签。合同序号从 1 开始，同一工号内不得重复。'],
    ['数据生效', '上传后先生成差异预检，确认后提交人事审核；审核通过后才写入正式档案。'],
    ['主数据边界', '组织和人员以本花名册及 HRM 员工档案为准；钉钉仅用于登录和身份绑定。'],
    ['示例数据', '三个业务工作表的第 2 行仅用于说明，正式导入前请删除。'],
    ['旧模板兼容', '旧版 81 列花名册仍可上传；新下载模板统一使用本 V2 结构。'],
  ]);
  notes.getColumn(1).width = 16;
  notes.getColumn(2).width = 110;
  notes.getRow(1).font = { bold: true, size: 16 };
  notes.getRow(1).height = 28;
  notes.getColumn(2).alignment = { vertical: 'top', wrapText: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseEmployeeRosterExcel(buffer: Buffer): Promise<ParsedEmployeeRosterRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  if (workbook.getWorksheet('员工主档') && workbook.getWorksheet('任职记录')) {
    return parseV2Workbook(workbook);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  return parseLegacyWorksheet(worksheet);
}

function parseV2Workbook(workbook: ExcelJS.Workbook): ParsedEmployeeRosterRow[] {
  const profileSheet = workbook.getWorksheet('员工主档')!;
  const employmentSheet = workbook.getWorksheet('任职记录')!;
  const contractSheet = workbook.getWorksheet('合同记录');
  const employmentByEmployeeNo = new Map<string, ParsedRosterEmployee>();
  const contractsByEmployeeNo = new Map<string, ParsedRosterContract[]>();

  employmentSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const employeeNo = readText(row, 1);
    if (!employeeNo || employmentByEmployeeNo.has(employeeNo)) return;
    employmentByEmployeeNo.set(employeeNo, {
      name: null,
      employeeNo,
      companyText: readText(row, 2),
      departmentPath: [readText(row, 3), readText(row, 4), readText(row, 5)]
        .filter((value): value is string => Boolean(value)),
      position: readText(row, 6),
      jobGrade: readText(row, 7),
      jobFamily: readText(row, 8),
      managerName: readText(row, 9),
      entryDate: readDate(row, 10),
      workLocation: readText(row, 11),
      employmentTypeText: readText(row, 12),
      employeeStatusText: readText(row, 13),
      probationMonths: readInteger(row, 14),
      plannedRegularDate: readDate(row, 15),
      actualRegularDate: readDate(row, 16),
    });
  });

  contractSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const employeeNo = readText(row, 1);
    if (!employeeNo) return;
    const contracts = contractsByEmployeeNo.get(employeeNo) ?? [];
    const inputSequence = readInteger(row, 2) ?? contracts.length + 1;
    contracts.push({
      sequence: Math.max(0, inputSequence - 1),
      kind: mapContractKind(readText(row, 3)),
      name: readText(row, 4),
      signingCompany: readText(row, 5),
      signedAt: readDate(row, 6),
      effectiveFrom: readDate(row, 7),
      expiresAt: readDate(row, 8),
      termText: readText(row, 9),
      originalCompany: readText(row, 10),
      newCompany: readText(row, 11),
      confidentialityAgreement: readText(row, 12),
      nonCompeteAgreement: readText(row, 13),
      portraitAgreement: readText(row, 14),
    });
    contractsByEmployeeNo.set(employeeNo, contracts);
  });

  const rows: ParsedEmployeeRosterRow[] = [];
  profileSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = readText(row, 1);
    const employeeNo = readText(row, 2);
    if (!name && !employeeNo) return;
    const employment = employeeNo ? employmentByEmployeeNo.get(employeeNo) : undefined;
    const idNumber = readText(row, 19);
    rows.push({
      rowNumber,
      employee: employment
        ? { ...employment, name, employeeNo }
        : emptyParsedEmployee(name, employeeNo),
      profile: {
        phone: readText(row, 3),
        gender: readText(row, 4),
        birthDate: readDate(row, 5) ?? birthDateFromId(idNumber),
        ethnicity: readText(row, 6),
        education: readText(row, 7),
        professionalTitle: readText(row, 8),
        school: readText(row, 9),
        graduationDate: readDate(row, 10),
        major: readText(row, 11),
        maritalStatus: readText(row, 12),
        childrenStatus: readText(row, 13),
        childrenCount: readInteger(row, 14),
        politicalStatus: readText(row, 15),
        nativePlace: readText(row, 16),
        householdType: readText(row, 17),
        idAddress: readText(row, 18),
        idNumber,
        currentAddress: readText(row, 20),
        emergencyContactName: readText(row, 21),
        emergencyContactRelation: readText(row, 22),
        emergencyContactPhone: readText(row, 23),
        socialSecurityStatus: readText(row, 24),
        socialSecurityStartDate: readDate(row, 25),
        housingFundStatus: readText(row, 26),
        housingFundStartDate: readDate(row, 27),
        bankName: readText(row, 28),
        bankBranch: readText(row, 29),
        bankAccount: readText(row, 30),
      },
      contracts: employeeNo
        ? [...(contractsByEmployeeNo.get(employeeNo) ?? [])].sort((left, right) => left.sequence - right.sequence)
        : [],
    });
  });

  return rows;
}

function parseLegacyWorksheet(worksheet: ExcelJS.Worksheet): ParsedEmployeeRosterRow[] {
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

function emptyParsedEmployee(name: string | null, employeeNo: string | null): ParsedRosterEmployee {
  return {
    name,
    employeeNo,
    companyText: null,
    departmentPath: [],
    position: null,
    jobGrade: null,
    jobFamily: null,
    managerName: null,
    entryDate: null,
    workLocation: null,
    employmentTypeText: null,
    employeeStatusText: null,
    probationMonths: null,
    plannedRegularDate: null,
    actualRegularDate: null,
  };
}

function mapContractKind(value: string | null): ParsedRosterContract['kind'] {
  if (value === '续签' || value === 'renewal') return 'renewal';
  if (value === '转签' || value === 'transfer') return 'transfer';
  return 'contract';
}

function styleTemplateSheet(
  sheet: ExcelJS.Worksheet,
  columnCount: number,
  dateColumns: number[],
  textColumns: number[],
) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(1).height = 34;
  sheet.columns.forEach((column, index) => {
    column.width = index < 12 ? 16 : 18;
    column.alignment = { vertical: 'middle', wrapText: true };
  });
  dateColumns.forEach((column) => { sheet.getColumn(column).numFmt = 'yyyy-mm-dd'; });
  textColumns.forEach((column) => { sheet.getColumn(column).numFmt = '@'; });
  sheet.autoFilter = { from: 'A1', to: sheet.getCell(1, columnCount).address };
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
      signingCompany: null,
      signedAt,
      effectiveFrom: signedAt,
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
      signingCompany: null,
      signedAt,
      effectiveFrom: signedAt,
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

  return birthDateFromId(readText(row, 37));
}

function birthDateFromId(value: string | null): Date | null {
  const idNumber = value?.replace(/\s+/g, '');
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
