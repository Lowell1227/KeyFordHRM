import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '@/prisma/prisma.service';
import { RosterSensitiveExportService } from '@/users/roster-sensitive-export.service';
import { AuthUser } from '@/common/types/auth.types';
import { PayrollAccessService } from './payroll-access.service';
import { assertPayrollVersion, lockPayrollSubject } from './payroll-transaction';
import { PAYROLL_ITEM_CODES } from './payroll-contracts';
import { assertPayrollFrozenAttendance } from './payroll-data.service';
import { createHash } from 'node:crypto';

const Decimal = Prisma.Decimal.clone({ precision: 40 });
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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRM'; workbook.created = approved.version.approvedAt!;
    const sheet = workbook.addWorksheet('税前应发');
    sheet.addRow(['测试环境', '税前应发', approved.subject.name, approved.batch.month, approved.batch.payMonth, approved.batch.id, approved.version.version]);
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
    const plain = Buffer.from(await workbook.xlsx.writeBuffer());
    let encrypted: Buffer;
    try { encrypted = await this.crypto.encryptWorkbook(plain, input.filePassword); } finally { plain.fill(0); }
    const checksum = createHash('sha256').update(encrypted).digest('hex');
    try {
      await this.prisma.$transaction(async tx => {
        await this.approved(tx, id, input.expectedVersion, actor);
        await tx.payrollExportRecord.create({ data: { versionId: approved.version.id, actorId: actor.id, checksum } });
        await tx.payrollEvent.create({ data: { subjectId: approved.batch.subjectId, batchId: id, version: approved.version.version,
          actorId: actor.id, action: 'final_export', metadata: { versionId: approved.version.id, checksum } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) { encrypted.fill(0); throw error; }
    return new StreamableFile(encrypted, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="payroll-validation-${approved.batch.month}-v${approved.version.version}.xlsx"` });
  }
  private async approved(tx: Prisma.TransactionClient, id: string, expected: number, actor: AuthUser) {
    const header = await tx.payrollBatch.findUnique({ where: { id }, select: { id: true, subjectId: true, purpose: true } });
    if (!header) throw new NotFoundException('工资批次不存在');
    await this.access.assert(tx, actor, header.subjectId, 'payroll_export');
    if (header.purpose !== 'validation') throw new ForbiddenException('试算或未开放的正式通道不能下载最终工资表');
    await this.access.assertDomain(tx, 'validation'); await lockPayrollSubject(tx, header.subjectId, 'validation');
    const batch = await tx.payrollBatch.findUnique({ where: { id } });
    if (!batch || batch.subjectId !== header.subjectId || batch.purpose !== header.purpose) throw new ConflictException('批次归属已变化，请重新读取');
    await this.access.assert(tx, actor, batch.subjectId, 'payroll_export');
    await this.access.assertDomain(tx, 'validation'); assertPayrollVersion(batch.version, expected);
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
    await assertPayrollFrozenAttendance(tx, batch.subjectId, 'validation', version.sources);
    const subject = await tx.contractSubject.findUniqueOrThrow({ where: { id: batch.subjectId }, select: { name: true } });
    return { batch, version, subject };
  }
}
