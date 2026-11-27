import { Injectable } from '@nestjs/common';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { EmployeeDataReviewsService } from '@/employee-archives/employee-data-reviews.service';
import { PersonnelDigestService } from '@/employee-archives/personnel-digest.service';
import { digestKinds } from '@/employee-archives/personnel-digest';
import { PayrollAccessService } from '@/payroll/payroll-access.service';
import { payrollParameterEligibleUser, payrollParameterReviewerWhere } from '@/payroll/payroll-parameter-access';
import { PayrollReadinessService } from '@/payroll/payroll-readiness.service';
import { PerformanceOperationsService } from './performance-operations.service';
import type { OperationGroup, OperationItem, OperationPage, OperationsQueryDto, OperationsSummary } from './operations.dto';
import { allOperationPages, currentPayrollStep, operationPath, OperationRows } from './operations-projection';

@Injectable()
export class WorkbenchService {
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollAccessService,
    private readonly reviews: EmployeeDataReviewsService, private readonly digest: PersonnelDigestService,
    private readonly readiness: PayrollReadinessService, private readonly performance: PerformanceOperationsService) {}

  async operations(actor: AuthUser, query: OperationsQueryDto): Promise<OperationsSummary> {
    const [personnel, payroll, performance] = await Promise.all([
      this.group(() => this.personnel(actor), query), this.group(() => this.payroll(actor), query),
      this.group(() => this.performance.read(actor), query),
    ]);
    return { generatedAt: new Date().toISOString(), groups: { personnel, payroll, performance } };
  }

  private async group(read: () => Promise<OperationRows>, query: OperationsQueryDto): Promise<OperationGroup> {
    const page = (rows: OperationItem[], unknown = false): OperationPage => {
      const items = [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) =>
        (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.id.localeCompare(b.id));
      const offset = (query.page - 1) * query.pageSize;
      return { total: unknown ? null : items.length, page: query.page, pageSize: query.pageSize,
        hasMore: !unknown && offset + query.pageSize < items.length, items: items.slice(offset, offset + query.pageSize) };
    };
    try {
      const rows = await read(), counts: NonNullable<OperationGroup['counts']> = {};
      for (const bucket of ['actionable', 'attention'] as const) {
        for (const item of new Map(rows[bucket].map(item => [item.id, item])).values()) {
          counts[item.kind] ??= { actionable: 0, attention: 0 };
          counts[item.kind][bucket]++;
        }
      }
      return { visible: rows.visible, status: 'ready', actionable: page(rows.actionable), attention: page(rows.attention), counts };
    } catch {
      return { visible: true, status: 'error', actionable: page([], true), attention: page([], true), counts: null,
        error: { code: 'OPERATIONS_UNAVAILABLE', message: '待办读取失败，请重试' } };
    }
  }

  private async personnel(actor: AuthUser): Promise<OperationRows> {
    const review = !actor.isAssessorOnly && hasHrCapability(actor, 'employee_archive_review');
    const edit = !actor.isAssessorOnly && hasHrCapability(actor, 'employee_archive_edit');
    const result: OperationRows = { visible: review || edit, actionable: [], attention: [] };
    if (!result.visible) return result;
    const pending = review ? await allOperationPages((page, pageSize) => this.reviews.findAll({ page, pageSize, status: 'pending' })) : [];
    const pendingIds = new Set<string>();
    for (const row of pending) {
      if (row.recordStatus !== 'submitted' || row.archivedAt || row.cancelledAt || row.onboardingStatus === 'cancelled'
        || row.sourceSystem === 'archive_assistant_pilot'
        || row.profileReviewStatus !== 'pending' && row.performanceReviewStatus !== 'pending') continue;
      pendingIds.add(row.id);
      result.actionable.push({ id: `personnel:review:${row.id}`, kind: 'personnel_review', title: `${row.employeeName} · 人事资料审核`,
        status: 'pending', nextAction: '审核原申请', dueAt: null, requestId: row.id,
        path: operationPath('/entry-exit', { tab: 'reviews', requestId: row.id }) });
    }
    const digest = await this.digest.list(actor);
    for (const row of digest.items) {
      if (pendingIds.has(row.id)) continue;
      // Links are built by the original digest, but only known local routes may leave this projection.
      if (!/^\/(?:entry-exit|users)\?/.test(row.link)) throw new Error('Unsafe personnel source link');
      const item: OperationItem = { id: `personnel:${row.kind}:${row.id}`, kind: `personnel_${row.kind}`,
        title: `${row.employee} · ${digestKinds[row.kind]}`, status: row.kind, nextAction: row.next,
        dueAt: row.due, path: row.link,
        ...(['arrival', 'returned', 'resignation'].includes(row.kind) ? { requestId: row.id } : {}) };
      (row.kind === 'arrival' && review || row.kind === 'returned' && edit ? result.actionable : result.attention).push(item);
    }
    return result;
  }

  private async payroll(actor: AuthUser): Promise<OperationRows> {
    const result: OperationRows = { visible: false, actionable: [], attention: [] };
    const scope = await this.access.getAccess(actor);
    if (!scope.enabled || actor.isAssessorOnly || !scope.subjects.length) return result;
    result.visible = true;
    const domain = await this.access.assertDomain(this.prisma, this.access.maintenancePurpose());
    const parameterSubjects = new Map(scope.subjects.filter(subject => subject.capabilities.some(cap =>
      cap === 'payroll_edit' || cap === 'payroll_parameter_review')).map(subject => [subject.id, subject]));
    const batchSubjects = new Map(scope.subjects.filter(subject => subject.capabilities.some(cap =>
      ['payroll_edit', 'payroll_view', 'payroll_review', 'payroll_approve'].includes(cap))).map(subject => [subject.id, subject]));
    const parameterSubjectIds = [...parameterSubjects.keys()];
    const editorSubjectIds = [...parameterSubjects.values()].filter(subject =>
      subject.capabilities.includes('payroll_edit')).map(subject => subject.id);
    // Summary reads need pending responsibilities, not parameter comparisons or wage source snapshots.
    const [parameters, batches] = await Promise.all([
      parameterSubjectIds.length ? this.prisma.payrollParameterRelease.findMany({
        where: { domain, status: 'pending', subjectId: { in: parameterSubjectIds }, OR: [
          { ...payrollParameterReviewerWhere(actor.id), submittedById: { not: actor.id } },
          { subjectId: { in: editorSubjectIds }, submittedById: actor.id, reviewerId: { not: actor.id },
            submittedBy: { is: payrollParameterEligibleUser } },
        ] },
        select: { id: true, domain: true, subjectId: true, status: true, reviewerId: true, submittedById: true,
          submittedBy: { select: { payrollGrants: { where: { subjectId: { in: parameterSubjectIds },
            revokedAt: null, capabilities: { has: 'payroll_edit' } }, select: { subjectId: true } } } },
        },
      }) : [],
      batchSubjects.size ? this.prisma.payrollBatch.findMany({ where: { subjectId: { in: [...batchSubjects.keys()] },
        purpose: domain === 'formal' ? { in: ['formal', 'reconciliation'] } : { in: ['trial', 'validation'] },
        status: { in: ['draft', 'calculated', 'returned', 'withdrawn', 'pending'] } },
        select: { id: true, subjectId: true, month: true, purpose: true, status: true, createdById: true,
          versions: { orderBy: { version: 'desc' }, take: 1, select: { status: true, approvalStep: true, reviewerCount: true,
            approvalPath: true, submittedById: true, calculatedById: true, voidedAt: true } } } }) : [],
    ]);
    for (const row of parameters) {
      const subject = parameterSubjects.get(row.subjectId);
      if (!subject || row.domain !== domain || row.status !== 'pending') continue;
      // The current manager relationship alone does not grant access to this payer.
      if (!row.submittedBy.payrollGrants.some(grant => grant.subjectId === row.subjectId)) continue;
      const independent = row.reviewerId === actor.id && row.submittedById !== actor.id;
      const waiting = row.submittedById === actor.id && row.reviewerId !== actor.id && subject.capabilities.includes('payroll_edit');
      if (!independent && !waiting) continue;
      (independent ? result.actionable : result.attention).push({ id: `payroll:parameter:${row.id}`, kind: 'payroll_parameter',
        title: `${subject.name} · 工资资料审核`, status: row.status,
        nextAction: independent ? '审核该工资资料申请' : '等待经办人的直属主管审核', dueAt: null,
        subjectId: subject.id, requestId: row.id,
        path: operationPath('/payroll/parameter-reviews', { subjectId: subject.id, releaseId: row.id }) });
    }
    for (const batch of batches) {
      const subject = batchSubjects.get(batch.subjectId);
      if (!subject || !/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(batch.month)
        || !(domain === 'formal' ? ['formal', 'reconciliation'] : ['trial', 'validation']).includes(batch.purpose)) continue;
      const caps = subject.capabilities;
      const version = batch.versions[0];
      if (version && (version.status !== batch.status || version.voidedAt)) continue;
      const decision = batch.purpose !== 'reconciliation' && batch.purpose !== 'trial' && !!version
        && currentPayrollStep(version, actor.id, caps);
      const owner = caps.includes('payroll_edit') && (batch.status === 'draft' ? batch.createdById === actor.id
        : (version?.submittedById ?? version?.calculatedById) === actor.id);
      const work = owner && ['draft', 'calculated', 'returned', 'withdrawn'].includes(batch.status);
      const waiting = owner && batch.status === 'pending' && version?.submittedById === actor.id
        && !version.approvalPath.includes(actor.id);
      if (!decision && !work && !waiting) continue;
      const item: OperationItem = { id: `payroll:batch:${batch.id}`, kind: decision ? 'payroll_approval' : 'payroll_batch',
        title: `${subject.name} · ${batch.month} · 工资${decision ? '复核审批' : '核算'}`, status: batch.status,
        nextAction: decision ? (version!.approvalStep < version!.reviewerCount ? '复核当前工资版本' : '审批当前工资版本')
          : waiting ? '等待指定复核或审批人办理' : '核对原批次资料并继续核算', dueAt: null,
        subjectId: subject.id, month: batch.month, batchId: batch.id,
        path: operationPath(`/payroll/${decision ? 'approvals' : 'batches'}/${encodeURIComponent(batch.id)}`,
          { subjectId: subject.id, month: batch.month }) };
      (decision || work ? result.actionable : result.attention).push(item);
    }
    if (domain !== 'formal') return result;
    for (const subject of batchSubjects.values()) {
      const caps = subject.capabilities;
      for (const row of await this.readiness.list(subject.id, actor)) {
        if (row.subjectId !== subject.id || !/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(row.month)) continue;
        const decision = currentPayrollStep(row, actor.id, caps);
        const waiting = row.status === 'pending' && row.submittedById === actor.id && caps.includes('payroll_edit')
          && !row.approvalPath.includes(actor.id);
        if (!decision && !waiting) continue;
        (decision ? result.actionable : result.attention).push({ id: `payroll:readiness:${row.id}`, kind: 'payroll_readiness',
          title: `${subject.name} · ${row.month} · 首月对账签收`, status: row.status,
          nextAction: decision ? '办理当前对账签收环节' : '等待指定复核或签收人办理', dueAt: null,
          subjectId: subject.id, month: row.month, batchId: row.batchId, requestId: row.id,
          path: operationPath(decision ? '/payroll/approvals' : '/payroll/batches',
            { subjectId: subject.id, month: row.month, readiness: row.id }) });
      }
    }
    return result;
  }
}
