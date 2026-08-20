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
        birthDate: readDate(row, 21),
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
  if (raw instanceof Date) return startOfUtcDay(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000);
  }
  const text = readText(row, column);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed);
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
