import * as ExcelJS from 'exceljs';
import { IndicatorType } from '@prisma/client';

export const IMPORT_COLUMNS = [
  { key: 'code', header: '编码', width: 20 },
  { key: 'name', header: '名称', width: 30 },
  { key: 'type', header: '类型', width: 15 },
  { key: 'category', header: '分类', width: 20 },
  { key: 'groupName', header: '分组', width: 20 },
  { key: 'description', header: '描述', width: 40 },
  { key: 'scoringStandard', header: '评分标准', width: 40 },
  { key: 'dataSource', header: '数据来源', width: 40 },
  { key: 'dataCaliber', header: '数据口径', width: 40 },
  { key: 'targetValue', header: '参考目标值', width: 15 },
  { key: 'unit', header: '单位', width: 10 },
] as const;

export interface ImportRow {
  code?: string;
  name: string;
  type?: IndicatorType;
  category?: string;
  groupName?: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueInvalid?: boolean;
  unit?: string;
}

const TYPE_TEXT_MAP: Record<string, IndicatorType> = {
  '量化kpi': 'kpi',
  kpi: 'kpi',
  '态度行为': 'attitude',
  attitude: 'attitude',
  '加分项': 'bonus',
  bonus: 'bonus',
  '扣分项': 'penalty',
  penalty: 'penalty',
  '一票否决': 'veto',
  veto: 'veto',
};

const ENUM_TO_TEXT_MAP: Record<IndicatorType, string> = {
  kpi: '量化KPI',
  attitude: '态度行为',
  bonus: '加分项',
  penalty: '扣分项',
  veto: '一票否决',
};

export function typeTextToEnum(text: string): IndicatorType | undefined {
  const normalized = text.trim().toLowerCase();
  return TYPE_TEXT_MAP[normalized];
}

export function enumToTypeText(type: IndicatorType): string {
  return ENUM_TO_TEXT_MAP[type] ?? type;
}

export async function parseImportExcel(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const getValue = (row: ExcelJS.Row, col: number): string | number | undefined => {
    const cell = row.getCell(col);
    const val = cell.value;
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && 'text' in val) {
      // RichText
      return String(val.text).trim();
    }
    return String(val).trim();
  };

  const rows: ImportRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const code = getValue(row, 1) as string | undefined;
    const name = getValue(row, 2) as string | undefined;
    const typeText = getValue(row, 3) as string | undefined;
    const category = getValue(row, 4) as string | undefined;
    const groupName = getValue(row, 5) as string | undefined;
    const description = getValue(row, 6) as string | undefined;
    const scoringStandard = getValue(row, 7) as string | undefined;
    const dataSource = getValue(row, 8) as string | undefined;
    const dataCaliber = getValue(row, 9) as string | undefined;
    const targetValueRaw = getValue(row, 10);
    const unit = getValue(row, 11) as string | undefined;

    const type = typeText ? typeTextToEnum(String(typeText)) : undefined;
    let targetValue: number | undefined;
    let targetValueInvalid = false;
    if (targetValueRaw !== undefined && targetValueRaw !== '') {
      const num = Number(targetValueRaw);
      if (Number.isNaN(num)) {
        targetValueInvalid = true;
      } else {
        targetValue = num;
      }
    }

    rows.push({
      code,
      name: name ?? '',
      type,
      category,
      groupName,
      description,
      scoringStandard,
      dataSource,
      dataCaliber,
      targetValue,
      targetValueInvalid,
      unit,
    });
  });

  return rows;
}

export async function buildExportWorkbook(
  indicators: Array<{
    code?: string | null;
    name: string;
    type: IndicatorType;
    category?: string | null;
    groupName?: string | null;
    description?: string | null;
    scoringStandard?: string | null;
    dataSource?: string | null;
    dataCaliber?: string | null;
    targetValue?: number | string | null;
    unit?: string | null;
  }>,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('指标库');

  worksheet.columns = IMPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  indicators.forEach((item) => {
    worksheet.addRow({
      code: item.code ?? '',
      name: item.name,
      type: enumToTypeText(item.type),
      category: item.category ?? '',
      groupName: item.groupName ?? '',
      description: item.description ?? '',
      scoringStandard: item.scoringStandard ?? '',
      dataSource: item.dataSource ?? '',
      dataCaliber: item.dataCaliber ?? '',
      targetValue: item.targetValue ?? '',
      unit: item.unit ?? '',
    });
  });

  return workbook;
}

export async function buildTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('指标导入模板');

  worksheet.columns = IMPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  // Example row
  worksheet.addRow({
    code: 'KPI-001',
    name: '销售额完成率',
    type: '量化KPI',
    category: '财务类',
    groupName: '销售部',
    description: '考核期内实际销售额与目标销售额之比',
    scoringStandard: '100%得满分，每低1%扣2分',
    dataSource: 'ERP销售报表',
    dataCaliber: '以财务确认收入为准，剔除退货',
    targetValue: 100,
    unit: '%',
  });

  return workbook;
}
