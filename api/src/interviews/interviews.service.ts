import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InterviewStatus,
  PerformanceInterview,
  Prisma,
  SignatureBusinessType,
  SignatureMethod,
  SignatureRole,
  SysRole,
  TaskStatus,
} from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';
import { Paginated, paginated, PaginationDto } from '@/common/dto/pagination.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';

/** 面谈记录列表项。 */
export interface InterviewListItem {
  id: string;
  taskId: string;
  cycleId: string;
  cycleName: string | null;
  employeeId: string;
  employeeName: string;
  position: string | null;
  deptId: string | null;
  deptName: string | null;
  status: InterviewStatus;
  deadline: Date | null;
  method: string | null;
  scoreInformed: boolean;
  managerSignedAt: Date | null;
  employeeSignedAt: Date | null;
  updatedAt: Date;
}

/** 面谈记录详情。 */
export interface InterviewDetail extends PerformanceInterview {
  employeeName: string | null;
  deptName: string | null;
  interviewerName: string | null;
}

const POST_PUBLISH_STATUSES: TaskStatus[] = ['published', 'confirmed', 'appealing', 'closed'];

@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /interviews — 主管面谈列表。 */
  async findAll(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<InterviewListItem>> {
    const where: Prisma.PerformanceInterviewWhereInput = {};
    if (!this.canViewAll(viewer)) {
      where.interviewerId = viewer.id;
    }

    const [total, items] = await Promise.all([
      this.prisma.performanceInterview.count({ where }),
      this.prisma.performanceInterview.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        include: {
          task: {
            include: {
              employee: { select: { name: true, position: true } },
              dept: { select: { name: true } },
              cycle: { select: { name: true } },
            },
          },
        },
        orderBy: { deadline: 'asc' },
      }),
    ]);

    return paginated(items.map((i) => this.mapToListItem(i)), total, dto);
  }

  /** GET /interviews/mine — 员工自己的面谈列表。 */
  async findMine(dto: PaginationDto, viewer: AuthUser): Promise<Paginated<InterviewListItem>> {
    const where: Prisma.PerformanceInterviewWhereInput = { employeeId: viewer.id };

    const [total, items] = await Promise.all([
      this.prisma.performanceInterview.count({ where }),
      this.prisma.performanceInterview.findMany({
        where,
        skip: dto.skip,
        take: dto.take,
        include: {
          task: {
            include: {
              employee: { select: { name: true, position: true } },
              dept: { select: { name: true } },
              cycle: { select: { name: true } },
            },
          },
        },
        orderBy: { deadline: 'asc' },
      }),
    ]);

    return paginated(items.map((i) => this.mapToListItem(i)), total, dto);
  }

  /** GET /interviews/:id 或 GET /tasks/:id/interview。 */
  async findOne(id: string, viewer: AuthUser): Promise<InterviewDetail> {
    const interview = await this.prisma.performanceInterview.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            employee: { select: { name: true } },
            dept: { select: { name: true } },
            manager: { select: { name: true } },
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '面谈记录不存在' });
    }

    this.assertCanView(interview, viewer);
    return this.mapToDetail(interview);
  }

  /** GET /tasks/:id/interview — 按任务 ID 查看面谈。 */
  async findByTaskId(taskId: string, viewer: AuthUser): Promise<InterviewDetail> {
    const interview = await this.prisma.performanceInterview.findUnique({
      where: { taskId },
      include: {
        task: {
          include: {
            employee: { select: { name: true } },
            dept: { select: { name: true } },
            manager: { select: { name: true } },
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '面谈记录不存在' });
    }

    this.assertCanView(interview, viewer);
    return this.mapToDetail(interview);
  }

  /** PUT /interviews/:id — 主管填写/更新面谈内容。 */
  async update(id: string, dto: UpdateInterviewDto, viewer: AuthUser): Promise<InterviewDetail> {
    const interview = await this.prisma.performanceInterview.findUnique({
      where: { id },
      include: { task: true },
    });

    if (!interview) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '面谈记录不存在' });
    }

    this.assertInterviewer(interview, viewer);

    if (!POST_PUBLISH_STATUSES.includes(interview.task.status)) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '仅公示及之后的任务可填写面谈记录',
      });
    }

    if (interview.employeeSignedAt) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '员工已签字，面谈记录不可再修改',
      });
    }

    const updateData: Prisma.PerformanceInterviewUpdateInput = {
      ...dto,
      status: interview.status === InterviewStatus.pending ? InterviewStatus.filled : interview.status,
    };

    const updated = await this.prisma.performanceInterview.update({
      where: { id },
      data: updateData,
      include: {
        task: {
          include: {
            employee: { select: { name: true } },
            dept: { select: { name: true } },
            manager: { select: { name: true } },
          },
        },
      },
    });

    return this.mapToDetail(updated);
  }

  /** POST /interviews/:id/manager-sign — 主管签字占位。 */
  async managerSign(id: string, viewer: AuthUser): Promise<InterviewDetail> {
    const interview = await this.prisma.performanceInterview.findUnique({
      where: { id },
      include: { task: true },
    });

    if (!interview) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '面谈记录不存在' });
    }

    this.assertInterviewer(interview, viewer);

    if (!POST_PUBLISH_STATUSES.includes(interview.task.status)) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '仅公示及之后的任务可签字',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.signature.upsert({
        where: {
          businessType_businessRecordId_role: {
            businessType: SignatureBusinessType.interview,
            businessRecordId: interview.id,
            role: SignatureRole.assessor,
          },
        },
        create: {
          businessType: SignatureBusinessType.interview,
          businessRecordId: interview.id,
          role: SignatureRole.assessor,
          signerId: viewer.id,
          method: SignatureMethod.online_confirm,
        },
        update: {
          signerId: viewer.id,
          signedAt: new Date(),
          method: SignatureMethod.online_confirm,
        },
      });

      const nextStatus = interview.employeeSignedAt ? InterviewStatus.closed : InterviewStatus.filled;

      return tx.performanceInterview.update({
        where: { id },
        data: {
          managerSignedAt: new Date(),
          status: nextStatus,
        },
        include: {
          task: {
            include: {
              employee: { select: { name: true } },
              dept: { select: { name: true } },
              manager: { select: { name: true } },
            },
          },
        },
      });
    });

    return this.mapToDetail(updated);
  }

  /** POST /interviews/:id/employee-sign — 员工签字占位。 */
  async employeeSign(id: string, viewer: AuthUser): Promise<InterviewDetail> {
    const interview = await this.prisma.performanceInterview.findUnique({
      where: { id },
      include: { task: true },
    });

    if (!interview) {
      throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '面谈记录不存在' });
    }

    this.assertEmployee(interview, viewer);

    if (!POST_PUBLISH_STATUSES.includes(interview.task.status)) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '仅公示及之后的任务可签字',
      });
    }

    if (interview.status === InterviewStatus.pending) {
      throw new BadRequestException({
        code: ERROR_CODE.CONFLICT,
        message: '面谈记录尚未填写，无法签字',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.signature.upsert({
        where: {
          businessType_businessRecordId_role: {
            businessType: SignatureBusinessType.interview,
            businessRecordId: interview.id,
            role: SignatureRole.assessee,
          },
        },
        create: {
          businessType: SignatureBusinessType.interview,
          businessRecordId: interview.id,
          role: SignatureRole.assessee,
          signerId: viewer.id,
          method: SignatureMethod.online_confirm,
        },
        update: {
          signerId: viewer.id,
          signedAt: new Date(),
          method: SignatureMethod.online_confirm,
        },
      });

      return tx.performanceInterview.update({
        where: { id },
        data: {
          employeeSignedAt: new Date(),
          status: InterviewStatus.closed,
        },
        include: {
          task: {
            include: {
              employee: { select: { name: true } },
              dept: { select: { name: true } },
              manager: { select: { name: true } },
            },
          },
        },
      });
    });

    return this.mapToDetail(updated);
  }

  /** 公示时自动创建面谈记录。 */
  async createOnPublish(
    tx: Prisma.TransactionClient,
    task: { id: string; cycleId: string; employeeId: string; managerId: string | null; approvedAt: Date | null },
  ): Promise<void> {
    if (!task.managerId || !task.approvedAt) {
      return;
    }

    const deadline = dayjs(task.approvedAt).add(20, 'day').startOf('day').toDate();

    await tx.performanceInterview.upsert({
      where: { taskId: task.id },
      create: {
        taskId: task.id,
        cycleId: task.cycleId,
        employeeId: task.employeeId,
        interviewerId: task.managerId,
        deadline,
        status: InterviewStatus.pending,
      },
      update: {},
    });
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  private canViewAll(viewer: AuthUser): boolean {
    return viewer.sysRole === SysRole.hr || viewer.sysRole === SysRole.system_admin || viewer.canViewAll === true;
  }

  private assertCanView(
    interview: { employeeId: string; interviewerId: string },
    viewer: AuthUser,
  ): void {
    if (this.canViewAll(viewer)) return;
    if (interview.employeeId === viewer.id) return;
    if (interview.interviewerId === viewer.id) return;
    throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '无权查看该面谈记录' });
  }

  private assertInterviewer(
    interview: { interviewerId: string },
    viewer: AuthUser,
  ): void {
    if (interview.interviewerId !== viewer.id && !this.canViewAll(viewer)) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅面谈人可填写该面谈记录' });
    }
  }

  private assertEmployee(
    interview: { employeeId: string },
    viewer: AuthUser,
  ): void {
    if (interview.employeeId !== viewer.id) {
      throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅员工本人可签字' });
    }
  }

  private mapToListItem(
    interview: Prisma.PerformanceInterviewGetPayload<{
      include: {
        task: {
          include: {
            employee: { select: { name: true; position: true } };
            dept: { select: { name: true } };
            cycle: { select: { name: true } };
          };
        };
      };
    }>,
  ): InterviewListItem {
    return {
      id: interview.id,
      taskId: interview.taskId,
      cycleId: interview.cycleId,
      cycleName: interview.task.cycle?.name ?? null,
      employeeId: interview.employeeId,
      employeeName: interview.task.employee?.name ?? '',
      position: interview.task.employee?.position ?? null,
      deptId: interview.task.deptId,
      deptName: interview.task.dept?.name ?? null,
      status: interview.status,
      deadline: interview.deadline,
      method: interview.method,
      scoreInformed: interview.scoreInformed,
      managerSignedAt: interview.managerSignedAt,
      employeeSignedAt: interview.employeeSignedAt,
      updatedAt: interview.updatedAt,
    };
  }

  private mapToDetail(
    interview: Prisma.PerformanceInterviewGetPayload<{
      include: {
        task: {
          include: {
            employee: { select: { name: true } };
            dept: { select: { name: true } };
            manager: { select: { name: true } };
          };
        };
      };
    }>,
  ): InterviewDetail {
    return {
      ...interview,
      employeeName: interview.task.employee?.name ?? null,
      deptName: interview.task.dept?.name ?? null,
      interviewerName: interview.task.manager?.name ?? null,
    };
  }
}
