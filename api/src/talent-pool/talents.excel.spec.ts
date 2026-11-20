import * as ExcelJS from 'exceljs';
import { buildTalentWorkbook, toTalentExportRows, type TalentExportCandidate } from './talents.excel';

function exportCandidate(patch = {}): TalentExportCandidate {
  return { id: 'candidate-one', name: '=SUM(1,2)', phone: '01700000000', ownerName: '虚构经办', status: 'new',
    sourceChannel: 'referral', appliedPosition: '职能', currentCompany: '虚构公司', currentPosition: '职员', yearsOfExperience: 3,
    education: 'bachelor', school: '虚构院校', major: '财务', expectCity: '广州', tags: ['functional'],
    expectSalaryMin: 5501, expectSalaryMax: 6809, expectSalaryUnit: 'yuan', updatedAt: new Date('2026-11-20T00:00:00Z'),
    nextFollowUpAt: new Date('2026-11-25T00:00:00Z'), applications: [
      { id: 'finance', positionName: '财务', departmentNameSnapshot: '虚构财务部', stage: 'rejected', recruitmentBatch: '秋季', ownerName: '虚构经办', expectedEntryDate: null },
      { id: 'operations', positionName: '运营', departmentNameSnapshot: '虚构运营部', stage: 'interviewing', recruitmentBatch: '冬季', ownerName: '虚构经办', expectedEntryDate: null },
    ], ...patch };
}

describe('talent application Excel workbook', () => {
  it('writes every application as a row, keeps a candidate without applications, and preserves exact numeric yuan', async () => {
    const workbook = buildTalentWorkbook([exportCandidate(), exportCandidate({ id: 'candidate-two', name: '虚构未应聘人才', applications: [] })]);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = reopened.getWorksheet('人才应聘记录')!;
    const headers = sheet.getRow(1).values as string[];
    const cell = (row: number, label: string) => sheet.getRow(row).getCell(headers.indexOf(label));
    expect(sheet.rowCount).toBe(4);
    expect(headers).not.toContain('人才ID'); expect(headers).not.toContain('应聘ID');
    expect([cell(2, '应聘岗位').value, cell(3, '应聘岗位').value, cell(4, '应聘岗位').value]).toEqual(['财务', '运营', '']);
    expect(cell(2, '应聘阶段').value).toBe('已淘汰');
    expect(cell(2, '期望薪资下限（元/月）').value).toBe(5501);
    expect(cell(2, '期望薪资上限（元/月）').value).toBe(6809);
    expect(cell(2, '下次跟进').value).toBe('2026-11-25');
    expect(cell(2, '姓名').value).toBe('=SUM(1,2)');
    expect(cell(2, '姓名').type).toBe(ExcelJS.ValueType.String);
    expect(cell(2, '手机').value).toBe('01700000000');
    expect(cell(2, '手机').numFmt).toBe('@');
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('leaves suspicious historical salary blank and excludes free notes, files and timeline data', () => {
    const rows = toTalentExportRows([exportCandidate({ expectSalaryUnit: 'legacy_k', expectSalaryMin: 999, expectSalaryMax: 12,
      note: 'private-note', files: [{ objectKey: 'private-file' }], events: ['private-event'] })]);
    expect(rows[0]).toMatchObject({ salaryMin: null, salaryMax: null, salaryReview: '历史薪资待核对' });
    expect(JSON.stringify(rows)).not.toMatch(/private-note|private-file|private-event/);
    const yuan = toTalentExportRows([exportCandidate({ expectSalaryMin: 999, expectSalaryMax: 999 })]);
    expect(yuan[0]).toMatchObject({ salaryMin: 999, salaryMax: 999, salaryReview: '' });
  });

  it('rejects 5001 output rows even when they belong to one candidate', () => {
    const applications = Array.from({ length: 5001 }, (_, index) => ({ ...exportCandidate().applications[0], id: `app-${index}` }));
    expect(() => toTalentExportRows([exportCandidate({ applications })])).toThrow('5000');
    expect(toTalentExportRows([exportCandidate({ applications: applications.slice(0, 5000) })])).toHaveLength(5000);
  });

  it('exports cumulative distinct reserve reasons per application and current employment separately', () => {
    const applications = exportCandidate().applications.map((application, index) => ({ ...application,
      reserveReasons: index === 0 ? ['commute_distance', 'salary_expectation', 'commute_distance'] : ['work_schedule'] }));
    const rows = toTalentExportRows([exportCandidate({ status: 'hired', employmentStatus: 'resigned', applications })]);
    expect(rows[0]).toMatchObject({ reserveReasons: '通勤距离、薪资期望', employmentStatus: '已离职', status: '已入职' });
    expect(rows[1].reserveReasons).toBe('工作制偏好');
    expect(toTalentExportRows([exportCandidate()])[0].reserveReasons).toBe('');
  });
});
