import * as ExcelJS from 'exceljs';
import { parseEmployeeRosterExcel } from './employee-roster.excel';

describe('parseEmployeeRosterExcel', () => {
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
});
