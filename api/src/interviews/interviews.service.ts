import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { paginated } from '@/common/dto/pagination.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { InterviewQueryDto } from './dto/interview-query.dto';

const include = Prisma.validator<Prisma.PerformanceInterviewInclude>()({
  employee: { select: { name: true, employeeNo: true, position: true, deptId: true, dept: { select: { name: true } } } },
  interviewer: { select: { name: true } },
  recordedBy: { select: { name: true } },
  cycle: { select: { name: true } },
});
type Interview = Prisma.PerformanceInterviewGetPayload<{ include: typeof include }>;

/** HR 管理台账：只保存沟通记录，不参与绩效状态流转或签字。 */
@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dto: InterviewQueryDto, viewer: AuthUser) {
    this.assertHr(viewer);
    const keyword = dto.keyword?.trim();
    const where: Prisma.PerformanceInterviewWhereInput = {
      ...(dto.cycleId ? { cycleId: dto.cycleId } : {}),
      employee: {
        ...(dto.deptId ? { deptId: dto.deptId } : {}),
        ...(keyword ? { OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { employeeNo: { contains: keyword, mode: 'insensitive' } },
        ] } : {}),
      },
    };
    const [total, items] = await Promise.all([
      this.prisma.performanceInterview.count({ where }),
      this.prisma.performanceInterview.findMany({ where, skip: dto.skip, take: dto.take, include,
        orderBy: [{ interviewTime: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    return paginated(items.map(item => this.summary(item)), total, dto);
  }

  // Only identity fields needed for recording an interview; no personnel-file permissions are granted.
  async people(dto: InterviewQueryDto, viewer: AuthUser) {
    this.assertHr(viewer);
    const keyword = dto.keyword?.trim();
    return this.prisma.user.findMany({
      where: { deletedAt: null, accountType: 'employee', ...(keyword ? { OR: [
        { name: { contains: keyword, mode: 'insensitive' } },
        { employeeNo: { contains: keyword, mode: 'insensitive' } },
      ] } : {}) },
      select: { id: true, name: true, employeeNo: true, dept: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: dto.skip, take: dto.take,
    });
  }

  async cycles(viewer: AuthUser) {
    this.assertHr(viewer);
    return this.prisma.assessmentCycle.findMany({
      where: { status: { notIn: ['draft', 'scheduled', 'launch_blocked'] } },
      select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, viewer: AuthUser) {
    this.assertHr(viewer);
    const item = await this.prisma.performanceInterview.findUnique({ where: { id }, include });
    if (!item) throw new NotFoundException('面谈记录不存在');
    return { ...this.summary(item), ...this.content(item) };
  }

  async create(dto: CreateInterviewDto, viewer: AuthUser) {
    this.assertHr(viewer);
    const id = await this.prisma.$transaction(async tx => {
      const interviewerId = dto.interviewerId ?? viewer.id;
      const ids = [...new Set([dto.employeeId, interviewerId])];
      const people = await tx.user.count({ where: { id: { in: ids }, deletedAt: null } });
      if (people !== ids.length) throw new BadRequestException('员工或面谈人不存在，请重新选择');
      if (dto.cycleId && !(await tx.assessmentCycle.findUnique({ where: { id: dto.cycleId }, select: { id: true } }))) {
        throw new BadRequestException('关联周期不存在，请重新选择');
      }
      const item = await tx.performanceInterview.create({ data: {
        employeeId: dto.employeeId, interviewerId, cycleId: dto.cycleId ?? null,
        recordedById: viewer.id, status: 'filled', ...this.content(dto),
      } });
      await tx.auditLog.create({ data: { userId: viewer.id, action: 'create', entityType: 'performance_interview', entityId: item.id,
        newValue: JSON.parse(JSON.stringify(item)) as Prisma.InputJsonValue } });
      return item.id;
    });
    return this.findOne(id, viewer);
  }

  async update(id: string, dto: UpdateInterviewDto, viewer: AuthUser) {
    this.assertHr(viewer);
    await this.prisma.$transaction(async tx => {
      const before = await tx.performanceInterview.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('面谈记录不存在');
      const after = await tx.performanceInterview.update({ where: { id }, data: { ...this.content(dto), updatedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: viewer.id, action: 'update', entityType: 'performance_interview', entityId: id,
        oldValue: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        newValue: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue } });
    });
    return this.findOne(id, viewer);
  }

  private assertHr(viewer: AuthUser) {
    if (viewer.sysRole !== SysRole.hr_user && viewer.sysRole !== SysRole.hr && viewer.sysRole !== SysRole.system_admin) {
      throw new ForbiddenException('绩效面谈台账仅供 HR 人员维护');
    }
  }

  private summary(item: Interview) {
    return { id: item.id, cycleId: item.cycleId, cycleName: item.cycle?.name ?? null,
      employeeId: item.employeeId, employeeName: item.employee.name, employeeNo: item.employee.employeeNo,
      deptId: item.employee.deptId, deptName: item.employee.dept?.name ?? null, position: item.employee.position,
      interviewerId: item.interviewerId, interviewerName: item.interviewer.name,
      recordedByName: item.recordedBy?.name ?? null, interviewTime: item.interviewTime,
      method: item.method, createdAt: item.createdAt, updatedAt: item.updatedAt };
  }

  private content(item: UpdateInterviewDto | Interview) {
    return { interviewTime: item.interviewTime, location: item.location, method: item.method,
      scoreInformed: item.scoreInformed, achievements: item.achievements, weaknesses: item.weaknesses,
      nextGoals: item.nextGoals, remediation: item.remediation, supportNeeded: item.supportNeeded, otherMatters: item.otherMatters };
  }
}
