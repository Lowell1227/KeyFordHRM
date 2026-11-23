import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '@/prisma/prisma.service';
import { RosterSensitiveExportService } from '@/users/roster-sensitive-export.service';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollAccessService } from './payroll-access.service';
import { assertPayrollVersion, lockPayrollSubject, payrollHash } from './payroll-transaction';
import { PAYROLL_ITEM_CODES } from './payroll-contracts';
import { assertPayrollFrozenAttendance } from './payroll-data.service';
import { createHash } from 'node:crypto';
import { assertPayrollNetFresh, assertPayrollNetLines, PayrollNetSnapshot } from './payroll-net';
import { assertPayrollApprovedPerformance } from './payroll-approved-performance';

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const NET_AMOUNTS = ['gross', 'socialInsurance', 'housingFund', 'incomeTax', 'net'] as const;
function excelMoney(value: Prisma.Decimal): number {
  const number = Number(value.toFixed(2));
  if (!Number.isFinite(number) || !new Decimal(String(number)).eq(value)
    || !new Decimal(number.toPrecision(15)).eq(value)) throw new ConflictException('金额超出Excel可精确交付的范围');
  return number;
}

@Injectable()
export class PayrollExportService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService, private readonly crypto: RosterSensitiveExportService) {}
  async download(id: string, input: { expectedVersion: number; filePassword: string }, actor: AuthUser) {
    if (typeof input.filePassword !== 'string' || input.filePassword.length < 4 || input.filePassword.length > 64 || !input.filePassword.trim()) throw new BadRequestException('Excel打开密码须为4至64位');
    const approved = await this.prisma.$transaction(tx => this.approved(tx, id, input.expectedVersion, actor), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const approvedHash = payrollHash({ batch: approved.batch, version: approved.version });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRM'; workbook.created = approved.version.approvedAt!;
    const watermark = approved.batch.purpose === 'validation' ? '测试环境' : '正式工资';
    if (approved.net) {
      const summary = workbook.addWorksheet('工资实发');
      summary.addRow([watermark, '工资实发', approved.subject.name, approved.batch.month, approved.batch.id, approved.version.version]);
      summary.addRow(['发薪主体', '工号', '姓名', '发放月', '计划发薪日', '税前应发', '个人社保', '个人公积金', '个人所得税', '实发工资', '批次号', '版本']);
      for (const row of approved.net.rows) summary.addRow([approved.subject.name, row.employeeNo, row.employeeName, approved.batch.payMonth,
        approved.net.payDate, ...NET_AMOUNTS.map(key => excelMoney(new Decimal(row.result[key]!))), approved.batch.id, approved.version.version]);
      summary.addRow(['合计', '', '', '', '', ...NET_AMOUNTS.map(key => excelMoney(new Decimal(approved.net!.totals![key])))]);
      summary.views = [{ state: 'frozen', ySplit: 2 }];
      summary.columns.forEach((column, index) => { column.width = index === 10 ? 40 : 18; });
      for (let index = 6; index <= 10; index++) summary.getColumn(index).numFmt = '0.00';
    }
    const sheet = workbook.addWorksheet(approved.net ? '工资明细' : '税前应发');
    sheet.addRow([watermark, sheet.name, approved.subject.name, approved.batch.month, approved.batch.payMonth, approved.batch.id, approved.version.version]);
    sheet.addRow(['发薪主体', '工号', '姓名', '工资归属月', '发放月', '固定工资', '假勤差额', '加班工资', '个人绩效', '授权调整', '税前合计', '批次号', '版本']);
    const groups = new Map<string, typeof approved.version.lines>();
    for (const line of approved.version.lines) {
      const key = `${line.employeeId}:${line.attributionMonth}`;
      const rows = groups.get(key) ?? []; rows.push(line); groups.set(key, rows);
    }
    for (const rows of groups.values()) {
      if (rows.length !== PAYROLL_ITEM_CODES.length) throw new ConflictException('批准版本工资项目不完整或重复');
      const evidence = rows[0].evidence as { employeeName?: string; employeeNo?: string };
      const values = PAYROLL_ITEM_CODES.map(code => {
        const amount = rows.find(row => row.itemCode === code)?.amount;
        if (amount == null || !amount.isFinite()) throw new ConflictException('批准版本缺少工资项目，不能以零替代');
        return amount;
      });
      const total = values.reduce((sum, amount) => sum.plus(amount!), new Decimal(0));
      sheet.addRow([approved.subject.name, evidence.employeeNo ?? '', evidence.employeeName ?? rows[0].employeeId, rows[0].attributionMonth,
        approved.batch.payMonth, ...values.map(excelMoney), excelMoney(total), approved.batch.id, approved.version.version]);
    }
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    sheet.columns.forEach((column, index) => { column.width = index === 11 ? 40 : 18; });
    for (let index = 6; index <= 11; index++) sheet.getColumn(index).numFmt = '0.00';
    if (approved.net) {
      const basis = workbook.addWorksheet('审批依据');
      basis.addRow([watermark, '审批依据']);
      basis.addRows([['批次号', approved.batch.id], ['版本', approved.version.version], ['工资来源哈希', approved.version.sourceHash],
        ['实发来源哈希', approved.net.sourceHash], ['计划发薪日', approved.net.payDate], ['批准时间', approved.version.approvedAt!.toISOString()]]);
      basis.getColumn(1).width = 20; basis.getColumn(2).width = 70;
    }
    const raw = await workbook.xlsx.writeBuffer();
    const plain = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    let encrypted: Buffer;
    try { encrypted = await this.crypto.encryptWorkbook(plain, input.filePassword); } finally { plain.fill(0); }
    const checksum = createHash('sha256').update(encrypted).digest('hex');
    try {
      await this.prisma.$transaction(async tx => {
        const current = await this.approved(tx, id, input.expectedVersion, actor);
        if (payrollHash({ batch: current.batch, version: current.version }) !== approvedHash) throw new ConflictException('批准版本已变化，请重新导出');
        await tx.payrollExportRecord.create({ data: { versionId: approved.version.id, actorId: actor.id, checksum } });
        await tx.payrollEvent.create({ data: { subjectId: approved.batch.subjectId, batchId: id, version: approved.version.version,
          actorId: actor.id, action: 'final_export', metadata: { versionId: approved.version.id, checksum } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) { encrypted.fill(0); throw error; }
    return new StreamableFile(encrypted, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="payroll-${approved.batch.purpose}-${approved.net ? 'net-' : ''}${approved.batch.month}-v${approved.version.version}.xlsx"` });
  }
  private async approved(tx: Prisma.TransactionClient, id: string, expected: number, actor: AuthUser) {
    const header = await tx.payrollBatch.findUnique({ where: { id }, select: { id: true, subjectId: true, purpose: true } });
    if (!header) throw new NotFoundException('工资批次不存在');
    await this.access.assert(tx, actor, header.subjectId, 'payroll_export');
    if (header.purpose !== 'validation' && header.purpose !== 'formal') throw new ForbiddenException('试算或真实资料对账不能下载最终工资表');
    const domain = header.purpose;
    await this.access.assertDomain(tx, domain); await lockPayrollSubject(tx, header.subjectId, domain);
    const batch = await tx.payrollBatch.findUnique({ where: { id } });
    if (!batch || batch.subjectId !== header.subjectId || batch.purpose !== header.purpose) throw new ConflictException('批次归属已变化，请重新读取');
    await this.access.assert(tx, actor, batch.subjectId, 'payroll_export');
    await this.access.assertDomain(tx, domain); assertPayrollVersion(batch.version, expected);
    const version = await tx.payrollVersion.findFirst({ where: { batchId: id }, orderBy: { version: 'desc' },
      include: { lines: { orderBy: [{ employeeId: 'asc' }, { attributionMonth: 'asc' }, { itemCode: 'asc' }] }, decisions: { orderBy: { step: 'asc' } } } });
    if (batch.status !== 'approved' || !version || version.status !== 'approved' || version.voidedAt || !version.approvedAt
      || !version.approvalPath.length || version.reviewerCount < 1 || version.reviewerCount >= version.approvalPath.length
      || new Set(version.approvalPath).size !== version.approvalPath.length || version.approvalStep !== version.approvalPath.length || version.decisions.length !== version.approvalPath.length
      || version.decisions.some((decision, index) => decision.step !== index || decision.action !== 'approve' || decision.actorId !== version.approvalPath[index])
      || !Array.isArray(version.issues) || version.issues.length || !version.lines.length || version.lines.some(line => !['ready', 'not_applicable'].includes(line.status) || line.amount === null)
      || version.gross === null || !version.lines.reduce((sum, line) => sum.plus(line.amount!), new Decimal(0)).eq(version.gross)) {
      throw new ConflictException('只有全部审批通过且当前有效的完整版本才能导出');
    }
    const cancelled = await tx.payrollEvent.findFirst({ where: { batchId: id, version: version.version, action: 'remainder_cancelled' }, select: { id: true } });
    if (cancelled) throw new ConflictException('该支付安排已有余款取消，请核对补差批次；原版本保留在历史中');
    if (domain === 'formal' && version.netSnapshot == null) throw new ForbiddenException('正式导出必须包含完整批准实发快照');
    const net = version.netSnapshot as PayrollNetSnapshot | null;
    if (net != null) {
      assertPayrollNetLines(net, version.lines, version.gross);
      if (!(version.payDate instanceof Date) || !Number.isFinite(version.payDate.getTime())
        || net.payDate !== version.payDate.toISOString().slice(0, 10)
        || net.rows.some(row => typeof row.employeeName !== 'string' || typeof row.employeeNo !== 'string')) {
        throw new ConflictException('批准实发日期或人员信息不完整');
      }
      await assertPayrollNetFresh(tx, batch, net, domain, version.id);
    }
    await assertPayrollFrozenAttendance(tx, batch.subjectId, domain, version.sources);
    await assertPayrollApprovedPerformance(tx, batch, version, domain);
    const subject = await tx.contractSubject.findUniqueOrThrow({ where: { id: batch.subjectId }, select: { name: true } });
    return { batch, version, subject, net };
  }
}
