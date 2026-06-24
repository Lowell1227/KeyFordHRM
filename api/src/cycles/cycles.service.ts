import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { PaginationDto, paginated } from '@/common/dto/pagination.dto';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateDeadlinesDto } from './dto/update-deadlines.dto';
import { CycleQueryDto } from './dto/cycle-query.dto';

const DEADLINE_FIELDS = [
  'deadlineIndicatorSetting',
  'deadlineIndicatorConfirm',
  'deadlineSelfEval',
  'deadlineManagerScore',
  'deadlineHrCalibration',
  'deadlineApproval',
  'deadlinePublish',
] as const;

type DeadlineField = (typeof DEADLINE_FIELDS)[number];

@Injectable()
export class CyclesService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /cycles — 创建考核周期。 */
  async create(dto: CreateCycleDto, user: AuthUser) {
    this.validateCycleDates(dto);

    const data: Prisma.AssessmentCycleCreateInput = {
      name: dto.name,
      type: dto.type,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: 'draft',
      creator: { connect: { id: user.id } },
      ...(dto.deadlineIndicatorSetting && { deadlineIndicatorSetting: dto.deadlineIndicatorSetting }),
      ...(dto.deadlineIndicatorConfirm && { deadlineIndicatorConfirm: dto.deadlineIndicatorConfirm }),
      ...(dto.deadlineSelfEval && { deadlineSelfEval: dto.deadlineSelfEval }),
      ...(dto.deadlineManagerScore && { deadlineManagerScore: dto.deadlineManagerScore }),
      ...(dto.deadlineHrCalibration && { deadlineHrCalibration: dto.deadlineHrCalibration }),
      ...(dto.deadlineApproval && { deadlineApproval: dto.deadlineApproval }),
      ...(dto.deadlinePublish && { deadlinePublish: dto.deadlinePublish }),
      ...(dto.publishVisibleFields && { publishVisibleFields: dto.publishVisibleFields }),
      ...(dto.gradeAMaxRatio !== undefined && { gradeAMaxRatio: new Prisma.Decimal(dto.gradeAMaxRatio) }),
      ...(dto.gradeBMaxRatio !== undefined && { gradeBMaxRatio: new Prisma.Decimal(dto.gradeBMaxRatio) }),
      ...(dto.gradeCMaxRatio !== undefined && { gradeCMaxRatio: new Prisma.Decimal(dto.gradeCMaxRatio) }),
      ...(dto.gradeDMaxRatio !== undefined && { gradeDMaxRatio: new Prisma.Decimal(dto.gradeDMaxRatio) }),
    };

    return this.prisma.assessmentCycle.create({ data });
  }

  /** GET /cycles — 查询周期列表。 */
  async findAll(query: CycleQueryDto) {
    const where: Prisma.AssessmentCycleWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.type && { type: query.type }),
      ...(query.keyword
        ? { name: { contains: query.keyword, mode: 'insensitive' } }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.assessmentCycle.count({ where }),
      this.prisma.assessmentCycle.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return paginated(items, total, query);
  }

  /** GET /cycles/:id — 周期详情。 */
  async findOne(id: string) {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }

    const [snapshotCount, totalTasks, exemptedTasks] = await Promise.all([
      this.prisma.assessmentTemplateSnapshot.count({ where: { cycleId: id } }),
      this.prisma.assessmentTask.count({ where: { cycleId: id } }),
      this.prisma.assessmentTask.count({ where: { cycleId: id, isExempt: true } }),
    ]);

    return {
      ...cycle,
      snapshotCount,
      taskStats: {
        total: totalTasks,
        exempted: exemptedTasks,
      },
    };
  }

  /** PATCH /cycles/:id/deadlines — 只能延期不能提前。 */
  async updateDeadlines(id: string, dto: UpdateDeadlinesDto) {
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id } });
    if (!cycle) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '考核周期不存在' });
    }

    this.validateDeadlinePostponement(cycle, dto);

    const data: Prisma.AssessmentCycleUpdateInput = {};
    for (const field of DEADLINE_FIELDS) {
      if (dto[field] !== undefined) {
        data[field] = dto[field];
      }
    }

    return this.prisma.assessmentCycle.update({ where: { id }, data });
  }

  /** 校验创建时的日期与截止日关系。 */
  private validateCycleDates(dto: CreateCycleDto): void {
    if (dto.endDate <= dto.startDate) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '结束日期必须晚于开始日期',
      });
    }

    const deadlines = DEADLINE_FIELDS.map((field) => dto[field])
      .filter((d): d is Date => d != null);

    for (const deadline of deadlines) {
      if (deadline < dto.startDate) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '各节点截止日不能早于周期开始日期',
        });
      }
    }

    this.assertNonDecreasing(deadlines, '各节点截止日需按流程顺序递增');
  }

  /** 校验延期：每个新截止日 ≥ 原值，且结果序列仍递增。 */
  private validateDeadlinePostponement(cycle: any, dto: UpdateDeadlinesDto): void {
    for (const field of DEADLINE_FIELDS) {
      const newValue = dto[field];
      const oldValue = cycle[field] as Date | null;
      if (newValue == null) continue;

      if (oldValue != null && newValue < oldValue) {
        throw new BadRequestException({
          code: ERROR_CODE.PARAM_INVALID,
          message: '节点截止日只能延期，不能提前',
        });
      }
    }

    const merged = DEADLINE_FIELDS.map((field) => dto[field] ?? cycle[field])
      .filter((d): d is Date => d != null);

    this.assertNonDecreasing(merged, '调整后各节点截止日需保持递增');
  }

  private assertNonDecreasing(dates: Date[], message: string): void {
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] < dates[i - 1]) {
        throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
      }
    }
  }
}
