import * as ExcelJS from 'exceljs';
import { buildEmployeeRosterTemplate, parseEmployeeRosterExcel } from './employee-roster.excel';

describe('parseEmployeeRosterExcel', () => {
  it('生成按当前数据库业务对象拆分的 V2 模板', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildEmployeeRosterTemplate() as any);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '员工主档',
      '任职记录',
      '合同记录',
      '填写说明',
    ]);
    expect(workbook.getWorksheet('员工主档')?.getRow(1).values).toEqual(expect.arrayContaining([
      '姓名*',
      '工号*',
      '身份证号',
      '银行卡号',
    ]));
    expect(workbook.getWorksheet('任职记录')?.getRow(1).values).toEqual(expect.arrayContaining([
      '工号*',
      '所属公司*',
      '一级部门*',
      '岗位*',
      '花名册直属主管',
    ]));
    expect(workbook.getWorksheet('合同记录')?.getRow(1).values).toEqual(expect.arrayContaining([
      '工号*',
      '合同序号*',
      '合同类型*',
      '签约公司',
      '生效日期',
    ]));
    const allHeaders = workbook.worksheets.flatMap((sheet) => {
      const values = sheet.getRow(1).values;
      return Array.isArray(values) ? values : Object.values(values);
    });
    expect(allHeaders).not.toContain('预留');
  });

  it('按工作表名称解析 V2 员工、当前任职和多条合同并忽略孤立子记录', async () => {
    const workbook = new ExcelJS.Workbook();
    const contractSheet = workbook.addWorksheet('合同记录');
    contractSheet.addRow([
      '工号*', '合同序号*', '合同类型*', '合同名称', '签约公司', '签订日期', '生效日期', '到期日期',
      '合同期限', '原公司', '新公司', '保密协议', '竞业协议', '肖像协议',
    ]);
    contractSheet.addRow(['007', 2, '续签', '劳动合同', '孚德', '2025-01-02', '2025-01-02', '2027-01-01', '2年']);
    contractSheet.addRow(['007', 1, '首签', '劳动合同', '孚德', '2024-01-02', '2024-01-02', '2025-01-01', '1年']);
    contractSheet.addRow(['999', 1, '首签', '孤立合同']);

    workbook.addWorksheet('填写说明').addRow(['花名册 V2']);

    const employmentSheet = workbook.addWorksheet('任职记录');
    employmentSheet.addRow([
      '工号*', '所属公司*', '一级部门*', '二级部门', '三级部门', '岗位', '职级', '职系',
      '花名册直属主管', '入职日期*', '工作地点', '用工类型', '员工状态', '试用期（月）',
      '预计转正日期', '实际转正日期',
    ]);
    employmentSheet.addRow([
      '007', '孚德', '项目中心', '项目一部', '', '项目经理', 'P4', '项目管理', '李四',
      '2024-01-02', '杭州', '全职', '在职', 3, '2024-04-01', '2024-04-02',
    ]);

    const profileSheet = workbook.addWorksheet('员工主档');
    profileSheet.addRow([
      '姓名*', '工号*', '手机号', '性别', '出生日期', '民族', '学历', '职称', '毕业院校', '毕业日期',
      '专业', '婚姻状况', '子女状况', '子女数量', '政治面貌', '籍贯', '户籍类型', '身份证地址',
      '身份证号', '现住址', '紧急联系人', '紧急联系人关系', '紧急联系人电话', '社保状态',
      '社保起始日期', '公积金状态', '公积金起始日期', '开户行', '开户支行', '银行卡号',
    ]);
    profileSheet.addRow([
      '张三', '007', '13800000000', '男', '1990-05-06', '汉族', '本科', '', '浙江大学', '2012-06-30',
      '工商管理', '已婚', '有', 1, '群众', '浙江杭州', '本地城镇', '身份证地址',
      '330100199005060011', '现住址', '王五', '配偶', '13900000000', '在缴',
      '2024-01-01', '在缴', '2024-01-01', '中信银行', '杭州分行', '6222000000000000',
    ]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = await parseEmployeeRosterExcel(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      employee: {
        name: '张三',
        employeeNo: '007',
        companyText: '孚德',
        departmentPath: ['项目中心', '项目一部'],
        position: '项目经理',
        managerName: '李四',
        probationMonths: 3,
      },
      profile: {
        phone: '13800000000',
        birthDate: new Date('1990-05-06T00:00:00.000Z'),
        idNumber: '330100199005060011',
      },
    });
    expect(rows[0].contracts).toEqual([
      expect.objectContaining({
        sequence: 0,
        kind: 'contract',
        signingCompany: '孚德',
        effectiveFrom: new Date('2024-01-02T00:00:00.000Z'),
      }),
      expect.objectContaining({
        sequence: 1,
        kind: 'renewal',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ]);
  });

  it('按花名册固定列解析员工、个人档案和多段合同，不把派生列当主数据', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow([
      '姓名', '工号', '所属公司', '1级部门', '2级部门', '3级部门', '岗位', '职级', '职类', '直接上级',
      '入职时间', '工作地', '用工情况', '员工状态', '试用期时间（月）', '试用期计划截止日期',
      '试用期实际转正日期', '司龄（系统计算）', '手机号', '性别', '出生日期', '出生月份', '年龄',
      '民族', '学历', '职称', '毕业院校', '毕业时间', '专业', '婚姻状况', '有/无子女', '人数',
      '政治\n面貌', '籍贯', '户口性质', '身份证地址（户口所在地）', '身份证号', '现居住地址',
      '紧急联系人', '紧急联系人关系', '紧急联系人电话', '社保缴纳', '社保起缴时间', '公积金缴纳',
      '公积金起缴时间', '银行名称', '开户行', '银行账号', '合同名称', '保密协议', '竞业协议',
      '肖像权协议', '最后合同到期时间', '合同状态', '辅助列', '合同签署时间', '合同到期时间',
      '合同期', '续签1合同开始时间', '合同结束时间', '合同期',
    ]);
    sheet.addRow([
      '张三', '007', '孚德', '项目中心', '项目一部', '／', '项目经理', 'P4', '项目管理', '李四',
      new Date('2024-01-02T00:00:00.000Z'), '杭州', '全职', '正式', '3个月',
      new Date('2024-04-01T00:00:00.000Z'), new Date('2024-04-02T00:00:00.000Z'), '2年',
      '13800000000', '男', new Date('1990-05-06T00:00:00.000Z'), '05', 36, '汉族', '本科', '／',
      '浙江大学', new Date('2012-06-30T00:00:00.000Z'), '工商管理', '已婚', '有', 1, '群众',
      '浙江杭州', '本地城镇', '身份证地址', '330100199005060011', '现居住地址', '王五', '配偶',
      '13900000000', '孚德', new Date('2024-01-01T00:00:00.000Z'), '在缴',
      new Date('2024-01-01T00:00:00.000Z'), '中信银行', '杭州分行', '6222000000000000',
      '劳动合同', '已签', '无', '已签', new Date('2027-01-01T00:00:00.000Z'), '有效', null,
      new Date('2024-01-02T00:00:00.000Z'), new Date('2025-01-01T00:00:00.000Z'), '1年',
      new Date('2025-01-02T00:00:00.000Z'), new Date('2027-01-01T00:00:00.000Z'), '2年',
    ]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = await parseEmployeeRosterExcel(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      employee: {
        name: '张三',
        employeeNo: '007',
        companyText: '孚德',
        departmentPath: ['项目中心', '项目一部'],
        position: '项目经理',
        managerName: '李四',
        probationMonths: 3,
      },
      profile: {
        phone: '13800000000',
        gender: '男',
        idNumber: '330100199005060011',
        bankAccount: '6222000000000000',
      },
    });
    expect(rows[0].contracts).toEqual([
      expect.objectContaining({ sequence: 0, termText: '1年' }),
      expect.objectContaining({ sequence: 1, termText: '2年' }),
    ]);
    expect((rows[0].employee as any).age).toBeUndefined();
    expect((rows[0].employee as any).tenure).toBeUndefined();
  });

  it('出生日期公式缓存被 ExcelJS 读成无效日期时，按身份证中的合法日期恢复', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(Array.from({ length: 48 }, (_, index) => `字段${index + 1}`));

    const values = Array(48).fill(null);
    values[0] = '张三';
    values[1] = '007';
    values[2] = '孚德';
    values[3] = '项目中心';
    values[6] = '项目经理';
    values[10] = new Date('2024-01-02T00:00:00.000Z');
    values[36] = '330100199005060011';
    sheet.addRow(values);

    const birthDateCell = sheet.getRow(2).getCell(21);
    birthDateCell.value = {
      formula: 'TEXT(MID(AK2,7,8),"0000-00-00")',
      result: '1990-05-06',
    };
    birthDateCell.numFmt = 'mm-dd-yy';

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = await parseEmployeeRosterExcel(buffer);

    expect(rows[0].profile.birthDate?.toISOString()).toBe('1990-05-06T00:00:00.000Z');
  });
});
