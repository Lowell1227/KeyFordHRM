import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma, SysRole, UserStatus } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import type { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  CreatePositionDto,
  PositionChangeReviewQueryDto,
  PositionQueryDto,
  UpdatePositionDto,
} from './dto/position.dto';

type PositionAction = 'create' | 'update' | 'deactivate';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PositionQueryDto) {
    const keyword = query.keyword?.trim();
    const positions = await this.prisma.position.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(keyword ? {
          OR: [
            { code: { contains: keyword, mode: 'insensitive' as const } },
            { name: { contains: keyword, mode: 'insensitive' as const } },
            { jobFamily: { contains: keyword, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      include: {
        _count: {
          select: {
            users: {
              where: {
                deletedAt: null,
                accountType: AccountType.employee,
                status: { not: UserStatus.resigned },
              },
            },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { jobFamily: 'asc' }, { name: 'asc' }],
    });
    return positions.map(({ _count, ...position }) => ({
      ...position,
      activeEmployeeCount: _count.users,
    }));
  }

  async create(dto: CreatePositionDto, operator: AuthUser) {
    const proposedValue = this.normalized(dto);
    return this.prisma.$transaction(async (tx) => {
      const duplicates = await tx.position.findFirst({
        where: {
          OR: [
            { code: proposedValue.code },
            { name: { equals: proposedValue.name, mode: 'insensitive' } },
          ],
        },
        select: { code: true, name: true },
      });
      const warnings = duplicates
        ? [`已存在相似岗位：${duplicates.code} · ${duplicates.name}`]
        : [];
      const pendingCreates = await tx.positionChangeRequest.findMany({
        where: { action: 'create', status: { in: ['pending', 'applying'] } },
        select: { id: true, proposedValue: true },
      });
      if (pendingCreates.some((item) => this.samePositionValue(
        proposedValue,
        this.record(item.proposedValue),
      ))) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '相同岗位已有变更审核中，请先处理现有申请',
        });
      }
      const request = await tx.positionChangeRequest.create({
        data: {
          positionName: proposedValue.name,
          action: 'create',
          status: 'pending',
          baseValue: {},
          proposedValue,
          warnings,
          createdById: operator.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'submit_position_change',
          entityType: 'position_change_request',
          entityId: request.id,
          newValue: { action: 'create', proposedValue, warnings },
        },
      });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(id: string, dto: UpdatePositionDto, operator: AuthUser) {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) throw this.notFound();
    const proposedValue = this.normalized({
      code: dto.code ?? position.code,
      name: dto.name ?? position.name,
      jobFamily: dto.jobFamily !== undefined ? dto.jobFamily : position.jobFamily,
    });
    if (proposedValue.code === position.code
      && proposedValue.name === position.name
      && proposedValue.jobFamily === (position.jobFamily ?? null)
      && proposedValue.isActive === position.isActive) {
      throw new BadRequestException({
        code: ERROR_CODE.PARAM_INVALID,
        message: '未检测到实际变更，无需提交审核',
      });
    }
    return this.createRequest('update', id, position.name, position, proposedValue, [], operator);
  }

  async deactivate(id: string, operator: AuthUser) {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) throw this.notFound();
    const activeEmployeeCount = await this.prisma.user.count({
      where: {
        positionId: id,
        deletedAt: null,
        accountType: AccountType.employee,
        status: { not: UserStatus.resigned },
      },
    });
    const warnings = activeEmployeeCount > 0
      ? [`仍有 ${activeEmployeeCount} 名在职员工使用该岗位，请先设置替代岗位`]
      : [];
    return this.createRequest(
      'deactivate',
      id,
      position.name,
      position,
      { ...position, isActive: false, activeEmployeeCount },
      warnings,
      operator,
    );
  }

  async findChangeRequests(query: PositionChangeReviewQueryDto) {
    const where = query.status === 'all' ? {} : { status: query.status };
    const [items, total] = await Promise.all([
      this.prisma.positionChangeRequest.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, sysRole: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.positionChangeRequest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async approve(requestId: string, operator: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.positionChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '岗位变更不存在' });
      this.assertReviewer(operator);
      if (request.status !== 'pending') {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该岗位变更已处理' });
      }
      const claimed = await tx.positionChangeRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'applying' },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该岗位变更正在处理中' });
      }
      const proposed = this.record(request.proposedValue);
      let positionId = request.positionId;
      if (request.action === 'create') {
        const code = this.requiredString(proposed.code, '岗位编码不能为空');
        const exists = await tx.position.findFirst({ where: { code } });
        if (exists) throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '岗位编码已存在' });
        const created = await tx.position.create({
          data: {
            code,
            name: this.requiredString(proposed.name, '岗位名称不能为空'),
            jobFamily: this.nullableString(proposed.jobFamily),
            isActive: true,
          },
        });
        positionId = created.id;
      } else {
        if (!positionId) throw this.notFound();
        const current = await tx.position.findUnique({ where: { id: positionId } });
        if (!current) throw this.notFound();
        if (!this.samePositionValue(current, this.record(request.baseValue))) {
          throw new ConflictException({
            code: ERROR_CODE.CONFLICT,
            message: '正式岗位信息已发生变化，请重新提交审核',
          });
        }
        if (request.action === 'update') {
          await tx.position.update({
            where: { id: positionId },
            data: {
              code: this.requiredString(proposed.code, '岗位编码不能为空'),
              name: this.requiredString(proposed.name, '岗位名称不能为空'),
              jobFamily: this.nullableString(proposed.jobFamily),
            },
          });
        } else if (request.action === 'deactivate') {
          const activeEmployeeCount = await tx.user.count({
            where: {
              positionId,
              deletedAt: null,
              accountType: AccountType.employee,
              status: { not: UserStatus.resigned },
            },
          });
          if (activeEmployeeCount > 0) {
            throw new BadRequestException({
              code: ERROR_CODE.CONFLICT,
              message: `仍有 ${activeEmployeeCount} 名在职员工使用该岗位，请先设置替代岗位`,
            });
          }
          await tx.position.update({ where: { id: positionId }, data: { isActive: false } });
        }
      }
      const now = new Date();
      const result = await tx.positionChangeRequest.update({
        where: { id: requestId },
        data: {
          positionId,
          status: 'approved',
          reviewedById: operator.id,
          reviewedAt: now,
          appliedAt: now,
          rejectedReason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'approve_position_change',
          entityType: 'position_change_request',
          entityId: requestId,
          newValue: { action: request.action, positionId },
        },
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(requestId: string, reason: string, operator: AuthUser) {
    this.assertReviewer(operator);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.positionChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '岗位变更不存在' });
      const updated = await tx.positionChangeRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'rejected',
          reviewedById: operator.id,
          reviewedAt: new Date(),
          rejectedReason: reason.trim(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: ERROR_CODE.CONFLICT, message: '该岗位变更已处理' });
      }
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'reject_position_change',
          entityType: 'position_change_request',
          entityId: requestId,
          newValue: { reason: reason.trim() },
        },
      });
      return tx.positionChangeRequest.findUnique({ where: { id: requestId } });
    });
  }

  private async createRequest(
    action: PositionAction,
    positionId: string,
    positionName: string,
    baseValue: object,
    proposedValue: object,
    warnings: string[],
    operator: AuthUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.positionChangeRequest.findFirst({
        where: {
          positionId,
          status: { in: ['pending', 'applying'] },
        },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictException({
          code: ERROR_CODE.CONFLICT,
          message: '该岗位已有变更审核中，请先处理现有申请',
        });
      }
      const request = await tx.positionChangeRequest.create({
        data: {
          positionId,
          positionName,
          action,
          status: 'pending',
          baseValue: this.toJson(baseValue),
          proposedValue: this.toJson(proposedValue),
          warnings,
          createdById: operator.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: operator.id,
          action: 'submit_position_change',
          entityType: 'position_change_request',
          entityId: request.id,
          oldValue: this.toJson(baseValue),
          newValue: this.toJson({ action, proposedValue, warnings }),
        },
      });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private normalized(dto: { code: string; name: string; jobFamily?: string | null }) {
    return {
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
      jobFamily: dto.jobFamily?.trim() || null,
      isActive: true,
    };
  }

  private samePositionValue(
    current: { code: string; name: string; jobFamily?: string | null; isActive: boolean },
    base: Record<string, unknown>,
  ): boolean {
    return current.code === base.code
      && current.name === base.name
      && (current.jobFamily ?? null) === (base.jobFamily ?? null)
      && current.isActive === base.isActive;
  }

  private assertReviewer(operator: AuthUser): void {
    if (operator.sysRole !== SysRole.hr && operator.sysRole !== SysRole.system_admin) {
      throw new BadRequestException({ code: ERROR_CODE.FORBIDDEN, message: '仅 HR 管理员可审核岗位变更' });
    }
  }

  private notFound() {
    return new NotFoundException({ code: ERROR_CODE.NOT_FOUND, message: '岗位不存在' });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private requiredString(value: unknown, message: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message });
  }

  private nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toJson(value: object): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
