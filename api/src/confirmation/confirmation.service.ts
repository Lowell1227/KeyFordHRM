import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfirmationStatus, Prisma, SysRole, UserStatus, VoteResult } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { Paginated, paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { CreateConfirmationDto } from './dto/create-confirmation.dto';
import { UpdateConfirmationDto } from './dto/update-confirmation.dto';
import { ApproveConfirmationDto } from './dto/approve-confirmation.dto';
import { RejectConfirmationDto } from './dto/reject-confirmation.dto';

export interface ConfirmationListItem {
  id: string;
  status: ConfirmationStatus;
  employee: { id: string; name: string };
  manager: { id: string; name: string };
  hr: { id: string; name: string };
  companyApprover: { id: string; name: string };
  voteResult: VoteResult | null;
  voteMeetingTime: Date | null;
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
  probationReviewId: string | null;
  summary: string | null;
  salary: number | null;
  voteParticipants: string[];
  voteComment: string | null;
  rejectedBy: { id: string; name: string } | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  steps: ApprovalStep[];
  canApprove: boolean;
  canReject: boolean;
  pendingRole: 'manager' | 'hr' | 'company' | null;
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
  constructor(private readonly prisma: PrismaService) {}

  /** HR 创建转正申请。 */
  async create(dto: CreateConfirmationDto, viewer: AuthUser): Promise<ConfirmationDetail> {
    this.assertHr(viewer);

    const employee = await this.prisma.user.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, name: true, status: true, deletedAt: true },
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

    await this.assertUsersExist([dto.managerId, dto.hrId, dto.companyApproverId]);

    const data: Prisma.ConfirmationApplicationCreateInput = {
      employee: { connect: { id: dto.employeeId } },
      manager: { connect: { id: dto.managerId } },
      hr: { connect: { id: dto.hrId } },
      companyApprover: { connect: { id: dto.companyApproverId } },
      creator: { connect: { id: viewer.id } },
      status: ConfirmationStatus.draft,
      summary: dto.summary,
      salary: dto.salary != null ? new Prisma.Decimal(dto.salary) : undefined,
      voteResult: dto.voteResult,
      voteParticipants: dto.voteParticipants ?? [],
      voteComment: dto.voteComment,
      voteMeetingTime: dto.voteMeetingTime,
      actualRegularDate: dto.actualRegularDate,
    };

    if (dto.probationReviewId) {
      const review = await this.prisma.probationReview.findUnique({
        where: { id: dto.probationReviewId },
        select: { id: true },
      });
      if (!review) {
        throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
      }
      data.probationReview = { connect: { id: dto.probationReviewId } };
    }

    const app = await this.prisma.confirmationApplication.create({
      data,
      include: this.detailInclude(),
    });

    return this.mapToDetail(app as unknown as ConfirmationWithRelations, viewer);
  }

  /** HR 修改草稿。 */
  async update(id: string, dto: UpdateConfirmationDto, viewer: AuthUser): Promise<ConfirmationDetail> {
    this.assertHr(viewer);

    const app = await this.prisma.confirmationApplication.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.status !== ConfirmationStatus.draft) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅草稿状态可修改',
      });
    }

    const data: Prisma.ConfirmationApplicationUpdateInput = {};
    if (dto.employeeId !== undefined) data.employee = { connect: { id: dto.employeeId } };
    if (dto.managerId !== undefined) data.manager = { connect: { id: dto.managerId } };
    if (dto.hrId !== undefined) data.hr = { connect: { id: dto.hrId } };
    if (dto.companyApproverId !== undefined) data.companyApprover = { connect: { id: dto.companyApproverId } };
    if (dto.probationReviewId !== undefined) {
      data.probationReview = dto.probationReviewId
        ? { connect: { id: dto.probationReviewId } }
        : { disconnect: true };
    }
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.salary !== undefined) data.salary = dto.salary != null ? new Prisma.Decimal(dto.salary) : null;
    if (dto.voteResult !== undefined) data.voteResult = dto.voteResult;
    if (dto.voteParticipants !== undefined) data.voteParticipants = dto.voteParticipants ?? [];
    if (dto.voteComment !== undefined) data.voteComment = dto.voteComment;
    if (dto.voteMeetingTime !== undefined) data.voteMeetingTime = dto.voteMeetingTime;
    if (dto.actualRegularDate !== undefined) data.actualRegularDate = dto.actualRegularDate;

    const updated = await this.prisma.confirmationApplication.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });

    return this.mapToDetail(updated as unknown as ConfirmationWithRelations, viewer);
  }

  /** HR 提交转正申请进入审批。 */
  async submit(id: string, viewer: AuthUser): Promise<{ id: string; status: ConfirmationStatus }> {
    this.assertHr(viewer);

    const app = await this.prisma.confirmationApplication.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '转正申请不存在' });
    }
    if (app.status !== ConfirmationStatus.draft) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅草稿状态可提交',
      });
    }

    await this.prisma.confirmationApplication.update({
      where: { id },
      data: { status: ConfirmationStatus.submitted },
    });

    return { id, status: ConfirmationStatus.submitted };
  }

  /** 列表（HR/系统管理员）。 */
  async findAll(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    this.assertHr(viewer);
    return this.findMany(dto, {});
  }

  /** 当前用户作为审批人待审批列表。 */
  async findPending(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    const where: Prisma.ConfirmationApplicationWhereInput = {
      OR: [
        { status: ConfirmationStatus.submitted, managerId: viewer.id },
        { status: ConfirmationStatus.manager_approved, hrId: viewer.id },
        { status: ConfirmationStatus.hr_approved, companyApproverId: viewer.id },
      ],
    };
    return this.findMany(dto, where);
  }

  /** 员工查看自己的转正申请。 */
  async findMine(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<ConfirmationListItem>> {
    return this.findMany(dto, { employeeId: viewer.id });
  }

  private async findMany(
    dto: PaginationDto,
    baseWhere: Prisma.ConfirmationApplicationWhereInput,
  ): Promise<Paginated<ConfirmationListItem>> {
    const where = { ...baseWhere };

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
      items.map((item) => this.mapToListItem(item as unknown as ConfirmationWithRelations)),
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
    this.assertCanView(app as unknown as ConfirmationWithRelations, viewer);
    return this.mapToDetail(app as unknown as ConfirmationWithRelations, viewer);
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

    const pendingRole = this.determinePendingRole(app.status);
    if (!pendingRole) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不可审批',
      });
    }
    this.assertApprover(app as unknown as ConfirmationWithRelations, pendingRole, viewer);

    const now = new Date();
    const updateData: Prisma.ConfirmationApplicationUpdateInput = {};

    if (pendingRole === 'manager') {
      updateData.status = ConfirmationStatus.manager_approved;
      updateData.managerComment = dto.comment;
      updateData.managerApprovedAt = now;
    } else if (pendingRole === 'hr') {
      updateData.status = ConfirmationStatus.hr_approved;
      updateData.hrComment = dto.comment;
      updateData.hrApprovedAt = now;
    } else {
      updateData.status = ConfirmationStatus.approved;
      updateData.companyComment = dto.comment;
      updateData.companyApprovedAt = now;
      updateData.actualRegularDate = app.actualRegularDate ?? now;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.confirmationApplication.update({ where: { id }, data: updateData });
      if (pendingRole === 'company') {
        await tx.user.update({
          where: { id: app.employeeId },
          data: {
            actualRegularDate: app.actualRegularDate ?? now,
            status: UserStatus.active,
          },
        });
      }
    });

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

    const pendingRole = this.determinePendingRole(app.status);
    if (!pendingRole) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不可审批',
      });
    }
    this.assertApprover(app as unknown as ConfirmationWithRelations, pendingRole, viewer);

    await this.prisma.confirmationApplication.update({
      where: { id },
      data: {
        status: ConfirmationStatus.rejected,
        rejectedBy: { connect: { id: viewer.id } },
        rejectedAt: new Date(),
        rejectReason: dto.reason,
      },
    });

    return { id, status: ConfirmationStatus.rejected };
  }

  /** 预警：计划转正日期距今 ≤ 7 天且未提交/通过转正申请的试用期员工。 */
  async warnings(viewer: AuthUser): Promise<WarningItem[]> {
    this.assertHr(viewer);

    const deadline = new Date(Date.now() + 7 * DAY_MS);
    const probationUsers = await this.prisma.user.findMany({
      where: {
        status: UserStatus.probation,
        deletedAt: null,
        plannedRegularDate: { lte: deadline },
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

  private assertHr(viewer: AuthUser): void {
    if (viewer.sysRole !== SysRole.hr && viewer.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 可操作' });
    }
  }

  private assertCanView(app: ConfirmationWithRelations, viewer: AuthUser): void {
    if (
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
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该转正申请' });
  }

  private assertApprover(
    app: ConfirmationWithRelations,
    role: 'manager' | 'hr' | 'company',
    viewer: AuthUser,
  ): void {
    let expectedId: string;
    if (role === 'manager') expectedId = app.managerId;
    else if (role === 'hr') expectedId = app.hrId;
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
      employee: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
      hr: { select: { id: true, name: true } },
      companyApprover: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      probationReview: { select: { id: true } },
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

  private mapToListItem(app: ConfirmationWithRelations): ConfirmationListItem {
    return {
      id: app.id,
      status: app.status,
      employee: app.employee,
      manager: app.manager,
      hr: app.hr,
      companyApprover: app.companyApprover,
      voteResult: app.voteResult,
      voteMeetingTime: app.voteMeetingTime,
      actualRegularDate: app.actualRegularDate,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  private mapToDetail(app: ConfirmationWithRelations, viewer: AuthUser): ConfirmationDetail {
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
        approver: app.hr,
        comment: app.hrComment,
        actedAt: app.hrApprovedAt,
      },
      {
        role: 'company',
        status:
          app.status === ConfirmationStatus.rejected && pendingRole === 'company'
            ? 'rejected'
            : app.companyApprovedAt
              ? 'approved'
              : app.status === ConfirmationStatus.hr_approved || app.status === ConfirmationStatus.approved
                ? 'pending'
                : 'pending',
        approver: app.companyApprover,
        comment: app.companyComment,
        actedAt: app.companyApprovedAt,
      },
    ];

    if (app.status === ConfirmationStatus.rejected) {
      const rejectedStep = steps.find((s) => s.role === pendingRole);
      if (rejectedStep) {
        rejectedStep.status = 'rejected';
        rejectedStep.actedAt = app.rejectedAt;
      }
    }

    return {
      ...this.mapToListItem(app),
      probationReviewId: app.probationReviewId,
      summary: app.summary,
      salary: this.canViewSalary(app, viewer)
        ? app.salary
          ? (app.salary as unknown as { toNumber: () => number }).toNumber()
          : null
        : null,
      voteParticipants: app.voteParticipants as string[],
      voteComment: app.voteComment,
      rejectedBy: app.rejectedBy,
      rejectedAt: app.rejectedAt,
      rejectReason: app.rejectReason,
      steps,
      canApprove: pendingRole ? this.isPendingApprover(app, pendingRole, viewer) : false,
      canReject: pendingRole ? this.isPendingApprover(app, pendingRole, viewer) : false,
      pendingRole,
    };
  }

  private isPendingApprover(
    app: ConfirmationWithRelations,
    role: 'manager' | 'hr' | 'company',
    viewer: AuthUser,
  ): boolean {
    if (role === 'manager') return app.managerId === viewer.id;
    if (role === 'hr') return app.hrId === viewer.id;
    return app.companyApproverId === viewer.id;
  }
}

interface ConfirmationWithRelations {
  id: string;
  status: ConfirmationStatus;
  employeeId: string;
  managerId: string;
  hrId: string;
  companyApproverId: string;
  probationReviewId: string | null;
  summary: string | null;
  salary: Prisma.Decimal | null;
  voteResult: VoteResult | null;
  voteParticipants: Prisma.JsonValue;
  voteComment: string | null;
  voteMeetingTime: Date | null;
  actualRegularDate: Date | null;
  managerComment: string | null;
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
  employee: { id: string; name: string };
  manager: { id: string; name: string };
  hr: { id: string; name: string };
  companyApprover: { id: string; name: string };
  rejectedBy: { id: string; name: string } | null;
  creator: { id: string; name: string } | null;
  probationReview: { id: string } | null;
}
