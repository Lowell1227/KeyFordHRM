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
  { key: 'metric', header: '统计项', width: 22 },
  { key: 'value', header: '数值', width: 15 },
  { key: 'note', header: '口径说明', width: 36 },
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
    resulted: number;
    pending: number;
    qualified: number;
    qualifiedRate: number;
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

  statsSheet.addRow({ metric: '应参评', value: data.stats.total, note: '本周期应参加绩效评估的人数' });
  statsSheet.addRow({ metric: '已出结果', value: data.stats.resulted, note: '已有最终绩效等级的人数' });
  statsSheet.addRow({ metric: '待出结果', value: data.stats.pending, note: '尚未形成最终绩效等级的人数' });
  statsSheet.addRow({
    metric: '已出结果合格率',
    value: `${(data.stats.qualifiedRate * 100).toFixed(1)}%`,
    note: 'A/B/C 人数 ÷ 已出结果人数；未出结果不计为不合格',
  });

  const grades: PerfGrade[] = ['A', 'B', 'C', 'D'];
  for (const grade of grades) {
    const entry = data.stats.grades[grade];
    statsSheet.addRow({
      metric: `${grade} 等级人数`,
      value: entry?.count ?? 0,
      note: `占已出结果人数 ${entry?.ratio != null ? `${(entry.ratio * 100).toFixed(1)}%` : '0.0%'}`,
    });
  }

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
