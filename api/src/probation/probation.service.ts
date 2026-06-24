import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProbationIndicatorType,
  ProbationReviewStatus,
  SignatureBusinessType,
  SignatureRole,
  SysRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { Paginated, paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { CreateProbationReviewDto } from './dto/create-probation-review.dto';
import { UpdateProbationReviewDto } from './dto/update-probation-review.dto';
import { SubmitSelfEvalDto } from './dto/submit-self-eval.dto';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';
import { ProbationReviewQueryDto } from './dto/probation-review-query.dto';

/** 列表项视图。 */
export interface ProbationReviewListItem {
  id: string;
  status: ProbationReviewStatus;
  plannedRegularDate: Date | null;
  employee: { id: string; name: string };
  manager: { id: string; name: string };
  hr: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

/** 详情视图。 */
export interface ProbationReviewDetail extends ProbationReviewListItem {
  strengths: string | null;
  improvements: string | null;
  employeeSignedAt: Date | null;
  managerSignedAt: Date | null;
  hrSignedAt: Date | null;
  completedAt: Date | null;
  indicators: ProbationIndicatorItem[];
  signatures: SignatureItem[];
}

export interface ProbationIndicatorItem {
  id: string;
  name: string;
  type: ProbationIndicatorType;
  weight: number;
  description: string | null;
  targetValue: string | null;
  selfScore: number | null;
  selfComment: string | null;
  managerScore: number | null;
  managerComment: string | null;
  sortOrder: number;
}

interface SignatureItem {
  id: string;
  role: SignatureRole;
  signerId: string;
  signerName: string;
  signedAt: Date;
  method: string;
}

const WEIGHT_TOLERANCE = 0.001;

@Injectable()
export class ProbationService {
  constructor(private readonly prisma: PrismaService) {}

  /** HR 发起试用期考核。 */
  async create(dto: CreateProbationReviewDto, viewer: AuthUser): Promise<ProbationReviewDetail> {
    this.assertHr(viewer);

    const employee = await this.prisma.user.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, name: true, status: true, isAssessorOnly: true, deletedAt: true },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '员工不存在' });
    }
    if (employee.status !== UserStatus.probation) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅试用期员工可发起试用期考核',
      });
    }
    if (employee.isAssessorOnly) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '仅评委身份的员工不能发起试用期考核',
      });
    }

    const manager = await this.prisma.user.findUnique({
      where: { id: dto.managerId },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!manager || manager.deletedAt) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '主管不存在' });
    }

    if (dto.indicators?.length) {
      this.assertIndicatorWeights(dto.indicators);
    }

    const status = dto.indicators?.length ? ProbationReviewStatus.self_eval : ProbationReviewStatus.indicator_setting;

    const review = await this.prisma.probationReview.create({
      data: {
        employee: { connect: { id: dto.employeeId } },
        manager: { connect: { id: dto.managerId } },
        hr: { connect: { id: viewer.id } },
        creator: { connect: { id: viewer.id } },
        plannedRegularDate: dto.plannedRegularDate,
        status,
        indicators: dto.indicators?.length
          ? {
              create: dto.indicators.map((ind, idx) => ({
                name: ind.name,
                type: ind.type,
                weight: new Prisma.Decimal(ind.weight),
                description: ind.description,
                targetValue: ind.targetValue,
                sortOrder: ind.sortOrder ?? idx,
              })),
            }
          : undefined,
      },
      include: this.detailInclude(),
    });

    return this.mapToDetail(review);
  }

  /** HR 管理列表。 */
  async findAll(dto: ProbationReviewQueryDto, viewer: AuthUser): Promise<Paginated<ProbationReviewListItem>> {
    this.assertHr(viewer);
    return this.findMany(dto, {});
  }

  /** 主管查看自己管理的试用期考核。 */
  async findManaged(dto: ProbationReviewQueryDto, viewer: AuthUser): Promise<Paginated<ProbationReviewListItem>> {
    return this.findMany(dto, { managerId: viewer.id });
  }

  /** 员工查看自己的试用期考核。 */
  async findMine(dto: ProbationReviewQueryDto, viewer: AuthUser): Promise<Paginated<ProbationReviewListItem>> {
    return this.findMany(dto, { employeeId: viewer.id });
  }

  private async findMany(
    dto: ProbationReviewQueryDto,
    baseWhere: Prisma.ProbationReviewWhereInput,
  ): Promise<Paginated<ProbationReviewListItem>> {
    const where: Prisma.ProbationReviewWhereInput = { ...baseWhere };

    if (dto.employeeId) where.employeeId = dto.employeeId;
    if (dto.managerId) where.managerId = dto.managerId;
    if (dto.status) where.status = dto.status;
    if (dto.keyword) {
      where.OR = [
        { employee: { name: { contains: dto.keyword, mode: 'insensitive' as const } } },
        { manager: { name: { contains: dto.keyword, mode: 'insensitive' as const } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.probationReview.count({ where }),
      this.prisma.probationReview.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
          hr: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
    ]);

    return paginated(
      items.map((r) => this.mapToListItem(r as unknown as ProbationReviewWithRelations)),
      total,
      dto,
    );
  }

  /** 详情。 */
  async findOne(id: string, viewer: AuthUser): Promise<ProbationReviewDetail> {
    const review = await this.prisma.probationReview.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!review) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
    }

    this.assertCanView(review, viewer);
    return this.mapToDetail(review as unknown as ProbationReviewWithRelations);
  }

  /** HR 更新基础信息与指标。 */
  async update(id: string, dto: UpdateProbationReviewDto, viewer: AuthUser): Promise<ProbationReviewDetail> {
    this.assertHr(viewer);

    const review = await this.prisma.probationReview.findUnique({
      where: { id },
      include: { indicators: true },
    });
    if (!review) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
    }
    if (review.status === ProbationReviewStatus.closed) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '已结束的试用期考核不可修改',
      });
    }

    const data: Prisma.ProbationReviewUpdateInput = {};
    if (dto.managerId !== undefined) data.manager = { connect: { id: dto.managerId } };
    if (dto.plannedRegularDate !== undefined) data.plannedRegularDate = dto.plannedRegularDate;

    if (dto.indicators?.length) {
      if (
        review.status !== ProbationReviewStatus.indicator_setting &&
        review.status !== ProbationReviewStatus.self_eval
      ) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '当前状态不可修改考核指标',
        });
      }

      const merged = this.mergeIndicators(
        review.indicators.map((i) => ({
          id: i.id,
          name: i.name,
          type: i.type,
          weight: i.weight.toNumber(),
          description: i.description,
          targetValue: i.targetValue,
          sortOrder: i.sortOrder,
        })),
        dto.indicators,
      );
      this.assertIndicatorWeights(merged);

      await this.prisma.probationReviewIndicator.deleteMany({ where: { probationReviewId: id } });
      await this.prisma.probationReviewIndicator.createMany({
        data: merged.map((ind, idx) => ({
          probationReviewId: id,
          name: ind.name,
          type: ind.type,
          weight: new Prisma.Decimal(ind.weight),
          description: ind.description,
          targetValue: ind.targetValue,
          sortOrder: ind.sortOrder ?? idx,
        })),
      });
    }

    const updated = await this.prisma.probationReview.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });

    return this.mapToDetail(updated as unknown as ProbationReviewWithRelations);
  }

  /** 员工提交自评。 */
  async submitSelfEval(id: string, dto: SubmitSelfEvalDto, viewer: AuthUser): Promise<{ id: string; status: ProbationReviewStatus }> {
    const review = await this.prisma.probationReview.findUnique({
      where: { id },
      include: { indicators: true },
    });
    if (!review) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
    }
    this.assertEmployee(review, viewer);

    if (review.status !== ProbationReviewStatus.self_eval) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不可提交自评',
      });
    }

    const indicatorMap = new Map(review.indicators.map((i) => [i.id, i]));
    for (const item of dto.indicators) {
      if (!indicatorMap.has(item.id)) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `指标 ${item.id} 不存在`,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.indicators) {
        await tx.probationReviewIndicator.update({
          where: { id: item.id },
          data: {
            selfScore: new Prisma.Decimal(item.selfScore),
            selfComment: item.selfComment,
          },
        });
      }

      await tx.probationReview.update({
        where: { id },
        data: { status: ProbationReviewStatus.manager_scoring },
      });
    });

    return { id, status: ProbationReviewStatus.manager_scoring };
  }

  /** 主管提交评分与优势/待改进。 */
  async submitManagerScore(
    id: string,
    dto: SubmitManagerScoreDto,
    viewer: AuthUser,
  ): Promise<{ id: string; status: ProbationReviewStatus }> {
    const review = await this.prisma.probationReview.findUnique({
      where: { id },
      include: { indicators: true },
    });
    if (!review) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
    }
    this.assertManager(review, viewer);

    if (review.status !== ProbationReviewStatus.manager_scoring) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '当前状态不可提交主管评分',
      });
    }

    const indicatorMap = new Map(review.indicators.map((i) => [i.id, i]));
    for (const item of dto.indicators) {
      if (!indicatorMap.has(item.id)) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: `指标 ${item.id} 不存在`,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.indicators) {
        await tx.probationReviewIndicator.update({
          where: { id: item.id },
          data: {
            managerScore: new Prisma.Decimal(item.managerScore),
            managerComment: item.managerComment,
          },
        });
      }

      await tx.probationReview.update({
        where: { id },
        data: {
          strengths: dto.strengths,
          improvements: dto.improvements,
        },
      });
    });

    return { id, status: ProbationReviewStatus.manager_scoring };
  }

  /** HR 关闭考核（需三方签字齐全）。 */
  async close(id: string, viewer: AuthUser): Promise<{ id: string; status: ProbationReviewStatus }> {
    this.assertHr(viewer);

    const review = await this.prisma.probationReview.findUnique({
      where: { id },
      include: { indicators: true },
    });
    if (!review) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '试用期考核不存在' });
    }
    if (review.status === ProbationReviewStatus.closed) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '试用期考核已结束',
      });
    }

    const signatures = await this.prisma.signature.findMany({
      where: {
        businessType: SignatureBusinessType.probation_task,
        businessRecordId: id,
      },
    });
    const roles = new Set(signatures.map((s) => s.role));
    if (!roles.has(SignatureRole.assessee) || !roles.has(SignatureRole.assessor) || !roles.has(SignatureRole.hr)) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '三方签字尚未齐全，无法结束考核',
      });
    }

    await this.prisma.probationReview.update({
      where: { id },
      data: {
        status: ProbationReviewStatus.closed,
        completedAt: new Date(),
        employeeSignedAt: signatures.find((s) => s.role === SignatureRole.assessee)?.signedAt ?? null,
        managerSignedAt: signatures.find((s) => s.role === SignatureRole.assessor)?.signedAt ?? null,
        hrSignedAt: signatures.find((s) => s.role === SignatureRole.hr)?.signedAt ?? null,
      },
    });

    return { id, status: ProbationReviewStatus.closed };
  }

  // ---------------------------------------------------------------------------
  // 权限断言
  // ---------------------------------------------------------------------------

  private assertHr(viewer: AuthUser): void {
    if (viewer.sysRole !== SysRole.hr && viewer.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 可操作' });
    }
  }

  private assertEmployee(review: { employeeId: string }, viewer: AuthUser): void {
    if (review.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅被考核员工本人可操作' });
    }
  }

  private assertManager(review: { managerId: string }, viewer: AuthUser): void {
    if (review.managerId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅指定主管可操作' });
    }
  }

  private assertCanView(
    review: { employeeId: string; managerId: string; hrId: string },
    viewer: AuthUser,
  ): void {
    if (
      review.employeeId === viewer.id ||
      review.managerId === viewer.id ||
      review.hrId === viewer.id ||
      viewer.sysRole === SysRole.hr ||
      viewer.sysRole === SysRole.system_admin ||
      viewer.canViewAll
    ) {
      return;
    }
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该试用期考核' });
  }

  // ---------------------------------------------------------------------------
  // 校验 helpers
  // ---------------------------------------------------------------------------

  private assertIndicatorWeights(
    indicators: Array<{ type: ProbationIndicatorType; weight: number }>,
  ): void {
    const sums = indicators.reduce(
      (acc, cur) => {
        acc[cur.type] = (acc[cur.type] ?? 0) + cur.weight;
        return acc;
      },
      {} as Record<ProbationIndicatorType, number>,
    );

    const workSum = sums[ProbationIndicatorType.work_objective] ?? 0;
    const valuesSum = sums[ProbationIndicatorType.values] ?? 0;

    if (Math.abs(workSum - 0.8) > WEIGHT_TOLERANCE) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: `工作目标指标权重之和须为 80%，当前 ${(workSum * 100).toFixed(1)}%`,
      });
    }
    if (Math.abs(valuesSum - 0.2) > WEIGHT_TOLERANCE) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: `价值观指标权重之和须为 20%，当前 ${(valuesSum * 100).toFixed(1)}%`,
      });
    }
  }

  private mergeIndicators(
    existing: Array<{
      id: string;
      name: string;
      type: ProbationIndicatorType;
      weight: number;
      description: string | null;
      targetValue: string | null;
      sortOrder: number;
    }>,
    updates: UpdateProbationReviewDto['indicators'],
  ): Array<{
    name: string;
    type: ProbationIndicatorType;
    weight: number;
    description?: string;
    targetValue?: string;
    sortOrder: number;
  }> {
    if (!updates?.length) return [];

    return updates.map((u, idx) => {
      if (u.id) {
        const old = existing.find((e) => e.id === u.id);
        if (!old) {
          throw new BadRequestException({
            code: ERROR_CODE.PARAM_INVALID,
            message: `指标 ${u.id} 不存在`,
          });
        }
      }
      return {
        name: u.name ?? existing.find((e) => e.id === u.id)?.name ?? '',
        type: u.type ?? existing.find((e) => e.id === u.id)?.type ?? ProbationIndicatorType.work_objective,
        weight: u.weight ?? existing.find((e) => e.id === u.id)?.weight ?? 0,
        description: u.description ?? existing.find((e) => e.id === u.id)?.description ?? undefined,
        targetValue: u.targetValue ?? existing.find((e) => e.id === u.id)?.targetValue ?? undefined,
        sortOrder: u.sortOrder ?? existing.find((e) => e.id === u.id)?.sortOrder ?? idx,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Prisma include / mapping
  // ---------------------------------------------------------------------------

  private detailInclude(): Prisma.ProbationReviewInclude {
    return {
      employee: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
      hr: { select: { id: true, name: true } },
      indicators: { orderBy: { sortOrder: 'asc' } },
    };
  }

  private mapToListItem(review: ProbationReviewWithRelations): ProbationReviewListItem {
    return {
      id: review.id,
      status: review.status,
      plannedRegularDate: review.plannedRegularDate,
      employee: review.employee,
      manager: review.manager,
      hr: review.hr,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private async mapToDetail(review: ProbationReviewWithRelations): Promise<ProbationReviewDetail> {
    const signatures = await this.prisma.signature.findMany({
      where: {
        businessType: SignatureBusinessType.probation_task,
        businessRecordId: review.id,
      },
      include: { signer: { select: { id: true, name: true } } },
      orderBy: { signedAt: 'asc' },
    });

    return {
      ...this.mapToListItem(review),
      strengths: review.strengths,
      improvements: review.improvements,
      employeeSignedAt: review.employeeSignedAt,
      managerSignedAt: review.managerSignedAt,
      hrSignedAt: review.hrSignedAt,
      completedAt: review.completedAt,
      indicators: review.indicators.map((ind) => ({
        id: ind.id,
        name: ind.name,
        type: ind.type,
        weight: (ind.weight as unknown as { toNumber: () => number }).toNumber(),
        description: ind.description,
        targetValue: ind.targetValue,
        selfScore: ind.selfScore ? (ind.selfScore as unknown as { toNumber: () => number }).toNumber() : null,
        selfComment: ind.selfComment,
        managerScore: ind.managerScore ? (ind.managerScore as unknown as { toNumber: () => number }).toNumber() : null,
        managerComment: ind.managerComment,
        sortOrder: ind.sortOrder,
      })),
      signatures: signatures.map((s) => ({
        id: s.id,
        role: s.role,
        signerId: s.signerId,
        signerName: s.signer.name,
        signedAt: s.signedAt,
        method: s.method,
      })),
    };
  }
}

/** Prisma 返回的原始详情类型（用于内部转换）。 */
interface ProbationReviewWithRelations {
  id: string;
  status: ProbationReviewStatus;
  plannedRegularDate: Date | null;
  strengths: string | null;
  improvements: string | null;
  employeeSignedAt: Date | null;
  managerSignedAt: Date | null;
  hrSignedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employee: { id: string; name: string };
  manager: { id: string; name: string };
  hr: { id: string; name: string };
  indicators: Array<{
    id: string;
    name: string;
    type: ProbationIndicatorType;
    weight: Prisma.Decimal;
    description: string | null;
    targetValue: string | null;
    selfScore: Prisma.Decimal | null;
    selfComment: string | null;
    managerScore: Prisma.Decimal | null;
    managerComment: string | null;
    sortOrder: number;
  }>;
}
