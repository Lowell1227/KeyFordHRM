import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere } from './employment-timeline';
import { archiveIssueSourceSystems, archiveIssueStates } from './employee-archive-issues';
import { currentArchiveIssues, CURRENT_ARCHIVE_ISSUE_ACTION, safeArchiveIssueText } from './employee-archive-current-issues';

type Reader = Pick<PrismaService, 'user' | 'employeeDataChangeRequest'>;

@Injectable()
export class EmployeeArchiveIssuesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAccess(operator: AuthUser, write = false) {
    if (!(hasHrCapability(operator, 'employee_archive_edit') || (!write && hasHrCapability(operator, 'employee_archive_review')))) {
      throw new ForbiddenException('无权限查看或确认档案问题');
    }
  }

  private visibleIssues(request: Record<string, any>, user: Record<string, any> | null, operator: AuthUser) {
    return archiveIssueStates(request, user).map(({ issue }) => hasHrCapability(operator, 'employee_archive_edit') ? issue : {
      ...issue, canConfirmCurrent: false, confirmBlockedReason: '需要员工档案维护权限才能确认',
    });
  }

  private async userFacts(client: Pick<Reader, 'user'>, userId: string | null) {
    if (!userId) return null;
    const user = await client.user.findUnique({
      where: { id: userId, deletedAt: null, accountType: AccountType.employee },
      select: { id: true, accountType: true, archivedAt: true, deletedAt: true, name: true, employeeNo: true, phone: true, status: true, deptId: true, position: true, entryDate: true, leaveDate: true, actualRegularDate: true, employmentType: true,
        employeeProfile: true, employeeContracts: true,
        employmentHistory: { where: approvedEmploymentSourceWhere, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!user) throw new NotFoundException('员工不存在');
    return user;
  }

  async listForEmployee(userId: string, operator: AuthUser) {
    this.assertAccess(operator);
    const user = await this.userFacts(this.prisma, userId);
    const requests = await this.prisma.employeeDataChangeRequest.findMany({
      where: { userId, profileReviewStatus: 'approved', appliedAt: { not: null }, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const proposals = requests.map(r => r.proposedValue);
    const preliminary = currentArchiveIssues(user!, { proposals });
    const exemptions = user?.accountType === 'employee' ? await this.prisma.employeeArchiveIssueExemption.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }) : [];
    const current = currentArchiveIssues(user!, { proposals, exemptions }).map(issue => ({ ...issue, canExplain: hasHrCapability(operator, 'employee_archive_edit') }));
    return { items: [...current, ...requests.filter(request => !request.archivedAt && archiveIssueSourceSystems.includes(request.sourceSystem ?? '')).flatMap(request => this.visibleIssues(request, user, operator))],
      exemptions: exemptions.filter(e => e.isExempt).map(e => ({ issueId: e.issueId, fingerprint: e.fingerprint, version: e.version,
        message: e.message, field: e.field, currentValue: e.currentValue, reason: e.reason, isExempt: true,
        contractIds: preliminary.find(i => i.id === e.issueId && i.fingerprint === e.fingerprint)?.contractIds ?? [],
        noLongerApplies: !preliminary.some(i => i.id === e.issueId && i.fingerprint === e.fingerprint) })) };
  }

  async setExemption(userId: string, issueId: string, fingerprint: string, isExempt: boolean, expectedVersion: number, reason: string | undefined, operator: AuthUser) {
    this.assertAccess(operator, true);
    if (!/^current:[a-z-]{1,80}$/.test(issueId) || !/^[a-f0-9]{64}$/.test(fingerprint)
      || typeof isExempt !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 0
      || (reason !== undefined && (typeof reason !== 'string' || reason.length > 500))) {
      throw new BadRequestException('豁免设置无效，请刷新当前事项后重试');
    }
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('员工不存在');
      await tx.$queryRaw`SELECT "id" FROM "employee_profiles" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "employee_contracts" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "employee_data_change_requests" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      const user = await this.userFacts(tx as unknown as Reader, userId);
      const requests = await tx.employeeDataChangeRequest.findMany({ where: { userId, profileReviewStatus: 'approved', appliedAt: { not: null }, cancelledAt: null }, select: { proposedValue: true } });
      const item = currentArchiveIssues(user!, { proposals: requests.map(r => r.proposedValue) }).find(i => i.id === issueId);
      const existing = await tx.employeeArchiveIssueExemption.findUnique({ where: { userId_issueId_fingerprint: { userId, issueId, fingerprint } } });
      // Fixing the actual dossier never needs a checkbox to be cleared first.
      if (isExempt && !item) return { isExempt: false, noLongerApplies: true, issueId, version: existing?.version ?? 0 };
      if (isExempt && item!.fingerprint !== fingerprint) throw new ConflictException('资料已更新，请重新查看当前事项后再设置豁免');
      if ((existing?.isExempt ?? false) === isExempt) return { isExempt, alreadySet: true, issueId, version: existing?.version ?? 0 };
      if ((existing?.version ?? 0) !== expectedVersion) throw new ConflictException('豁免设置已更新，请刷新后重试');
      const explanation = safeArchiveIssueText(reason?.trim() ?? '');
      let version: number;
      if (existing) {
        const updated = await tx.employeeArchiveIssueExemption.updateMany({ where: { id: existing.id, version: expectedVersion },
          data: { isExempt, reason: explanation || existing.reason, version: { increment: 1 }, updatedById: operator.id, updatedAt: new Date() } });
        if (updated.count !== 1) throw new ConflictException('豁免设置已更新，请刷新后重试');
        version = existing.version + 1;
      } else {
        const created = await tx.employeeArchiveIssueExemption.create({ data: { userId, issueId, fingerprint, isExempt,
          message: item!.message, currentValue: item!.current.value, field: item!.field, reason: explanation || null, updatedById: operator.id } });
        version = created.version;
      }
      await tx.auditLog.create({ data: { userId: operator.id, action: CURRENT_ARCHIVE_ISSUE_ACTION, entityType: 'user', entityId: userId,
        oldValue: { issueId, isExempt: existing?.isExempt ?? false }, newValue: { issueId, fingerprint, isExempt, version,
          message: isExempt ? item!.message : existing!.message, field: isExempt ? item!.field : existing!.field,
          currentValue: isExempt ? item!.current.value : existing!.currentValue,
          reason: explanation || (isExempt ? 'HR选择保留现状，豁免此提醒' : 'HR取消豁免，恢复按当前资料检查') } } });
      return { isExempt, alreadySet: false, issueId, version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
      if (['P2034', 'P2002'].includes(error?.code)) throw new ConflictException('资料正在更新，请刷新当前事项后重试');
      throw error;
    });
  }

  async listForRequest(requestId: string, operator: AuthUser) {
    this.assertAccess(operator);
    const request = await this.prisma.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.archivedAt || request.cancelledAt) throw new NotFoundException('档案问题记录不存在');
    if (request.sourceSystem === 'archive_assistant_pilot' && request.createdById !== operator.id) throw new NotFoundException('档案问题记录不存在');
    const user = await this.userFacts(this.prisma, request.userId);
    return { items: this.visibleIssues(request, user, operator) };
  }

  async confirmCurrent(requestId: string, issueId: string, fingerprint: string, operator: AuthUser) {
    this.assertAccess(operator, true);
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(issueId)) throw new BadRequestException('问题标识无效，请刷新后重试');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new BadRequestException('资料版本无效，请刷新后重试');
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "employee_data_change_requests" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('档案问题记录不存在');
      const request = await tx.employeeDataChangeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.archivedAt || request.cancelledAt) throw new NotFoundException('档案问题记录不存在');
      const user = await this.userFacts(tx as unknown as Reader, request.userId);
      const state = archiveIssueStates(request, user, true).find(item => item.issue.id === issueId);
      if (!state) throw new NotFoundException('问题已变化或不再需要处理，请刷新后重试');
      if (state.issue.status === 'resolved') return { confirmed: true, alreadyConfirmed: true, issueId };
      if (state.issue.fingerprint !== fingerprint) throw new ConflictException('当前资料已变化，请刷新核对后重新确认');
      if (!state.issue.canConfirmCurrent) throw new BadRequestException(state.issue.confirmBlockedReason);
      const warnings = [...request.validationWarnings as Prisma.JsonArray];
      const before = warnings[state.warningIndex] as Prisma.JsonObject;
      warnings[state.warningIndex] = { ...before, id: state.issue.id, resolution: {
        decision: 'keep_current', fingerprint, warningSourceDigest: state.warningSourceDigest, by: operator.id, at: new Date().toISOString(),
      } };
      await tx.employeeDataChangeRequest.update({ where: { id: request.id }, data: { validationWarnings: warnings } });
      await tx.auditLog.create({ data: {
        userId: operator.id, action: 'confirm_employee_archive_issue', entityType: 'employee_data_change_request', entityId: request.id,
        oldValue: { issueId, status: 'open' }, newValue: { issueId, field: state.issue.field, decision: 'keep_current', fingerprint },
      } });
      return { confirmed: true, alreadyConfirmed: false, issueId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
      if (error?.code === 'P2034') throw new ConflictException('资料正在被其他HR维护，请刷新核对后重新确认');
      throw error;
    });
  }
}
