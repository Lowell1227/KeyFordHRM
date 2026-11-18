import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/notifications/notifications.module';
import { GoalChangesController } from './goal-changes.controller';
import { GoalChangesService } from './goal-changes.service';

@Module({ imports: [NotificationsModule], controllers: [GoalChangesController], providers: [GoalChangesService], exports: [GoalChangesService] })
export class GoalChangesModule {}
