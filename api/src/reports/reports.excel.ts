import * as ExcelJS from 'exceljs';
import { PerfGrade } from '@prisma/client';

/** 汇总/导出明细通用列定义（JSON 与 Excel 同源）。 */
export const SUMMARY_COLUMNS = [
  { key: 'employeeName', header: '姓名', width: 15 },
  { key: 'employeeNo', header: '工号', width: 15 },
  { key: 'deptName', header: '部门', width: 20 },
  { key: 'position', header: '职位', width: 20 },
  { key: 'totalScore', header: '总分', width: 12 },
  { key: 'grade', header: '等级', width: 10 },
  { key: 'managerName', header: '主管', width: 15 },
] as const;

/** A/D 级名单列定义（与汇总明细同源）。 */
export const GRADE_LIST_COLUMNS = SUMMARY_COLUMNS;

/** 汇总报表统计页列定义。 */
const STATS_COLUMNS = [
  { key: 'grade', header: '等级', width: 10 },
  { key: 'count', header: '人数', width: 12 },
  { key: 'ratio', header: '比例', width: 12 },
] as const;

/** 报表明细项（JSON 与 Excel 同源）。 */
export interface ReportItem {
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  position: string | null;
  totalScore: number | null;
  grade: PerfGrade | null;
  managerName: string | null;
}

export interface SummaryExcelData {
  stats: {
    total: number;
    grades: Record<PerfGrade, { count: number; ratio: number }>;
  };
  items: ReportItem[];
}

export interface ExportExcelData {
  items: ReportItem[];
}

function addItemsWorksheet(workbook: ExcelJS.Workbook, items: ReportItem[], sheetName: string) {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = SUMMARY_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  for (const item of items) {
    worksheet.addRow({
      employeeName: item.employeeName ?? '',
      employeeNo: item.employeeNo ?? '',
      deptName: item.deptName ?? '',
      position: item.position ?? '',
      totalScore: item.totalScore ?? '',
      grade: item.grade ?? '',
      managerName: item.managerName ?? '',
    });
  }

  return worksheet;
}

/** 构建汇总报表 Excel：包含“统计”和“明细”两个工作表。 */
export async function buildSummaryWorkbook(data: SummaryExcelData): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  const statsSheet = workbook.addWorksheet('统计');
  statsSheet.columns = STATS_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  const grades: PerfGrade[] = ['A', 'B', 'C', 'D'];
  for (const grade of grades) {
    const entry = data.stats.grades[grade];
    statsSheet.addRow({
      grade,
      count: entry?.count ?? 0,
      ratio: entry?.ratio != null ? `${(entry.ratio * 100).toFixed(1)}%` : '0.0%',
    });
  }
  statsSheet.addRow({ grade: '合计', count: data.stats.total, ratio: '100.0%' });

  addItemsWorksheet(workbook, data.items, '明细');

  return workbook;
}

/** 构建当期全量导出 Excel：仅“考核明细”一个工作表。 */
export async function buildExportWorkbook(data: ExportExcelData): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  addItemsWorksheet(workbook, data.items, '考核明细');
  return workbook;
}

/** 构建 A/C/D 级名单 Excel，含三个工作表。 */
export async function buildGradeListWorkbook(data: {
  aList: ReportItem[];
  cList: ReportItem[];
  dList: ReportItem[];
}): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  addItemsWorksheet(workbook, data.aList, 'A 级名单');
  addItemsWorksheet(workbook, data.cList, 'C 级名单');
  addItemsWorksheet(workbook, data.dList, 'D 级名单');
  return workbook;
}
