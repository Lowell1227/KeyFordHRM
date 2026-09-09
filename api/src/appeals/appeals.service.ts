import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { FlowService } from '@/tasks/flow.service';
import { isResultPublished, PUBLISHED_RESULT_WHERE } from '@/tasks/result-publication';
import { mapReviewHistory, REVIEW_HISTORY_NODES } from '@/tasks/review-history';

/** 列表项（不含 coefficient）。 */
export interface AppealWorkflowMetadata {
  workflowType: 'prepublication' | 'legacy';
  taskStatus: string;
  approvedAt: Date | null;
  employeeConfirmedAt: Date | null;
  publishedAt: Date | null;
  canResolve: boolean;
}

export interface AppealListItem extends AppealWorkflowMetadata {
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
export interface AppealDetail extends AppealWorkflowMetadata {
  originalResult: Prisma.JsonValue | null;
  flowRecords: ReturnType<typeof mapReviewHistory>;
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

const appealTaskSelect = {
  status: true, approvedAt: true, employeeConfirmedAt: true, publishedAt: true,
  flowRecords: { where: { nodeType: { in: REVIEW_HISTORY_NODES } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { actor: { select: { name: true } } } },
} satisfies Prisma.AssessmentTaskSelect;
type AppealWithTask = Appeal & {
  appellant: { id: string; name: string } | null;
  cycle: { id: string; name: string } | null;
  task: {
    status?: string; approvedAt?: Date | null; employeeConfirmedAt?: Date | null; publishedAt?: Date | null;
    dept: { id: string; name: string | null } | null;
    flowRecords?: Parameters<typeof mapReviewHistory>[0];
    gradeResult?: { calculatedScore: Prisma.Decimal | null; rawGrade: string | null; calibratedGrade: string | null } | null;
  } | null;
};

@Injectable()
export class AppealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibrationService: CalibrationService,
    private readonly flowService: FlowService,
  ) {}

