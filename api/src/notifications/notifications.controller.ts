import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('unread-count')
  getUnreadCount(@CurrentUser() viewer: AuthUser) {
    return this.notificationsService.getUnreadCount(viewer.id);
  }

  @Get()
  findAll(@Query() query: NotificationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.notificationsService.findInbox(viewer.id, query);
  }

  @Patch(':id/read')
  markAsRead(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.notificationsService.markAsRead(id, viewer.id);
  }

  @Post('read-all')
  markAllAsRead(@CurrentUser() viewer: AuthUser) {
    return this.notificationsService.markAllAsRead(viewer.id);
  }
}
