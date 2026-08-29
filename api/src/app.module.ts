import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { TemplatesModule } from './templates/templates.module';
import { CyclesModule } from './cycles/cycles.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DingtalkModule } from './dingtalk/dingtalk.module';
import { TasksModule } from './tasks/tasks.module';
import { CalibrationModule } from './calibration/calibration.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { DataScopeModule } from './common/services/data-scope.module';
import { DepartmentsModule } from './departments/departments.module';
import { UsersModule } from './users/users.module';
import { ApprovalModule } from './approval/approval.module';
import { PublishModule } from './publish/publish.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ReportsModule } from './reports/reports.module';
import { AppealsModule } from './appeals/appeals.module';
import { InterviewsModule } from './interviews/interviews.module';
import { SignaturesModule } from './signatures/signatures.module';
import { StorageModule } from './storage/storage.module';
import { ImprovementPlansModule } from './improvement-plans/improvement-plans.module';
import { ProbationModule } from './probation/probation.module';
import { ConfirmationModule } from './confirmation/confirmation.module';
import { ObjectivesModule } from './objectives/objectives.module';
import { ActionItemsModule } from './action-items/action-items.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EmployeeArchivesModule } from './employee-archives/employee-archives.module';
import { PeriodReviewsModule } from './period-reviews/period-reviews.module';

/**
 * 根模块。
 * 业务模块（auth/users/departments/cycles/tasks/calibration/approval/...）
 * 按编码计划第四步逐个实现后在此注册。
 *
 * 全局守卫顺序：JwtAuthGuard（鉴权）→ RolesGuard（角色）。
 * 用 @Public() 装饰器豁免无需登录的接口（如 /auth/*、/health）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // 全局 JWT：供全局守卫与各业务模块复用（auth 模块在此基础上加登录端点）
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
    }),
    PrismaModule,
    DataScopeModule,
    DepartmentsModule,
    UsersModule,
    EmployeeArchivesModule,
    HealthModule,
    AuthModule,
    IndicatorsModule,
    TemplatesModule,
    CyclesModule,
    NotificationsModule,
    DingtalkModule,
    TasksModule,
    CalibrationModule,
    ApprovalModule,
    PublishModule,
    SchedulerModule,
    ReportsModule,
    AppealsModule,
    InterviewsModule,
    SignaturesModule,
    StorageModule,
    ImprovementPlansModule,
    ProbationModule,
    ConfirmationModule,
    ObjectivesModule,
    ActionItemsModule,
    PeriodReviewsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
