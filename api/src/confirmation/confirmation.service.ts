import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyCode, ConfirmationStatus, Prisma, SysRole, UserStatus, VoteResult } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { Paginated, paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { CreateSelfConfirmationDto } from './dto/create-self-confirmation.dto';
import { SaveSelfConfirmationDto } from './dto/save-self-confirmation.dto';
import { ApproveConfirmationDto } from './dto/approve-confirmation.dto';
import { RejectConfirmationDto } from './dto/reject-confirmation.dto';
import { StorageService } from '@/storage/storage.service';
import { BackfillMeetingDateDto } from './dto/backfill-meeting-date.dto';
import { ReturnConfirmationDto } from './dto/return-confirmation.dto';
import { DataScopeService } from '@/common/services/data-scope.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { buildPerformanceApproverMap } from '@/cycles/performance-approval-relations';

export interface ConfirmationListItem {
  id: string;
  workflowVersion: number;
  submissionVersion: number;
  returnReason: string | null;
  employeeId: string;
  managerId: string | null;
  hrId: string | null;
  companyApproverId: string | null;
  status: ConfirmationStatus;
  pendingRole: 'manager' | 'hr' | 'company' | null;
  employee: { id: string; name: string };
  manager: { id: string; name: string } | null;
  hr: { id: string; name: string } | null;
  companyApprover: { id: string; name: string } | null;
  voteResult: VoteResult | null;
  voteMeetingTime: Date | null;
  meetingDate: Date | null;
  proposedRegularDate: Date | null;
  actualRegularDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalStep {
  role: 'manager' | 'hr' | 'company';
  status: 'pending' | 'approved' | 'rejected';
  approver: { id: string; name: string } | null;
  comment: string | null;
  actedAt: Date | null;
}

export interface ConfirmationDetail extends ConfirmationListItem {
  roster: { employeeNo: string | null; company: string | null; deptName: string | null;
    position: string | null; entryDate: Date | null; plannedRegularDate: Date | null };
  probationReviewId: string | null;
  summary: string | null;
  managerRecommendation: boolean | null;
  returnReason: string | null;
  returnedAt: Date | null;
  voteRecordedAt: Date | null;
  meetingAttachments: Array<{ id: string; name: string; size: number; mimeType: string; uploadedById: string; createdAt: Date }>;
  salary: number | null;
  voteParticipants: string[];
  voteComment: string | null;
  rejectedBy: { id: string; name: string } | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  steps: ApprovalStep[];
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canViewInternalMeeting: boolean;
  pendingRole: 'manager' | 'hr' | 'company' | null;
  history: Array<{ id: string; label: string; actorName: string | null; occurredAt: Date;
    submissionVersion: number | null; note: string | null;
    snapshot: { summary?: string; managerRecommendation?: boolean; managerComment?: string;
      voteResult?: VoteResult; voteComment?: string; hrComment?: string; proposedRegularDate?: string } | null }>;
}

export interface WarningItem {
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  plannedRegularDate: Date | null;
  daysUntil: number | null;
  hasApplication: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly dataScope: DataScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  private async notifyApplication(
    id: string, version: number, recipientIds: Array<string | null>, senderId: string,
    type: string, title: string, content: string,
  ): Promise<void> {
    await Promise.allSettled([...new Set(recipientIds.filter((recipient): recipient is string => Boolean(recipient)))].map((userId) =>
      this.notifications.create({
        dedupeKey: `confirmation:${id}:${version}:${type}:${userId}`,
        userId, senderId, type, title, content,
        extraData: { applicationId: id },
      }),
    ));
  }

  async myRoster(viewer: AuthUser) {
    const employee = await this.prisma.user.findUnique({
      where: { id: viewer.id, deletedAt: null },
      select: { name: true, employeeNo: true, position: true, entryDate: true,
        plannedRegularDate: true, dept: { select: { name: true, company: true } },
        directManager: { select: { name: true } } },
    });
    if (!employee) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工档案不存在' });
    return { name: employee.name, managerName: employee.directManager?.name ?? null,
      employeeNo: employee.employeeNo, company: employee.dept?.company ?? null,
      deptName: employee.dept?.name ?? null, position: employee.position,
      entryDate: employee.entryDate, plannedRegularDate: employee.plannedRegularDate };
  }

  /** 本公司获授权 HR 可为待评议申请上传内部依据，上传人单独留痕。 */
  async addMeetingAttachment(id: string, file: Express.Multer.File, viewer: AuthUser) {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id }, select: { id: true, employeeId: true, companyApproverId: true, workflowVersion: true, submissionVersion: true, hrId: true, status: true },
    });
    if (!app || app.workflowVersion !== 2) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (!(await this.canHandleHr(app.employeeId, viewer, app.companyApproverId))) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅本公司有转正办理权限的 HR 可上传内部评议附件' });
    }
    if (app.status !== ConfirmationStatus.manager_approved) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '当前环节不能上传评议附件' });
    }
    const uploaded = await this.storage.uploadFile(file, 'confirmation-internal');
    const objectKey = new URL(uploaded.url, 'http://local.invalid').searchParams.get('key');
    if (!objectKey?.startsWith('confirmation-internal/')) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '附件存储路径无效' });
    }
    const attachment = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.confirmationMeetingAttachment.create({
        data: {
          applicationId: id,
          submissionVersion: app.submissionVersion,
          objectKey,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
          uploadedById: viewer.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'confirmation_meeting_attachment_added',
          entityType: 'confirmation_application',
          entityId: id,
          newValue: { attachmentId: saved.id, name: saved.name, submissionVersion: app.submissionVersion },
        },
      });
      return saved;
    });
    return {
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
      uploadedById: attachment.uploadedById,
      createdAt: attachment.createdAt,
    };
  }

  /** 下载键绝不返回给前端，只给已核权的代理下载控制器。 */
  async meetingAttachmentKey(id: string, attachmentId: string, viewer: AuthUser): Promise<string> {
    const attachment = await this.prisma.confirmationMeetingAttachment.findUnique({
      where: { id: attachmentId },
      include: { application: { select: { id: true, workflowVersion: true, submissionVersion: true,
        status: true, employeeId: true, hrId: true, companyApproverId: true } } },
    });
    if (!attachment || attachment.applicationId !== id || attachment.application.workflowVersion !== 2) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '评议附件不存在' });
    }
    if (attachment.application.status === ConfirmationStatus.draft || attachment.submissionVersion !== attachment.application.submissionVersion) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '评议附件不属于当前办理轮次' });
    }
    if (!(await this.canHandleHr(attachment.application.employeeId, viewer, attachment.application.companyApproverId))
      && attachment.application.companyApproverId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权下载内部评议附件' });
    }
    return attachment.objectKey;
  }

  /** HR 可在提交结论后补录会议日期，不改变审批状态或实际转正日期。 */
  async backfillMeetingDate(id: string, dto: BackfillMeetingDateDto, viewer: AuthUser) {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id }, select: { id: true, workflowVersion: true, hrId: true, status: true, voteResult: true, meetingDate: true },
    });
    if (!app || app.workflowVersion !== 2) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.hrId !== viewer.id || !this.isConfirmationManager(viewer)) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅记录评议结论的 HR 可补录会议日期' });
    }
    if (!app.voteResult || !([ConfirmationStatus.hr_approved, ConfirmationStatus.approved, ConfirmationStatus.rejected] as ConfirmationStatus[]).includes(app.status)) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '评议结论提交后才能补录会议日期' });
    }
    if (!(dto.meetingDate instanceof Date) || Number.isNaN(dto.meetingDate.getTime())) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请选择有效的会议日期' });
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.confirmationApplication.updateMany({
        where: {
          id, hrId: viewer.id,
          status: { in: [ConfirmationStatus.hr_approved, ConfirmationStatus.approved, ConfirmationStatus.rejected] },
          voteResult: { not: null },
        },
        data: { meetingDate: dto.meetingDate },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'confirmation_meeting_date_backfilled',
          entityType: 'confirmation_application',
          entityId: id,
          oldValue: { meetingDate: app.meetingDate?.toISOString().slice(0, 10) ?? null },
          newValue: { meetingDate: dto.meetingDate.toISOString().slice(0, 10) },
        },
      });
    });
    return { id, meetingDate: dto.meetingDate };
  }

  /** 试用期员工本人保存转正申请草稿。 */
  async create(dto: CreateSelfConfirmationDto, viewer: AuthUser): Promise<ConfirmationDetail> {
    const employee = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { id: true, name: true, status: true, directManagerId: true, deletedAt: true },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }
    if (employee.status !== UserStatus.probation) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅试用期员工可发起转正申请',
      });
    }

    const existing = await this.prisma.confirmationApplication.findFirst({
      where: {
        employeeId: viewer.id,
        workflowVersion: 2,
        status: { in: [
          ConfirmationStatus.draft,
          ConfirmationStatus.submitted,
          ConfirmationStatus.manager_approved,
          ConfirmationStatus.hr_approved,
        ] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '已有办理中的转正申请，请继续原申请' });
    }

    const data: Prisma.ConfirmationApplicationCreateInput = {
      employee: { connect: { id: viewer.id } },
      ...(employee.directManagerId && { manager: { connect: { id: employee.directManagerId } } }),
      creator: { connect: { id: viewer.id } },
      workflowVersion: 2,
      status: ConfirmationStatus.draft,
      summary: dto.summary?.trim() || null,
    };
    let app;
    try {
      app = await this.prisma.confirmationApplication.create({ data, include: this.detailInclude() });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '已有办理中的转正申请，请继续原申请' });
      }
      throw error;
    }

    return this.mapToDetail(app as unknown as ConfirmationWithRelations, viewer, false);
  }

  /** 员工本人修改尚未提交的新版草稿。 */
  async update(id: string, dto: SaveSelfConfirmationDto, viewer: AuthUser): Promise<ConfirmationDetail> {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.workflowVersion !== 2) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '原试用期转正记录仅供查阅' });
    }
    if (app.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可修改工作小结' });
    }
    if (app.status !== ConfirmationStatus.draft) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅草稿状态可修改',
      });
    }

    if (dto.summary === undefined) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写工作小结' });
    }

    const updated = await this.prisma.confirmationApplication.updateMany({
      where: { id, employeeId: viewer.id, status: ConfirmationStatus.draft },
      data: { summary: dto.summary.trim() || null },
    });
    if (updated.count !== 1) {
      throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
    }
    return this.findOne(id, viewer);
  }

  private async effectiveCompanyApproverId(deptId: string | null): Promise<string> {
    if (!deptId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '员工档案缺少所属部门，请联系 HR 核实' });
    }
    const departments = await this.prisma.department.findMany({ select: {
      id: true, name: true, parentId: true, leaderId: true, approverId: true,
      leader: { select: { name: true, directManagerId: true, directManager: { select: { name: true } } } },
      approver: { select: { name: true } },
    } });
    const approverId = buildPerformanceApproverMap(departments.map((dept) => ({
      id: dept.id, name: dept.name, parentId: dept.parentId, leaderId: dept.leaderId,
      leaderName: dept.leader?.name ?? null,
      leaderDirectManagerId: dept.leader?.directManagerId ?? null,
      leaderDirectManagerName: dept.leader?.directManager?.name ?? null,
      approverId: dept.approverId, approverName: dept.approver?.name ?? null,
    }))).get(deptId)?.approverId;
    if (!approverId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '所属部门尚无有效的最终业务审批人，请联系 HR 核实组织设置' });
    }
    return approverId;
  }

  /** 员工本人提交转正申请；主管和公司审批人从当前档案、组织设置确定。 */
  async submit(id: string, viewer: AuthUser): Promise<{ id: string; status: ConfirmationStatus }> {
    const app = await this.prisma.confirmationApplication.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.workflowVersion !== 2) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '原试用期转正记录仅供查阅' });
    }
    if (app.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可提交转正申请' });
    }
    if (app.status !== ConfirmationStatus.draft) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅草稿状态可提交',
      });
    }
    if (!app.summary?.trim()) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写试用期工作小结' });
    }
    const employee = await this.prisma.user.findUnique({
      where: { id: app.employeeId },
      select: { status: true, deletedAt: true, directManagerId: true, deptId: true },
    });
    if (!employee || employee.deletedAt || employee.status !== UserStatus.probation) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '员工档案不再处于试用期，请联系 HR 核实' });
    }
    if (!employee.directManagerId || employee.directManagerId === app.employeeId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请先在员工档案中维护有效的直属主管' });
    }
    const companyApproverId = await this.effectiveCompanyApproverId(employee.deptId);
    if (companyApproverId === app.employeeId) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '最终业务审批人不能是申请员工本人，请联系 HR 核实组织设置' });
    }
    const approver = await this.prisma.user.findUnique({ where: { id: companyApproverId },
      select: { status: true, deletedAt: true } });
    if (!approver || approver.deletedAt || approver.status !== UserStatus.active) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '最终业务审批人不在职，请联系 HR 核实组织设置' });
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.confirmationApplication.updateMany({
        where: { id, workflowVersion: 2, status: ConfirmationStatus.draft, employeeId: viewer.id,
          submissionVersion: app.submissionVersion, summary: app.summary,
          managerId: app.managerId, hrId: app.hrId, companyApproverId: app.companyApproverId },
        data: {
          managerId: employee.directManagerId,
          hrId: null,
          companyApproverId,
          status: ConfirmationStatus.submitted,
          submissionVersion: { increment: 1 },
          returnReason: null,
          returnedAt: null,
          returnedById: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'confirmation_employee_submitted',
          entityType: 'confirmation_application',
          entityId: id,
          oldValue: { status: app.status, submissionVersion: app.submissionVersion, returnReason: app.returnReason },
          newValue: {
            status: ConfirmationStatus.submitted,
            submissionVersion: app.submissionVersion + 1,
            summary: app.summary,
            managerId: employee.directManagerId,
            hrId: null,
            companyApproverId,
          },
        },
      });
    });

    await this.notifyApplication(id, app.submissionVersion + 1, [employee.directManagerId], viewer.id,
      'confirmation_manager_pending', '转正申请待直属主管评价', '有一份员工转正申请待您评价。');
    return { id, status: ConfirmationStatus.submitted };
  }

  /** 转正管理列表覆盖本数据范围的员工草稿和办理记录。 */
  async findAll(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    this.assertConfirmationManager(viewer);
    const scope = await this.dataScope.getConfirmationEmployeeFilter(viewer);
    return this.findMany(dto, { employee: { is: scope } }, viewer);
  }

  /** 当前用户作为审批人待审批列表。 */
  async findPending(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    const hrScope = this.isConfirmationManager(viewer)
      ? await this.dataScope.getConfirmationEmployeeFilter(viewer) : { id: { in: [] } };
    const where: Prisma.ConfirmationApplicationWhereInput = {
      workflowVersion: 2,
      OR: [
        { status: ConfirmationStatus.submitted, managerId: viewer.id },
        { status: ConfirmationStatus.manager_approved, employeeId: { not: viewer.id },
          companyApproverId: { not: viewer.id }, employee: { is: hrScope } },
        { status: ConfirmationStatus.hr_approved, companyApproverId: viewer.id },
      ],
    };
    return this.findMany(dto, where, viewer);
  }

  /** 本人参与过的新版申请，扣除当前轮到本人办理的申请。 */
  async findAssignedHistory(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    const hrScope = this.isConfirmationManager(viewer)
      ? await this.dataScope.getConfirmationEmployeeFilter(viewer) : { id: { in: [] } };
    const pending: Prisma.ConfirmationApplicationWhereInput = {
      OR: [
        { status: ConfirmationStatus.submitted, managerId: viewer.id },
        { status: ConfirmationStatus.manager_approved, hrId: viewer.id },
        { status: ConfirmationStatus.hr_approved, companyApproverId: viewer.id },
      ],
    };
    return this.findMany(dto, {
      workflowVersion: 2,
      submissionVersion: { gt: 0 },
      AND: [
        { OR: [{ managerId: viewer.id }, { companyApproverId: viewer.id },
          { hrId: viewer.id, hrApprovedAt: { not: null }, employee: { is: hrScope } }] },
        { NOT: pending },
      ],
    }, viewer);
  }

  /** 员工查看自己的转正申请。 */
  async findMine(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    return this.findMany(dto, { employeeId: viewer.id }, viewer);
  }

  private async findMany(
    dto: PaginationDto,
    baseWhere: Prisma.ConfirmationApplicationWhereInput,
    viewer: AuthUser,
  ): Promise<Paginated<ConfirmationListItem>> {
    const query = dto as PaginationDto & { employeeId?: string; status?: ConfirmationStatus; keyword?: string };
    const where: Prisma.ConfirmationApplicationWhereInput = {
      AND: [
        baseWhere,
        ...(query.employeeId ? [{ employeeId: query.employeeId }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.keyword ? [{ employee: { name: { contains: query.keyword, mode: 'insensitive' as const } } }] : []),
      ],
    };

    const [total, items] = await Promise.all([
      this.prisma.confirmationApplication.count({ where }),
      this.prisma.confirmationApplication.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
          hr: { select: { id: true, name: true } },
          companyApprover: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
    ]);

    return paginated(
      await Promise.all(items.map(async (item) => this.mapToListItem(item as unknown as ConfirmationWithRelations,
        viewer, await this.canHandleHr(item.employeeId, viewer, item.companyApproverId)))),
      total,
      dto,
    );
  }

  /** 详情。 */
  async findOne(id: string, viewer: AuthUser): Promise<ConfirmationDetail> {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    await this.assertCanView(app as unknown as ConfirmationWithRelations, viewer);
    const hrScoped = await this.canHandleHr(app.employeeId, viewer, app.companyApproverId);
    const detail = this.mapToDetail(app as unknown as ConfirmationWithRelations, viewer, hrScoped);
    if (app.workflowVersion !== 2) return { ...detail, history: [] };
    const isInternalViewer = hrScoped || app.companyApproverId === viewer.id;
    const canSeeManagerOpinion = isInternalViewer || app.managerId === viewer.id || hrScoped;
    const logs = await this.prisma.auditLog.findMany({
      where: { entityType: 'confirmation_application', entityId: id, action: { startsWith: 'confirmation_' } },
      select: { id: true, action: true, createdAt: true, newValue: true, oldValue: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const labels: Record<string, string> = {
      confirmation_handlers_assigned: '旧流程办理关系设置',
      confirmation_handlers_reassigned: '旧流程办理关系调整',
      confirmation_employee_submitted: '员工提交申请',
      confirmation_manager_evaluated: '直属主管提交评价',
      confirmation_hr_conclusion_recorded: 'HR 记录线下评议',
      confirmation_company_approved: '公司同意转正',
      confirmation_company_declined: '公司不同意转正',
      confirmation_returned_for_supplement: '退回员工补充',
      confirmation_meeting_attachment_added: '内部评议附件已上传',
      confirmation_meeting_date_backfilled: 'HR 补录会议日期',
      confirmation_company_approver_corrected: '分管审批人已更正',
    };
    detail.history = logs.flatMap((log) => {
      if (!labels[log.action] || (!isInternalViewer && log.action === 'confirmation_meeting_attachment_added')) return [];
      const newValue = log.newValue as Record<string, unknown> | null;
      const oldValue = log.oldValue as Record<string, unknown> | null;
      const rawVersion = newValue?.submissionVersion ?? oldValue?.submissionVersion;
      const submissionVersion = typeof rawVersion === 'number' ? rawVersion : null;
      const note = log.action === 'confirmation_returned_for_supplement'
        ? (typeof newValue?.returnReason === 'string' ? newValue.returnReason
          : typeof newValue?.reason === 'string' ? newValue.reason : null)
        : ['confirmation_company_declined', 'confirmation_company_approver_corrected'].includes(log.action)
          ? (typeof newValue?.reason === 'string' ? newValue.reason : null) : null;
      const snapshot = log.action === 'confirmation_returned_for_supplement' && oldValue
        ? {
          ...(typeof oldValue.summary === 'string' ? { summary: oldValue.summary } : {}),
          ...(canSeeManagerOpinion && typeof oldValue.managerRecommendation === 'boolean'
            ? { managerRecommendation: oldValue.managerRecommendation } : {}),
          ...(canSeeManagerOpinion && typeof oldValue.managerComment === 'string'
            ? { managerComment: oldValue.managerComment } : {}),
          ...(isInternalViewer && typeof oldValue.voteResult === 'string'
            ? { voteResult: oldValue.voteResult as VoteResult } : {}),
          ...(isInternalViewer && typeof oldValue.voteComment === 'string'
            ? { voteComment: oldValue.voteComment } : {}),
          ...(isInternalViewer && typeof oldValue.hrComment === 'string'
            ? { hrComment: oldValue.hrComment } : {}),
          ...(isInternalViewer && typeof oldValue.proposedRegularDate === 'string'
            ? { proposedRegularDate: oldValue.proposedRegularDate } : {}),
        } : null;
      return [{ id: log.id, label: labels[log.action], actorName: log.user?.name ?? null,
        occurredAt: log.createdAt, submissionVersion, note, snapshot }];
    });
    return detail;
  }

  /** 审批通过。 */
  async approve(
    id: string,
    dto: ApproveConfirmationDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: ConfirmationStatus }> {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.workflowVersion !== 2) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '原试用期转正记录仅供查阅' });
    }

    const pendingRole = this.determinePendingRole(app.status);
    if (!pendingRole) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不可审批',
      });
    }
    await this.assertApprover(app as unknown as ConfirmationWithRelations, pendingRole, viewer);
    if (pendingRole === 'manager' && (typeof dto.recommendation !== 'boolean' || !dto.comment?.trim())) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写是否建议转正及评价原因' });
    }
    if (pendingRole === 'company') {
      const proposedDate = app.proposedRegularDate;
      if (!proposedDate || !dto.confirmedRegularDate
        || Number.isNaN(dto.confirmedRegularDate.getTime())
        || proposedDate.toISOString().slice(0, 10) !== dto.confirmedRegularDate.toISOString().slice(0, 10)) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请确认 HR 填写的拟生效日期' });
      }
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.confirmationApplication.updateMany({
          where: { id, status: ConfirmationStatus.hr_approved, companyApproverId: viewer.id },
          data: {
            status: ConfirmationStatus.approved,
            actualRegularDate: proposedDate,
            companyComment: dto.comment?.trim() || null,
            companyApprovedAt: now,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
        }
        const employeeUpdated = await tx.user.updateMany({
          where: { id: app.employeeId, status: UserStatus.probation, deletedAt: null },
          data: { actualRegularDate: proposedDate, status: UserStatus.active },
        });
        if (employeeUpdated.count !== 1) {
          throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '员工状态已变化，请 HR 核实档案' });
        }
        await tx.auditLog.create({
          data: {
            userId: viewer.id,
            action: 'confirmation_company_approved',
            entityType: 'confirmation_application',
            entityId: id,
            oldValue: { status: app.status },
            newValue: { status: ConfirmationStatus.approved, actualRegularDate: proposedDate.toISOString().slice(0, 10), submissionVersion: app.submissionVersion },
          },
        });
      });
      await this.notifyApplication(id, app.submissionVersion, [app.employeeId, app.hrId], viewer.id,
        'confirmation_approved', '转正申请已同意', '公司已同意转正，请查看最终结论和生效日期。');
      return { id, status: ConfirmationStatus.approved };
    }

    const now = new Date();
    let updateData: Prisma.ConfirmationApplicationUpdateInput;
    let auditAction: string;
    let auditNewValue: Prisma.InputJsonObject;
    if (pendingRole === 'manager') {
      updateData = {
        status: ConfirmationStatus.manager_approved,
        managerComment: dto.comment!.trim(),
        managerRecommendation: dto.recommendation,
        managerApprovedAt: now,
      };
      auditAction = 'confirmation_manager_evaluated';
      auditNewValue = { status: ConfirmationStatus.manager_approved, recommendation: dto.recommendation!, comment: dto.comment!.trim(), submissionVersion: app.submissionVersion };
    } else {
      if (!dto.voteResult || !dto.proposedRegularDate || Number.isNaN(dto.proposedRegularDate.getTime())) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写线下评议结论和拟生效日期' });
      }
      const basis = dto.voteComment?.trim() ?? '';
      const attachmentCount = basis ? 0 : await this.prisma.confirmationMeetingAttachment.count({ where: { applicationId: id, submissionVersion: app.submissionVersion } });
      if (!basis && attachmentCount === 0) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写结论依据或上传内部附件' });
      }
      updateData = {
        status: ConfirmationStatus.hr_approved,
        voteResult: dto.voteResult,
        voteComment: basis || null,
        meetingDate: dto.meetingDate ?? null,
        voteRecordedAt: now,
        voteRecordedBy: { connect: { id: viewer.id } },
        proposedRegularDate: dto.proposedRegularDate,
        hrComment: dto.comment?.trim() || null,
        hrApprovedAt: now,
      };
      auditAction = 'confirmation_hr_conclusion_recorded';
      auditNewValue = {
        status: ConfirmationStatus.hr_approved,
        voteResult: dto.voteResult,
        proposedRegularDate: dto.proposedRegularDate.toISOString().slice(0, 10),
        meetingDate: dto.meetingDate?.toISOString().slice(0, 10) ?? null,
        hasBasisText: Boolean(basis),
        attachmentCount,
        submissionVersion: app.submissionVersion,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.confirmationApplication.updateMany({
        where: {
          id,
          status: app.status,
          ...(pendingRole === 'manager' ? { managerId: viewer.id } : {}),
        },
        data: pendingRole === 'hr' ? { ...updateData, hrId: viewer.id } : updateData,
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: auditAction,
          entityType: 'confirmation_application',
          entityId: id,
          oldValue: { status: app.status },
          newValue: auditNewValue,
        },
      });
    });

    await this.notifyApplication(id, app.submissionVersion,
      pendingRole === 'manager' ? await this.hrRecipients(
        (app.employee as unknown as { dept?: { company: CompanyCode } | null } | undefined)?.dept?.company ?? null,
        app.employeeId, app.companyApproverId)
        : [app.companyApproverId], viewer.id,
      pendingRole === 'manager' ? 'confirmation_hr_pending' : 'confirmation_company_pending',
      pendingRole === 'manager' ? '转正申请待 HR 办理' : '转正申请待公司审批',
      '有一份员工转正申请待您办理。');

    return { id, status: updateData.status as ConfirmationStatus };
  }

  /** 驳回。 */
  async reject(
    id: string,
    dto: RejectConfirmationDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: ConfirmationStatus }> {
    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.workflowVersion !== 2) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '原试用期转正记录仅供查阅' });
    }
    if (app.status !== ConfirmationStatus.hr_approved || app.companyApproverId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅当前公司审批人可作最终决定' });
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写不同意转正的原因' });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.confirmationApplication.updateMany({
        where: { id, status: ConfirmationStatus.hr_approved, companyApproverId: viewer.id },
        data: {
          status: ConfirmationStatus.rejected,
          rejectedById: viewer.id,
          rejectedAt: now,
          rejectReason: dto.reason.trim(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'confirmation_company_declined',
          entityType: 'confirmation_application',
          entityId: id,
          oldValue: { status: app.status },
          newValue: { status: ConfirmationStatus.rejected, reason: dto.reason.trim(), submissionVersion: app.submissionVersion },
        },
      });
    });
    await this.notifyApplication(id, app.submissionVersion, [app.employeeId, app.hrId], viewer.id,
      'confirmation_declined', '转正申请未获同意', '公司已作出转正决定，请查看办理结论。');
    return { id, status: ConfirmationStatus.rejected };
  }

  /** 当前环节的有权人员退回员工补充，旧轮次意见留在审计和附件版本中。 */
  async returnForSupplement(id: string, dto: ReturnConfirmationDto, viewer: AuthUser) {
    const app = await this.prisma.confirmationApplication.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.workflowVersion !== 2) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '原试用期转正记录仅供查阅' });
    }
    const pendingRole = this.determinePendingRole(app.status);
    if (!pendingRole) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '当前环节不可退回补充' });
    }
    await this.assertApprover(app as unknown as ConfirmationWithRelations, pendingRole, viewer);
    if (!dto.reason?.trim()) {
      throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写退回补充原因' });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.confirmationApplication.updateMany({
        where: {
          id,
          status: app.status,
          ...(pendingRole === 'manager' ? { managerId: viewer.id }
            : pendingRole === 'hr' ? {} : { companyApproverId: viewer.id }),
        },
        data: {
          ...(pendingRole === 'hr' ? { hrId: viewer.id } : {}),
          status: ConfirmationStatus.draft,
          returnReason: dto.reason.trim(),
          returnedAt: now,
          returnedById: viewer.id,
          managerComment: null,
          managerRecommendation: null,
          managerApprovedAt: null,
          hrComment: null,
          hrApprovedAt: null,
          voteResult: null,
          voteComment: null,
          meetingDate: null,
          voteRecordedAt: null,
          voteRecordedById: null,
          proposedRegularDate: null,
          companyComment: null,
          companyApprovedAt: null,
          actualRegularDate: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.PARAM_INVALID, message: '申请状态已变化，请刷新后重试' });
      }
      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'confirmation_returned_for_supplement',
          entityType: 'confirmation_application',
          entityId: id,
          oldValue: {
            status: app.status,
            submissionVersion: app.submissionVersion,
            summary: app.summary,
            managerRecommendation: app.managerRecommendation,
            managerComment: app.managerComment,
            hrComment: app.hrComment,
            voteResult: app.voteResult,
            voteComment: app.voteComment,
            meetingDate: app.meetingDate?.toISOString().slice(0, 10) ?? null,
            proposedRegularDate: app.proposedRegularDate?.toISOString().slice(0, 10) ?? null,
          },
          newValue: { status: ConfirmationStatus.draft, returnReason: dto.reason.trim(), submissionVersion: app.submissionVersion },
        },
      });
    });
    await this.notifyApplication(id, app.submissionVersion, [app.employeeId], viewer.id,
      'confirmation_returned', '转正申请需补充', '您的转正申请已退回，请查看原因并补充工作小结。');
    return { id, status: ConfirmationStatus.draft, returnReason: dto.reason.trim() };
  }

  /** 预警：临期、逾期或缺少计划转正日期的试用期员工。 */
  async warnings(viewer: AuthUser): Promise<WarningItem[]> {
    this.assertConfirmationManager(viewer);

    const scope = await this.dataScope.getConfirmationEmployeeFilter(viewer);

    const deadline = new Date(Date.now() + 7 * DAY_MS);
    const probationUsers = await this.prisma.user.findMany({
      where: {
        status: UserStatus.probation,
        deletedAt: null,
        OR: [{ plannedRegularDate: { lte: deadline } }, { plannedRegularDate: null }],
        AND: [scope],
      },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        dept: { select: { name: true } },
        plannedRegularDate: true,
      },
    });

    const applications = await this.prisma.confirmationApplication.findMany({
      where: {
        employeeId: { in: probationUsers.map((u) => u.id) },
        status: {
          in: [
            ConfirmationStatus.submitted,
            ConfirmationStatus.manager_approved,
            ConfirmationStatus.hr_approved,
            ConfirmationStatus.approved,
          ],
        },
      },
      select: { employeeId: true },
    });
    const covered = new Set(applications.map((a) => a.employeeId));

    return probationUsers.map((u) => ({
      employeeId: u.id,
      employeeName: u.name,
      employeeNo: u.employeeNo,
      deptName: u.dept?.name ?? null,
      plannedRegularDate: u.plannedRegularDate,
      daysUntil: u.plannedRegularDate
        ? Math.ceil((new Date(u.plannedRegularDate).getTime() - Date.now()) / DAY_MS)
        : null,
      hasApplication: covered.has(u.id),
    }));
  }

  // ---------------------------------------------------------------------------
  // 权限断言
  // ---------------------------------------------------------------------------

  private assertConfirmationManager(viewer: AuthUser): void {
    if (this.isConfirmationManager(viewer)) return;
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅获授权的 HR 可管理转正申请' });
  }

  private isConfirmationManager(viewer: AuthUser): boolean {
    return viewer.sysRole === SysRole.hr || (viewer.sysRole === SysRole.hr_user && Boolean(viewer.hrCapabilities?.includes('confirmation_manage')));
  }

  private async canHandleHr(employeeId: string, viewer: AuthUser, companyApproverId?: string | null): Promise<boolean> {
    if (!this.isConfirmationManager(viewer) || employeeId === viewer.id || companyApproverId === viewer.id) return false;
    const scope = await this.dataScope.getConfirmationEmployeeFilter(viewer);
    return await this.prisma.user.count({ where: { AND: [scope, { id: employeeId }] } }) === 1;
  }

  private async hrRecipients(company: CompanyCode | null, employeeId: string, companyApproverId: string | null): Promise<string[]> {
    const people = await this.prisma.user.findMany({ where: {
      id: { notIn: [employeeId, ...(companyApproverId ? [companyApproverId] : [])] },
      status: UserStatus.active, deletedAt: null,
      OR: [
        { sysRole: SysRole.hr },
        ...(company ? [{ sysRole: SysRole.hr_user, hrCapabilities: { has: 'confirmation_manage' },
          dept: { is: { company } } }] : []),
      ],
    }, select: { id: true } });
    return people.map((person) => person.id);
  }

  private async assertCanView(app: ConfirmationWithRelations, viewer: AuthUser): Promise<void> {
    if (app.workflowVersion === 2) {
      if (app.status === ConfirmationStatus.draft && !app.submissionVersion) {
        if (app.employeeId === viewer.id) return;
      } else if ([app.employeeId, app.managerId, app.companyApproverId].includes(viewer.id)) {
        return;
      }
    } else if (
      app.employeeId === viewer.id ||
      app.managerId === viewer.id ||
      app.hrId === viewer.id ||
      app.companyApproverId === viewer.id ||
      app.createdBy === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin
    ) {
      return;
    }
    if (this.isConfirmationManager(viewer)) {
      const scope = await this.dataScope.getConfirmationEmployeeFilter(viewer);
      const count = await this.prisma.user.count({ where: { AND: [scope, { id: app.employeeId }] } });
      if (count === 1) return;
    }
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该转正申请' });
  }

  private async assertApprover(
    app: ConfirmationWithRelations,
    role: 'manager' | 'hr' | 'company',
    viewer: AuthUser,
  ): Promise<void> {
    if (role === 'hr') {
      if (await this.canHandleHr(app.employeeId, viewer, app.companyApproverId)) return;
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅本公司有转正办理权限的 HR 可操作' });
    }
    let expectedId: string | null;
    if (role === 'manager') expectedId = app.managerId;
    else expectedId = app.companyApproverId;

    if (expectedId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅指定审批人可操作' });
    }
  }

  private async assertUsersExist(ids: string[]): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    const found = new Set(users.map((u) => u.id));
    for (const id of ids) {
      if (!found.has(id)) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: `用户 ${id} 不存在` });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private determinePendingRole(status: ConfirmationStatus): 'manager' | 'hr' | 'company' | null {
    switch (status) {
      case ConfirmationStatus.submitted:
        return 'manager';
      case ConfirmationStatus.manager_approved:
        return 'hr';
      case ConfirmationStatus.hr_approved:
        return 'company';
      default:
        return null;
    }
  }

  private detailInclude(): Prisma.ConfirmationApplicationInclude {
    return {
      employee: { select: { id: true, name: true, employeeNo: true, position: true,
        entryDate: true, plannedRegularDate: true, dept: { select: { name: true, company: true } } } },
      manager: { select: { id: true, name: true } },
      hr: { select: { id: true, name: true } },
      companyApprover: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      probationReview: { select: { id: true } },
      meetingAttachments: {
        select: { id: true, name: true, size: true, mimeType: true, uploadedById: true, createdAt: true, submissionVersion: true },
        orderBy: { createdAt: 'asc' },
      },
    };
  }

  private canViewSalary(app: ConfirmationWithRelations, viewer: AuthUser): boolean {
    return (
      app.managerId === viewer.id ||
      app.hrId === viewer.id ||
      app.companyApproverId === viewer.id ||
      app.createdBy === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin
    );
  }

  private mapToListItem(app: ConfirmationWithRelations, viewer: AuthUser, hrScoped = false): ConfirmationListItem {
    const canViewInternalMeeting = app.workflowVersion !== 2 || hrScoped || app.companyApproverId === viewer.id;
    const pendingRole = this.determinePendingRole(app.status);
    return {
      id: app.id,
      workflowVersion: app.workflowVersion,
      submissionVersion: app.submissionVersion,
      returnReason: app.returnReason,
      employeeId: app.employeeId,
      managerId: app.managerId,
      hrId: app.workflowVersion !== 2 || app.hrApprovedAt ? app.hrId : null,
      companyApproverId: app.companyApproverId,
      status: app.status,
      pendingRole: pendingRole && this.isPendingApprover(app, pendingRole, viewer, hrScoped) ? pendingRole : null,
      employee: app.employee,
      manager: app.manager,
      hr: app.workflowVersion !== 2 || app.hrApprovedAt ? app.hr : null,
      companyApprover: app.companyApprover,
      voteResult: canViewInternalMeeting ? app.voteResult : null,
      voteMeetingTime: canViewInternalMeeting ? app.voteMeetingTime : null,
      meetingDate: canViewInternalMeeting ? app.meetingDate : null,
      proposedRegularDate: canViewInternalMeeting ? app.proposedRegularDate : null,
      actualRegularDate: app.actualRegularDate,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  private mapToDetail(app: ConfirmationWithRelations, viewer: AuthUser, hrScoped = false): ConfirmationDetail {
    const canViewInternalMeeting = app.workflowVersion !== 2 || hrScoped || app.companyApproverId === viewer.id;
    const pendingRole = this.determinePendingRole(app.status);
    const steps: ApprovalStep[] = [
      {
        role: 'manager',
        status:
          app.status === ConfirmationStatus.rejected && pendingRole === 'manager'
            ? 'rejected'
            : app.managerApprovedAt
              ? 'approved'
              : app.status === ConfirmationStatus.submitted ||
                  app.status === ConfirmationStatus.manager_approved ||
                  app.status === ConfirmationStatus.hr_approved ||
                  app.status === ConfirmationStatus.approved
                ? 'pending'
                : 'pending',
        approver: app.manager,
        comment: app.managerComment,
        actedAt: app.managerApprovedAt,
      },
      {
        role: 'hr',
        status:
          app.status === ConfirmationStatus.rejected && pendingRole === 'hr'
            ? 'rejected'
            : app.hrApprovedAt
              ? 'approved'
              : app.status === ConfirmationStatus.manager_approved ||
                  app.status === ConfirmationStatus.hr_approved ||
                  app.status === ConfirmationStatus.approved
                ? 'pending'
                : 'pending',
        approver: app.workflowVersion !== 2 || app.hrApprovedAt ? app.hr : null,
        comment: canViewInternalMeeting ? app.hrComment : null,
        actedAt: app.hrApprovedAt,
      },
      {
        role: 'company',
        status:
          app.status === ConfirmationStatus.rejected
            ? 'rejected'
            : app.companyApprovedAt
              ? 'approved'
              : app.status === ConfirmationStatus.hr_approved || app.status === ConfirmationStatus.approved
                ? 'pending'
                : 'pending',
        approver: app.companyApprover,
        comment: app.companyComment,
        actedAt: app.status === ConfirmationStatus.rejected ? app.rejectedAt : app.companyApprovedAt,
      },
    ];

    return {
      ...this.mapToListItem(app, viewer, hrScoped),
      roster: { employeeNo: app.employee.employeeNo ?? null, company: app.employee.dept?.company ?? null,
        deptName: app.employee.dept?.name ?? null, position: app.employee.position ?? null,
        entryDate: app.employee.entryDate ?? null, plannedRegularDate: app.employee.plannedRegularDate ?? null },
      probationReviewId: app.probationReviewId,
      summary: app.summary,
      managerRecommendation: app.managerRecommendation,
      returnReason: app.returnReason,
      returnedAt: app.returnedAt,
      voteRecordedAt: canViewInternalMeeting ? app.voteRecordedAt : null,
      meetingAttachments: app.workflowVersion === 2 && (hrScoped || viewer.id === app.companyApproverId)
        ? (app.meetingAttachments ?? []).filter((attachment) => attachment.submissionVersion === app.submissionVersion) : [],
      salary: app.workflowVersion !== 2 && this.canViewSalary(app, viewer)
        ? app.salary
          ? (app.salary as unknown as { toNumber: () => number }).toNumber()
          : null
        : null,
      voteParticipants: canViewInternalMeeting ? app.voteParticipants as string[] : [],
      voteComment: canViewInternalMeeting ? app.voteComment : null,
      rejectedBy: app.rejectedBy,
      rejectedAt: app.rejectedAt,
      rejectReason: app.rejectReason,
      steps,
      canApprove: app.workflowVersion === 2 && pendingRole !== null
        ? this.isPendingApprover(app, pendingRole, viewer, hrScoped) : false,
      canReject: app.workflowVersion === 2 && pendingRole === 'company'
        ? this.isPendingApprover(app, pendingRole, viewer, hrScoped) : false,
      canReturn: app.workflowVersion === 2 && pendingRole !== null
        ? this.isPendingApprover(app, pendingRole, viewer, hrScoped) : false,
      canViewInternalMeeting,
      pendingRole,
      history: [],
    };
  }

  private isPendingApprover(
    app: ConfirmationWithRelations,
    role: 'manager' | 'hr' | 'company',
    viewer: AuthUser,
    hrScoped = false,
  ): boolean {
    if (role === 'manager') return app.managerId === viewer.id;
    if (role === 'hr') return hrScoped;
    return app.companyApproverId === viewer.id;
  }
}

interface ConfirmationWithRelations {
  id: string;
  workflowVersion: number;
  submissionVersion: number;
  status: ConfirmationStatus;
  employeeId: string;
  managerId: string | null;
  hrId: string | null;
  companyApproverId: string | null;
  probationReviewId: string | null;
  summary: string | null;
  salary: Prisma.Decimal | null;
  voteResult: VoteResult | null;
  voteParticipants: Prisma.JsonValue;
  voteComment: string | null;
  voteMeetingTime: Date | null;
  meetingDate: Date | null;
  voteRecordedAt: Date | null;
  proposedRegularDate: Date | null;
  actualRegularDate: Date | null;
  managerComment: string | null;
  managerRecommendation: boolean | null;
  returnReason: string | null;
  returnedAt: Date | null;
  managerApprovedAt: Date | null;
  hrComment: string | null;
  hrApprovedAt: Date | null;
  companyComment: string | null;
  companyApprovedAt: Date | null;
  rejectedById: string | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee: { id: string; name: string; employeeNo?: string | null; position?: string | null;
    entryDate?: Date | null; plannedRegularDate?: Date | null;
    dept?: { name: string; company: string } | null };
  manager: { id: string; name: string } | null;
  hr: { id: string; name: string } | null;
  companyApprover: { id: string; name: string } | null;
  rejectedBy: { id: string; name: string } | null;
  creator: { id: string; name: string } | null;
  probationReview: { id: string } | null;
  meetingAttachments?: Array<{ id: string; name: string; size: number; mimeType: string; uploadedById: string; createdAt: Date; submissionVersion: number }>;
}
