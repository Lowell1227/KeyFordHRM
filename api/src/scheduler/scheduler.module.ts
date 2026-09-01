import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { CyclesModule } from '@/cycles/cycles.module';
import { EmployeeArchivesModule } from '@/employee-archives/employee-archives.module';

/**
 * 定时任务模块。
 * 依赖 @nestjs/schedule（已在 AppModule 通过 ScheduleModule.forRoot() 全局注册）
 * 与全局 provider：NotificationsService、PrismaService。
 */
@Module({
  imports: [CyclesModule, EmployeeArchivesModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