  /** POST /appeals — HR 录入申诉记录。 */
  async create(dto: CreateAppealDto, viewer: AuthUser): Promise<Appeal> {
    if (!['hr', 'system_admin'].includes(viewer.sysRole)) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 可录入申诉' });
    }
    if (!dto.reason.trim()) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '请填写申诉事由' });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "assessment_tasks" WHERE "id" = ${dto.taskId}::uuid FOR NO KEY UPDATE`;
      const task = await tx.assessmentTask.findUnique({ where: { id: dto.taskId }, include: { gradeResult: true } });
      if (!task) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '任务不存在' });
      if (!task.gradeResult) throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: '该任务尚未评分，无法录入申诉' });
      if (task.isExempt || !['approval', 'confirmed'].includes(task.status) || !task.approvedAt || !task.gradeResult.approvedAt
        || isResultPublished(task) || !task.managerId) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '仅已审批、未公示且有绩效直属上级的任务可录入申诉' });
      }
      if (await tx.appeal.count({ where: { taskId: task.id, status: 'pending' } })) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该任务已存在未处理的申诉' });
      }
      const created = await tx.appeal.create({ data: {
        taskId: task.id, cycleId: task.cycleId, appellantId: task.employeeId,
        reason: dto.reason.trim(), attachments: (dto.attachments ?? []) as Prisma.InputJsonValue,
        status: 'pending', appealDeadline: null,
      } });
      const originalResult = JSON.parse(JSON.stringify({
        calculatedScore: task.gradeResult.calculatedScore, rawGrade: task.gradeResult.rawGrade,
        calibratedGrade: task.gradeResult.calibratedGrade, calibrationNote: task.gradeResult.calibrationNote,
        isVeto: task.gradeResult.isVeto, vetoReason: task.gradeResult.vetoReason,
        approvedAt: task.approvedAt, employeeConfirmedAt: task.employeeConfirmedAt,
        managerScoredAt: task.managerScoredAt, deptReviewedAt: task.deptReviewedAt, hrCalibratedAt: task.hrCalibratedAt,
      })) as Prisma.InputJsonObject;
      await this.flowService.transitionTx(tx, {
        task, action: 'reject', targetStatus: 'manager_scoring', actorId: viewer.id, comment: dto.reason.trim(),
        extraData: { type: 'prepublication_appeal', appealId: created.id, originalResult },
        taskUpdate: { approvedAt: null, employeeConfirmedAt: null, managerScoredAt: null, deptReviewedAt: null, hrCalibratedAt: null },
      });
      await tx.gradeResult.update({ where: { taskId: task.id }, data: {
        approvedAt: null, approverId: null, employeeConfirmedAt: null, hrCalibratedAt: null, hrCalibratorId: null,
        calibratedGrade: null, calibrationNote: null, coefficient: null,
        isVeto: false, vetoReason: null, vetoOperatorId: null,
      } });
      await tx.auditLog.create({ data: {
        userId: viewer.id, action: 'create_appeal', entityType: 'appeal', entityId: created.id,
        newValue: { taskId: created.taskId, reason: created.reason, appellantId: created.appellantId, workflowType: 'prepublication' },
      } });
      await tx.notificationLog.create({ data: {
        userId: task.managerId, senderId: viewer.id, taskId: task.id, cycleId: task.cycleId,
        type: 'prepublication_appeal', title: '绩效结果需要重新评定', content: 'HR 已录入员工线下反馈，请查看申诉事由并重新评定周期结果。',
        channel: 'system', status: 'sent', sentAt: new Date(),
      } });
      return created;
    });
  }

  async findCandidates(query: AppealQuery, pagination: PaginationDto) {
    const keyword = query.keyword?.trim();
    const where: Prisma.AssessmentTaskWhereInput = {
      isExempt: false, status: { in: ['approval', 'confirmed'] }, approvedAt: { not: null },
      managerId: { not: null }, gradeResult: { is: { approvedAt: { not: null } } },
      NOT: PUBLISHED_RESULT_WHERE, appeals: { none: { status: 'pending' } },
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(keyword ? { employee: { OR: [{ name: { contains: keyword, mode: 'insensitive' } }, { employeeNo: { contains: keyword, mode: 'insensitive' } }] } } : {}),
    };
    const [total, tasks] = await Promise.all([
      this.prisma.assessmentTask.count({ where }),
      this.prisma.assessmentTask.findMany({ where, skip: pagination.skip, take: pagination.take,
        include: { employee: { select: { name: true, employeeNo: true } }, dept: { select: { name: true } }, cycle: { select: { name: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    return paginated(tasks.map(task => ({ id: task.id, employeeName: task.employee.name, employeeNo: task.employee.employeeNo,
      deptName: task.dept?.name ?? null, cycleName: task.cycle.name, status: task.status, approvedAt: task.approvedAt })), total, pagination);
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
              ...appealTaskSelect,
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
            ...appealTaskSelect,
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
            flowRecords: appealTaskSelect.flowRecords,
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

    const prepublication = await this.prisma.flowRecord.findFirst({ where: {
      taskId: appeal.taskId, nodeType: 'appeal',
      AND: [{ extraData: { path: ['type'], equals: 'prepublication_appeal' } }, { extraData: { path: ['appealId'], equals: appeal.id } }],
    } });
    if (prepublication) throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该申诉需沿原评定审批流程办理，不可直接改判' });

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
              ...appealTaskSelect,
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

  private appealRecord(appeal: AppealWithTask): Prisma.JsonObject | null {
    const record = appeal.task?.flowRecords?.find(record => {
      const data = record.extraData as Prisma.JsonObject | null;
      return data?.type === 'prepublication_appeal' && data.appealId === appeal.id;
    });
    return record?.extraData as Prisma.JsonObject | null ?? null;
  }

  private workflowMetadata(appeal: AppealWithTask): AppealWorkflowMetadata {
    const prepublication = Boolean(this.appealRecord(appeal));
    return { workflowType: prepublication ? 'prepublication' : 'legacy',
      taskStatus: appeal.task?.status ?? '', approvedAt: appeal.task?.approvedAt ?? null,
      employeeConfirmedAt: appeal.task?.employeeConfirmedAt ?? null, publishedAt: appeal.task?.publishedAt ?? null,
      canResolve: !prepublication && appeal.status === 'pending' };
  }

  private mapToListItem(appeal: AppealWithTask): AppealListItem {
    return {
      ...this.workflowMetadata(appeal),
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

  private mapToDetail(appeal: AppealWithTask): AppealDetail {
    return {
      ...this.workflowMetadata(appeal),
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
      originalResult: this.appealRecord(appeal)?.originalResult ?? null,
      flowRecords: mapReviewHistory(appeal.task?.flowRecords),
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
