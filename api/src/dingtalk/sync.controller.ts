import { Controller, Get, Param, Post } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { DingtalkSyncService, DingtalkSyncResult } from './dingtalk-sync.service';

/**
 * 钉钉同步触发与结果查询端点。
 */
@Controller('sync/dingtalk')
export class DingtalkSyncController {
  constructor(private readonly syncService: DingtalkSyncService) {}

  /**
   * 触发钉钉组织同步。
   * 异步执行，立即返回 syncId。
   */
  @Roles(SysRole.hr, SysRole.system_admin)
  @Post()
  async trigger(@CurrentUser() user: AuthUser) {
    return this.syncService.runSync(user.id);
  }

  /**
   * 查询同步结果。
   */
  @Roles(SysRole.hr, SysRole.system_admin)
  @Get('result/:syncId')
  async result(@Param('syncId') syncId: string): Promise<DingtalkSyncResult> {
    const result = this.syncService.getResult(syncId);
    if (!result) {
      return {
        syncId,
        status: 'failed',
        startedAt: new Date(),
        added: 0,
        updated: 0,
        deactivated: 0,
        errors: ['同步任务不存在或已过期'],
      };
    }
    return result;
  }
}
