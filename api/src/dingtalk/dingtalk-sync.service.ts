import { Injectable, Logger } from '@nestjs/common';
import { CompanyCode, SysRole, UserStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DingtalkService, DingtalkDepartment, DingtalkUser } from './dingtalk.service';

/** 同步结果快照。 */
export interface DingtalkSyncResult {
  syncId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  added: number;
  updated: number;
  deactivated: number;
  errors: string[];
}

/** 触发同步后的立即响应。 */
export interface DingtalkSyncJob {
  syncId: string;
  status: 'running';
  startedAt: Date;
}

/**
 * 钉钉组织增量同步服务。
 *
 * 规则：
 * 1. 部门按 dingtalk_dept_id、人员按 dingtalk_id 增量 upsert。
 * 2. direct_manager_id 是本地覆盖值——同步只写 dingtalk_manager_id；
 *    仅当 direct_manager_id 为 null 时才回填。
 * 3. 钉钉中已不存在的人 → status='resigned'（不硬删）。
 */
@Injectable()
export class DingtalkSyncService {
  private readonly logger = new Logger(DingtalkSyncService.name);
  private readonly results = new Map<string, DingtalkSyncResult>();

  constructor(
    private readonly dingtalk: DingtalkService,
    private readonly prisma: PrismaService,
  ) {}

  /** 取指定同步结果（内存态，重启丢失可接受）。 */
  getResult(syncId: string): DingtalkSyncResult | undefined {
    return this.results.get(syncId);
  }

  /**
   * 触发一次同步，立即返回 syncId，实际工作在后台执行。
   */
  runSync(operatorId?: string): DingtalkSyncJob {
    const syncId = this.generateSyncId();
    const startedAt = new Date();

    const result: DingtalkSyncResult = {
      syncId,
      status: 'running',
      startedAt,
      added: 0,
      updated: 0,
      deactivated: 0,
      errors: [],
    };
    this.results.set(syncId, result);

    // 异步执行，不阻塞 HTTP 响应
    this.executeSync(syncId, operatorId).catch((err) => {
      this.logger.error(`钉钉同步 ${syncId} 异常`, err);
      const r = this.results.get(syncId);
      if (r) {
        r.status = 'failed';
        r.completedAt = new Date();
        r.errors.push(err instanceof Error ? err.message : String(err));
      }
    });

    return { syncId, status: 'running', startedAt };
  }

