import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Appeal, AppealResult, PerfGrade, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { CalibrationService } from '@/calibration/calibration.service';
import { paginated, Paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { ResolveAppealDto } from './dto/resolve-appeal.dto';

/** 列表项（不含 coefficient）。 */
export interface AppealListItem {
  id: string;
  taskId: string;
  cycleId: string;
  status: string;
  reason: string;
  finalResult: string | null;
  hrResolution: string | null;
  createdAt: Date;
  hrResolvedAt: Date | null;
  appellant: { id: string; name: string } | null;
  dept: { id: string; name: string | null } | null;
  cycle: { id: string; name: string } | null;
}

/** 详情（不含 coefficient）。 */
export interface AppealDetail {
  id: string;
  taskId: string;
  cycleId: string;
  appellantId: string;
  reason: string;
  attachments: Prisma.JsonValue;
  status: string;
  deptResolution: string | null;
  deptResolvedAt: Date | null;
  deptResolverId: string | null;
  hrResolution: string | null;
  hrResolvedAt: Date | null;
  hrResolverId: string | null;
  finalResult: string | null;
  appealDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
  appellant: { id: string; name: string } | null;
  dept: { id: string; name: string | null } | null;
  cycle: { id: string; name: string } | null;
  taskGrade: {
    calculatedScore: number | null;
    rawGrade: string | null;
    calibratedGrade: string | null;
  } | null;
}

/** 查询参数。 */
export interface AppealQuery {
  cycleId?: string;
  status?: 'pending' | 'resolved';
  deptId?: string;
  keyword?: string;
}

@Injectable()
export class AppealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibrationService: CalibrationService,
  ) {}

  /** POST /appeals — HR 录入申诉记录。 */
  async create(dto: CreateAppealDto, viewer: AuthUser): Promise<Appeal> {
    const task = await this.prisma.assessmentTask.findUnique({
      where: { id: dto.taskId },
      include: {
        employee: { select: { id: true } },
        cycle: { select: { id: true, deadlineAppeal: true } },
        gradeResult: { select: { id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '任务不存在',
      });
    }

    if (!task.gradeResult) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '该任务尚未评分，无法录入申诉',
      });
    }

    const pendingExists = await this.prisma.appeal.count({
      where: { taskId: task.id, status: 'pending' },
    });
    if (pendingExists > 0) {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '该任务已存在未处理的申诉',
      });
    }

    const appeal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appeal.create({
        data: {
          taskId: task.id,
          cycleId: task.cycleId,
          appellantId: task.employeeId,
          reason: dto.reason,
          attachments: (dto.attachments ?? []) as Prisma.InputJsonValue,
          status: 'pending',
          appealDeadline: task.cycle.deadlineAppeal ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'create_appeal',
          entityType: 'appeal',
          entityId: created.id,
          newValue: {
            taskId: created.taskId,
            reason: created.reason,
            attachments: created.attachments,
            appellantId: created.appellantId,
          },
        },
      });

      return created;
    });

    return appeal;
  }

  /** GET /appeals — 列表。 */
  async findAll(query: AppealQuery, pagination: PaginationDto): Promise<Paginated<AppealListItem>> {
    const where: Prisma.AppealWhereInput = {};

    if (query.cycleId) {
      where.cycleId = query.cycleId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.deptId) {
      where.task = { deptId: query.deptId };
    }

    if (query.keyword?.trim()) {
      where.appellant = { name: { contains: query.keyword.trim(), mode: 'insensitive' } };
    }

    const [total, appeals] = await Promise.all([
      this.prisma.appeal.count({ where }),
      this.prisma.appeal.findMany({
        where,
        include: {
          appellant: { select: { id: true, name: true } },
          task: {
            select: {
              dept: { select: { id: true, name: true } },
            },
          },
          cycle: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginated(
      appeals.map((a) => this.mapToListItem(a)),
      total,
      pagination,
    );
  }

  /** GET /appeals/:id — 详情。 */
  async findOne(id: string): Promise<AppealDetail> {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id },
      include: {
        appellant: { select: { id: true, name: true } },
        task: {
          select: {
            dept: { select: { id: true, name: true } },
            gradeResult: {
              select: {
                calculatedScore: true,
                rawGrade: true,
                calibratedGrade: true,
              },
            },
          },
        },
        cycle: { select: { id: true, name: true } },
      },
    });

    if (!appeal) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '申诉记录不存在',
      });
    }

    return this.mapToDetail(appeal);
  }

  /** POST /appeals/:id/resolve — HR 录入处理结论。 */
  async resolve(id: string, dto: ResolveAppealDto, viewer: AuthUser): Promise<AppealDetail> {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            gradeResult: true,
            employee: { select: { id: true, name: true } },
            dept: { select: { id: true, name: true } },
          },
        },
        cycle: { select: { id: true, name: true } },
      },
    });

    if (!appeal) {
      throw new NotFoundException({
        code: ERROR_CODE.NOT_FOUND,
        message: '申诉记录不存在',
      });
    }

    if (appeal.status !== 'pending') {
      throw new ConflictException({
        code: ERROR_CODE.CONFLICT,
        message: '该申诉已处理，不可重复 resolve',
      });
    }

    if (dto.result === 'modified' && !dto.newGrade) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '改判时必须提供 newGrade',
      });
    }

    const gradeResult = appeal.task.gradeResult;
    if (!gradeResult) {
      // 录入时已经校验过，防御性兜底
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '该任务尚未评分，无法处理申诉',
      });
    }

    const oldCalibratedGrade = gradeResult.calibratedGrade;
    const coefficients = await this.calibrationService.loadGradeCoefficients();

    const resolved = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      if (dto.result === 'modified') {
        const newGrade = dto.newGrade as PerfGrade;
        const newCoefficient = coefficients[newGrade] ?? 1;

        await tx.gradeResult.update({
          where: { taskId: appeal.taskId },
          data: {
            calibratedGrade: newGrade,
            calibrationNote: dto.newGradeNote ?? gradeResult.calibrationNote,
            coefficient: new Prisma.Decimal(newCoefficient),
          },
        });

        // 若已归档则同步更新
        const existingArchive = await tx.performanceArchive.findUnique({
          where: {
            employeeId_cycleId: {
              employeeId: appeal.task.employeeId,
              cycleId: appeal.cycleId,
            },
          },
        });

        if (existingArchive) {
          await tx.performanceArchive.update({
            where: { id: existingArchive.id },
            data: {
              grade: newGrade,
              coefficient: new Prisma.Decimal(newCoefficient),
            },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: viewer.id,
            action: 'resolve_appeal',
            entityType: 'appeal',
            entityId: appeal.id,
            oldValue: {
              calibratedGrade: oldCalibratedGrade,
              coefficient: gradeResult.coefficient?.toNumber() ?? null,
            },
            newValue: {
              calibratedGrade: newGrade,
              coefficient: newCoefficient,
              resolution: dto.resolution,
            },
          },
        });
      } else {
        await tx.auditLog.create({
          data: {
            userId: viewer.id,
            action: 'resolve_appeal',
            entityType: 'appeal',
            entityId: appeal.id,
            newValue: {
              result: 'maintained',
              resolution: dto.resolution,
            },
          },
        });
      }

      const updated = await tx.appeal.update({
        where: { id: appeal.id },
        data: {
          hrResolution: dto.resolution,
          hrResolvedAt: now,
          hrResolverId: viewer.id,
          finalResult: dto.result,
          status: 'resolved',
        },
        include: {
          appellant: { select: { id: true, name: true } },
          task: {
            select: {
              dept: { select: { id: true, name: true } },
              gradeResult: {
                select: {
                  calculatedScore: true,
                  rawGrade: true,
                  calibratedGrade: true,
                },
              },
            },
          },
          cycle: { select: { id: true, name: true } },
        },
      });

      return updated;
    });

    return this.mapToDetail(resolved);
  }

  private mapToListItem(
    appeal: Prisma.AppealGetPayload<{
      include: {
        appellant: { select: { id: true; name: true } };
        task: { select: { dept: { select: { id: true; name: true } } } };
        cycle: { select: { id: true; name: true } };
      };
    }>,
  ): AppealListItem {
    return {
      id: appeal.id,
      taskId: appeal.taskId,
      cycleId: appeal.cycleId,
      status: appeal.status,
      reason: appeal.reason,
      finalResult: appeal.finalResult,
      hrResolution: appeal.hrResolution,
      createdAt: appeal.createdAt,
      hrResolvedAt: appeal.hrResolvedAt,
      appellant: appeal.appellant,
      dept: appeal.task?.dept ?? null,
      cycle: appeal.cycle,
    };
  }

  private mapToDetail(
    appeal: Prisma.AppealGetPayload<{
      include: {
        appellant: { select: { id: true; name: true } };
        task: {
          select: {
            dept: { select: { id: true; name: true } };
            gradeResult: {
              select: {
                calculatedScore: true;
                rawGrade: true;
                calibratedGrade: true;
              };
            };
          };
        };
        cycle: { select: { id: true; name: true } };
      };
    }>,
  ): AppealDetail {
    return {
      id: appeal.id,
      taskId: appeal.taskId,
      cycleId: appeal.cycleId,
      appellantId: appeal.appellantId,
      reason: appeal.reason,
      attachments: appeal.attachments,
      status: appeal.status,
      deptResolution: appeal.deptResolution,
      deptResolvedAt: appeal.deptResolvedAt,
      deptResolverId: appeal.deptResolverId,
      hrResolution: appeal.hrResolution,
      hrResolvedAt: appeal.hrResolvedAt,
      hrResolverId: appeal.hrResolverId,
      finalResult: appeal.finalResult,
      appealDeadline: appeal.appealDeadline,
      createdAt: appeal.createdAt,
      updatedAt: appeal.updatedAt,
      appellant: appeal.appellant,
      dept: appeal.task?.dept ?? null,
      cycle: appeal.cycle,
      taskGrade: appeal.task?.gradeResult
        ? {
            calculatedScore: appeal.task.gradeResult.calculatedScore?.toNumber() ?? null,
            rawGrade: appeal.task.gradeResult.rawGrade,
            calibratedGrade: appeal.task.gradeResult.calibratedGrade,
          }
        : null,
    };
  }
}
