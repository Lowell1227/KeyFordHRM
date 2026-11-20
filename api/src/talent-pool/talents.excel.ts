import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { serializeTalentSalary, type StoredTalentSalary } from './talent-salary';
import { EDUCATION_LABELS, TALENT_SOURCE_LABELS, TALENT_STATUS_LABELS, TALENT_TAG_LABELS, TALENT_EMPLOYMENT_STATUS_LABELS } from './talent.constants';
import { TALENT_RESERVE_REASON_LABELS, TALENT_RESERVE_REASONS } from './talent-recruitment-policy';
import type { TalentEmploymentStatus } from './talent-employment';
import { TALENT_APPLICATION_STAGE_LABELS } from './talent-application-filter';

export const TALENT_EXPORT_MAX_ROWS = 5000;

export interface TalentExportApplication {
  id: string; positionName: string; stage: string; ownerName: string | null;
  recruitmentBatch?: string | null; departmentNameSnapshot?: string | null; expectedEntryDate?: Date | null;
  reserveReasons?: string[];
}
export interface TalentExportCandidate extends StoredTalentSalary {
  id: string; name: string; phone: string; ownerName: string | null; status: string; sourceChannel: string;
  appliedPosition?: string | null; currentCompany?: string | null; currentPosition?: string | null;
  yearsOfExperience?: number | null; education?: string | null; school?: string | null; major?: string | null;
  expectCity?: string | null; tags: string[]; updatedAt: Date; nextFollowUpAt: Date | null;
  applications: TalentExportApplication[];
  employmentStatus?: TalentEmploymentStatus | null;
}

const columns = [
  ['name', '姓名', 18], ['phone', '手机', 18], ['ownerName', '人才负责人', 16],
  ['position', '应聘岗位', 24], ['department', '应聘部门', 24], ['stage', '应聘阶段', 18],
  ['batch', '招聘批次', 18], ['applicationOwner', '应聘负责人', 16], ['entryDate', '预计到岗', 16],
  ['reserveReasons', '储备原因（累计）', 32], ['employmentStatus', '员工当前状态', 18],
  ['appliedPosition', '意向岗位', 24], ['currentCompany', '当前公司', 24], ['currentPosition', '当前职位', 24],
  ['experience', '工作年限', 12], ['education', '学历', 14], ['school', '院校', 24], ['major', '专业', 20], ['city', '期望城市', 18],
  ['salaryMin', '期望薪资下限（元/月）', 24], ['salaryMax', '期望薪资上限（元/月）', 24], ['salaryReview', '薪资核对状态', 20],
  ['source', '来源', 16], ['status', '人才状态', 16], ['tags', '人才标签', 28], ['nextFollowUp', '下次跟进', 16],
  ['updatedAt', '更新时间（北京时间）', 24],
] as const;
const date = (value?: Date | null) => value ? value.toISOString().slice(0, 10) : '';
const label = (labels: Record<string, string>, value?: string | null) => value ? labels[value] ?? value : '';
const updatedFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function toTalentExportRows(items: TalentExportCandidate[]): Array<Record<string, string | number | null>> {
  const total = items.reduce((count, item) => count + Math.max(1, item.applications.length), 0);
  if (total > TALENT_EXPORT_MAX_ROWS) throw new BadRequestException(`导出超过${TALENT_EXPORT_MAX_ROWS}行，请缩小筛选范围`);
  return items.flatMap(item => {
    const salary = serializeTalentSalary(item);
    return (item.applications.length ? item.applications : [null]).map(application => ({
      candidateId: item.id, name: item.name, phone: item.phone, ownerName: item.ownerName ?? '',
      applicationId: application?.id ?? '', position: application?.positionName ?? '', department: application?.departmentNameSnapshot ?? '',
      stage: label(TALENT_APPLICATION_STAGE_LABELS, application?.stage), batch: application?.recruitmentBatch ?? '',
      applicationOwner: application?.ownerName ?? '', entryDate: date(application?.expectedEntryDate),
      reserveReasons: TALENT_RESERVE_REASONS.filter(reason => application?.reserveReasons?.includes(reason)).map(reason => TALENT_RESERVE_REASON_LABELS[reason]).join('、'),
      employmentStatus: item.employmentStatus ? TALENT_EMPLOYMENT_STATUS_LABELS[item.employmentStatus] : '',
      appliedPosition: item.appliedPosition ?? '', currentCompany: item.currentCompany ?? '', currentPosition: item.currentPosition ?? '',
      experience: item.yearsOfExperience ?? null, education: label(EDUCATION_LABELS, item.education), school: item.school ?? '', major: item.major ?? '', city: item.expectCity ?? '',
      salaryMin: salary.expectSalaryMinYuan, salaryMax: salary.expectSalaryMaxYuan, salaryReview: salary.salaryNeedsReview ? '历史薪资待核对' : '',
      source: label(TALENT_SOURCE_LABELS, item.sourceChannel), status: label(TALENT_STATUS_LABELS, item.status),
      tags: item.tags.map(tag => label(TALENT_TAG_LABELS, tag)).join('、'), nextFollowUp: date(item.nextFollowUpAt), updatedAt: updatedFormat.format(item.updatedAt),
    }));
  });
}
export function buildTalentWorkbook(items: TalentExportCandidate[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRM';
  const sheet = workbook.addWorksheet('人才应聘记录', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([key, header, width]) => ({ key, header, width,
    style: { numFmt: ['salaryMin', 'salaryMax', 'experience'].includes(key) ? '0' : '@' } }));
  // ExcelJS writes strings as text, including strings that begin with =, +, - or @.
  sheet.addRows(toTalentExportRows(items));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: columns.length } };
  return workbook;
}
