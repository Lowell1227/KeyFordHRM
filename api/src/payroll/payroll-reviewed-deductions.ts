import { Prisma } from '@prisma/client';
import { calculatePayrollDeductions, PayrollDeductionsResult } from './payroll-deductions-calculator';
import { deductionSettingsInput, normalizeDeductionSettings } from './payroll-deduction-settings';
import { payrollParameterDefinition } from './payroll-parameter-definition';
import { payrollDate, payrollHash } from './payroll-transaction';

export async function readReviewedDeductions(tx: Prisma.TransactionClient, input: {
  subjectId: string; employeeId: string; payDate: string; gross: string; domain: string;
}): Promise<PayrollDeductionsResult> {
  const blocked = (issue: string): PayrollDeductionsResult => ({ status: 'needs_configuration', issues: [issue], gross: null,
    socialInsurance: null, housingFund: null, incomeTax: null, net: null, evidence: { sourceHash: null, input: null } });
  const row = await tx.payrollDeductionProfile.findFirst({ where: { subjectId: input.subjectId, employeeId: input.employeeId,
    domain: input.domain, payDate: payrollDate(input.payDate), status: 'active' }, orderBy: { version: 'desc' },
    include: { releases: { where: { status: 'approved' }, select: { id: true, parameterVersion: true, snapshotHash: true, submittedById: true, reviewerId: true } } } });
  if (!row) return blocked('缺少该发薪日已通过主管审核的扣缴资料');
  const release = row.releases[0];
  if (row.releases.length !== 1 || release.parameterVersion !== row.version || release.submittedById === release.reviewerId
    || payrollHash(payrollParameterDefinition('deduction', row)) !== release.snapshotHash) return blocked('扣缴资料与主管审核快照不一致，请重新核对版本');
  try {
    const settings = normalizeDeductionSettings(input, row.settings);
    const result = calculatePayrollDeductions(deductionSettingsInput(input, settings, input.gross));
    return { ...result, evidence: { ...result.evidence, parameter: { id: row.id, version: row.version, releaseId: release.id, snapshotHash: release.snapshotHash } } };
  } catch { return blocked('已审核扣缴资料不完整或不适用于该发薪日，请重新维护'); }
}
