import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { paginated } from '@/common/dto/pagination.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { canManageAppealLedger } from './appeals-access.guard';
import { AppealQueryDto } from './dto/appeal-query.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { UpdateAppealDto } from './dto/update-appeal.dto';

const include = Prisma.validator<Prisma.HrAppealRecordInclude>()({
  employee: { select: { name: true, employeeNo: true, deptId: true, dept: { select: { name: true } } } },
  cycle: { select: { name: true } },
  recordedBy: { select: { name: true } },
});
type RecordWithPeople = Prisma.HrAppealRecordGetPayload<{ include: typeof include }>;

/** HR 人事台账。没有任务、算分、审批或流程依赖。 */
@Injectable()
export class AppealsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(dto: AppealQueryDto, viewer: AuthUser) {
    this.assertAccess(viewer);
    const keyword = dto.keyword?.trim();
    const where: Prisma.HrAppealRecordWhereInput = {
      ...(dto.cycleId ? { cycleId: dto.cycleId } : {}),
      ...(dto.deptId ? { employee: { deptId: dto.deptId } } : {}),
      ...(keyword ? { OR: [
        { subject: { contains: keyword, mode: 'insensitive' } },
        { employee: { name: { contains: keyword, mode: 'insensitive' } } },
        { employee: { employeeNo: { contains: keyword, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.hrAppealRecord.count({ where }),
      this.prisma.hrAppealRecord.findMany({ where, include, skip: dto.skip, take: dto.take,
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    return paginated(items.map(item => this.present(item)), total, dto);
  }

  async people(dto: AppealQueryDto, viewer: AuthUser) {
    this.assertAccess(viewer);
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
    this.assertAccess(viewer);
    return this.prisma.assessmentCycle.findMany({
      select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, viewer: AuthUser) {
    this.assertAccess(viewer);
    const item = await this.prisma.hrAppealRecord.findUnique({ where: { id }, include });
    if (!item) throw new NotFoundException('申诉记录不存在');
    return this.present(item);
  }

  async create(dto: CreateAppealDto, viewer: AuthUser) {
    this.assertAccess(viewer);
    const id = await this.prisma.$transaction(async tx => {
      await this.validateReferences(tx, dto.employeeId, dto.cycleId);
      const item = await tx.hrAppealRecord.create({ data: {
        employeeId: dto.employeeId, cycleId: dto.cycleId ?? null,
        receivedAt: this.date(dto.receivedAt), subject: this.required(dto.subject, '申诉事项'),
        content: this.required(dto.content, '诉求内容'),
        handlingNote: this.optional(dto.handlingNote), conclusion: this.optional(dto.conclusion),
        recordedById: viewer.id,
      } });
      await tx.auditLog.create({ data: { userId: viewer.id, action: 'create', entityType: 'hr_appeal_record', entityId: item.id,
        newValue: JSON.parse(JSON.stringify(item)) as Prisma.InputJsonValue } });
      return item.id;
    });
    return this.findOne(id, viewer);
  }

  async update(id: string, dto: UpdateAppealDto, viewer: AuthUser) {
    this.assertAccess(viewer);
    await this.prisma.$transaction(async tx => {
      const before = await tx.hrAppealRecord.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('申诉记录不存在');
      await this.validateReferences(tx, dto.employeeId, dto.cycleId);
      const data: Prisma.HrAppealRecordUpdateInput = { updatedAt: new Date() };
      if (dto.employeeId !== undefined) data.employee = { connect: { id: dto.employeeId } };
      if (dto.cycleId !== undefined) data.cycle = dto.cycleId ? { connect: { id: dto.cycleId } } : { disconnect: true };
      if (dto.receivedAt !== undefined) data.receivedAt = this.date(dto.receivedAt);
      if (dto.subject !== undefined) data.subject = this.required(dto.subject, '申诉事项');
      if (dto.content !== undefined) data.content = this.required(dto.content, '诉求内容');
      if (dto.handlingNote !== undefined) data.handlingNote = this.optional(dto.handlingNote);
      if (dto.conclusion !== undefined) data.conclusion = this.optional(dto.conclusion);
      const after = await tx.hrAppealRecord.update({ where: { id }, data });
      await tx.auditLog.create({ data: { userId: viewer.id, action: 'update', entityType: 'hr_appeal_record', entityId: id,
        oldValue: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        newValue: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue } });
    });
    return this.findOne(id, viewer);
  }

  private assertAccess(viewer: AuthUser) {
    if (!canManageAppealLedger(viewer)) throw new ForbiddenException('仅 HR 管理员或绩效专员可访问申诉记录');
  }

  private async validateReferences(tx: Prisma.TransactionClient, employeeId?: string, cycleId?: string | null) {
    if (employeeId && !(await tx.user.findFirst({ where: { id: employeeId, deletedAt: null, accountType: 'employee' }, select: { id: true } }))) {
      throw new BadRequestException('员工不存在，请重新选择');
    }
    if (cycleId && !(await tx.assessmentCycle.findUnique({ where: { id: cycleId }, select: { id: true } }))) {
      throw new BadRequestException('关联周期不存在，请重新选择');
    }
  }

  private date(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('收到日期无效');
    }
    return date;
  }

  private required(value: string, label: string): string {
    const text = value.trim();
    if (!text) throw new BadRequestException(`请填写${label}`);
    return text;
  }

  private optional(value?: string | null): string | null {
    return value?.trim() || null;
  }

  private present(item: RecordWithPeople) {
    return { id: item.id, employeeId: item.employeeId, employeeName: item.employee.name,
      employeeNo: item.employee.employeeNo, deptId: item.employee.deptId, deptName: item.employee.dept?.name ?? null,
      cycleId: item.cycleId, cycleName: item.cycle?.name ?? null, receivedAt: item.receivedAt.toISOString().slice(0, 10),
      subject: item.subject, content: item.content, handlingNote: item.handlingNote,
      conclusion: item.conclusion, recordedByName: item.recordedBy?.name ?? null,
      createdAt: item.createdAt, updatedAt: item.updatedAt };
  }
}
