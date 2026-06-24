import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { PaginationDto } from '@/common/dto/pagination.dto';

/** 通知接口（先提供前端需要的桩，未读逻辑后续接入真实推送日志）。 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /notifications/unread-count — 当前用户未读通知数。 */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() viewer: AuthUser) {
    // TODO: 等 notification_logs 增加 is_read 字段后改为真实计数
    return { count: 0 };
  }

  /** GET /notifications — 通知列表。 */
  @Get()
  async findAll(@Query() dto: PaginationDto, @CurrentUser() viewer: AuthUser) {
    // TODO: 接入真实通知数据
    return { items: [], total: 0, page: dto.page, pageSize: dto.pageSize };
  }

  /** PATCH /notifications/:id/read — 标记单条已读。 */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() viewer: AuthUser) {
    // TODO: 等 is_read 字段后真实更新
    return { id, read: true };
  }

  /** POST /notifications/read-all — 全部已读。 */
  @Post('read-all')
  async markAllAsRead(@CurrentUser() viewer: AuthUser) {
    // TODO: 等 is_read 字段后真实更新
    return { marked: 0 };
  }
}
