import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { approvedEmploymentSourceWhere } from './employment-timeline';
import { archiveIssueSourceSystems, archiveIssueStates } from './employee-archive-issues';

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
      select: { id: true, name: true, employeeNo: true, phone: true, status: true, deptId: true, position: true, entryDate: true, employmentType: true,
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
      where: { userId, sourceSystem: { in: archiveIssueSourceSystems }, profileReviewStatus: 'approved', appliedAt: { not: null }, archivedAt: null, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { items: requests.flatMap(request => this.visibleIssues(request, user, operator)) };
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
