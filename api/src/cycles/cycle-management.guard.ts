import { CanActivate, ConflictException, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { HR_CAPABILITIES_KEY } from '@/common/decorators/hr-capabilities.decorator';
import { hasHrCapability, HrCapability } from '@/auth/hr-capabilities';
import { assertCycleOperator, isGlobalCycleOperator } from './cycle-operator-scope';

/** Adds cycle ownership to management endpoints; employee reads keep task-based scope. */
@Injectable()
export class CycleManagementGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const viewer = request.user as AuthUser;
    if (!viewer) return true; // Global authentication/role guards apply first.
    const required = this.reflector.getAllAndOverride<HrCapability[]>(HR_CAPABILITIES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const id = request.params?.id;
    if (id && isUUID(id) && request.method !== 'GET' && context.getHandler().name !== 'terminate'
      && context.getHandler().name !== 'publish') {
      const state = await this.prisma.assessmentCycle.findUnique({ where: { id }, select: { terminatedAt: true } });
      if (state?.terminatedAt) throw new ConflictException('本周期已终止，计划及时间安排只读；已有结果保留');
    }
    if (isGlobalCycleOperator(viewer)) return true;
    if (!id || !isUUID(id) || !required.some((c) => c === 'cycle_plan_edit' || c === 'cycle_plan_review')) return true;
    const cycle = await this.prisma.assessmentCycle.findUnique({ where: { id }, select: { hrOwnerId: true, reviewerId: true } });
    if (!cycle) throw new NotFoundException('考核周期不存在');
    if (request.method === 'GET' && required.includes('cycle_plan_review')
      && hasHrCapability(viewer, 'cycle_plan_review') && cycle.reviewerId === viewer.id) return true;
    assertCycleOperator(viewer, cycle);
    return true;
  }
}