  private generateSyncId(): string {
    return `ding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async executeSync(syncId: string, operatorId?: string): Promise<void> {
    const result = this.results.get(syncId)!;
    const deptIdMap = new Map<number, string>(); // dingtalk dept id -> local dept id
    const userIdMap = new Map<string, string>(); // dingtalk user id -> local user id
    const seenDingtalkUserIds = new Set<string>();

    try {
      // 1. 同步部门
      const remoteDepts = await this.dingtalk.fetchDepartments();
      const existingDeptIds = new Set(
        (
          await this.prisma.department.findMany({
            where: { dingtalkDeptId: { not: null } },
            select: { dingtalkDeptId: true },
          })
        ).map((d) => d.dingtalkDeptId),
      );

      for (const dept of remoteDepts) {
        try {
          const isNew = !existingDeptIds.has(String(dept.dept_id));
          const upserted = await this.prisma.department.upsert({
            where: { dingtalkDeptId: String(dept.dept_id) },
            create: {
              dingtalkDeptId: String(dept.dept_id),
              name: dept.name,
              company: CompanyCode.fuede,
            },
            update: {
              name: dept.name,
            },
          });
          deptIdMap.set(dept.dept_id, upserted.id);
          if (isNew) result.added++;
          else result.updated++;
        } catch (err) {
          const msg = `部门 ${dept.dept_id}(${dept.name}) 同步失败: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.warn(msg);
          result.errors.push(msg);
        }
      }

      // 2. 回填部门 parent_id（需在全部部门 upsert 后，才能映射到本地 id）
      for (const dept of remoteDepts) {
        const localId = deptIdMap.get(dept.dept_id);
        const parentLocalId = dept.parent_id ? deptIdMap.get(dept.parent_id) : null;
        if (localId) {
          await this.prisma.department.update({
            where: { id: localId },
            data: { parentId: parentLocalId },
          });
        }
      }

      // 3. 拉取并同步人员
      const remoteUsers: DingtalkUser[] = [];
      for (const dept of remoteDepts) {
        try {
          const users = await this.dingtalk.fetchUsersByDepartment(dept.dept_id);
          remoteUsers.push(...users);
        } catch (err) {
          const msg = `拉取部门 ${dept.dept_id} 成员失败: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.warn(msg);
          result.errors.push(msg);
        }
      }

      // 按 dingtalk userid 去重
      const userById = new Map<string, DingtalkUser>();
      for (const u of remoteUsers) {
        userById.set(u.userid, u);
      }

      const existingUserIds = new Set(
        (
          await this.prisma.user.findMany({
            where: { dingtalkId: { not: null }, deletedAt: null },
            select: { dingtalkId: true },
          })
        ).map((u) => u.dingtalkId),
      );

      for (const user of userById.values()) {
        seenDingtalkUserIds.add(user.userid);
        try {
          const isNew = !existingUserIds.has(user.userid);
          const deptDingId = user.dept_id_list?.[0] ?? null;
          const localDeptId = deptDingId ? deptIdMap.get(deptDingId) ?? null : null;

          const upserted = await this.prisma.user.upsert({
            where: { dingtalkId: user.userid },
            create: {
              dingtalkId: user.userid,
              dingtalkUnionId: user.unionid,
              name: user.name,
              avatarUrl: user.avatar ?? null,
              phone: user.mobile ?? null,
              email: user.email ?? null,
              deptId: localDeptId,
              position: user.title ?? null,
              status: UserStatus.active,
              dingtalkManagerId: user.manager_userid ?? null,
              sysRole: SysRole.employee,
            },
            update: {
              dingtalkUnionId: user.unionid,
              name: user.name,
              avatarUrl: user.avatar ?? null,
              phone: user.mobile ?? null,
              email: user.email ?? null,
              deptId: localDeptId,
              position: user.title ?? null,
              status: UserStatus.active,
              dingtalkManagerId: user.manager_userid ?? null,
            },
          });

          userIdMap.set(user.userid, upserted.id);
          if (isNew) result.added++;
          else result.updated++;
        } catch (err) {
          const msg = `用户 ${user.userid}(${user.name}) 同步失败: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.warn(msg);
          result.errors.push(msg);
        }
      }

      // 4. 离职处理：钉钉中已不存在且未离职的人
      const usersToDeactivate = await this.prisma.user.findMany({
        where: {
          dingtalkId: { not: null, notIn: Array.from(seenDingtalkUserIds) },
          deletedAt: null,
          status: { not: UserStatus.resigned },
        },
        select: { id: true, dingtalkId: true },
      });

      if (usersToDeactivate.length > 0) {
        await this.prisma.user.updateMany({
          where: {
            id: { in: usersToDeactivate.map((u) => u.id) },
          },
          data: { status: UserStatus.resigned, leaveDate: new Date() },
        });
        result.deactivated = usersToDeactivate.length;
      }

      // 5. 本地覆盖保护：仅当 direct_manager_id 为 null 时，用 dingtalk_manager_id 回填
      await this.backfillManagers();
    } catch (err) {
      result.status = 'failed';
      result.completedAt = new Date();
      result.errors.unshift(err instanceof Error ? err.message : String(err));
      await this.writeAuditLog(syncId, operatorId, result);
      throw err;
    }

    result.status = 'completed';
    result.completedAt = new Date();
    await this.writeAuditLog(syncId, operatorId, result);
  }

  /**
   * 回填 direct_manager_id：只动没有本地覆盖值的记录。
   */
  private async backfillManagers(): Promise<void> {
    const usersWithoutManager = await this.prisma.user.findMany({
      where: {
        directManagerId: null,
        dingtalkManagerId: { not: null },
        deletedAt: null,
      },
      select: { id: true, dingtalkManagerId: true },
    });

    for (const u of usersWithoutManager) {
      if (!u.dingtalkManagerId) continue;
      const manager = await this.prisma.user.findUnique({
        where: { dingtalkId: u.dingtalkManagerId },
        select: { id: true },
      });
      if (manager) {
        await this.prisma.user.update({
          where: { id: u.id },
          data: { directManagerId: manager.id },
        });
      }
    }
  }

  private async writeAuditLog(
    syncId: string,
    operatorId: string | undefined,
    result: DingtalkSyncResult,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: operatorId ?? null,
          action: 'dingtalk_sync',
          entityType: 'dingtalk_sync',
          entityId: null,
          newValue: {
            syncId,
            status: result.status,
            added: result.added,
            updated: result.updated,
            deactivated: result.deactivated,
            errorCount: result.errors.length,
          },
        },
      });
    } catch (err) {
      this.logger.error('写入钉钉同步审计日志失败', err);
    }
  }
}
