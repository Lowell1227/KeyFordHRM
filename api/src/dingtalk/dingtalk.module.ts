import { Global, Module } from '@nestjs/common';
import { MESSAGE_PUSH_PROVIDER } from '@/notifications/message-push.provider';
import { DingtalkService } from './dingtalk.service';
import { DingtalkAttendanceService } from './dingtalk-attendance.service';
import { DingtalkRecruitmentService } from './dingtalk-recruitment.service';
import { DingtalkBotCredentialsService } from './dingtalk-bot-credentials.service';
import { DingtalkPushProvider } from './dingtalk-push.provider';
import { InterviewCalendarService } from './interview-calendar.service';
import { InterviewCalendarDispatcher } from './interview-calendar-dispatcher';
import { InterviewCalendarReconciliationController } from './interview-calendar-reconciliation.controller';
import { InterviewCalendarReconciliationService } from './interview-calendar-reconciliation.service';

@Global()
@Module({
  controllers: [InterviewCalendarReconciliationController],
  providers: [
    DingtalkService,
    DingtalkAttendanceService,
    DingtalkRecruitmentService,
    DingtalkBotCredentialsService,
    DingtalkPushProvider,
    InterviewCalendarService,
    InterviewCalendarDispatcher,
    InterviewCalendarReconciliationService,
    {
      provide: MESSAGE_PUSH_PROVIDER,
      useClass: DingtalkPushProvider,
    },
  ],
  exports: [DingtalkService, DingtalkAttendanceService, DingtalkRecruitmentService, DingtalkBotCredentialsService, DingtalkPushProvider, MESSAGE_PUSH_PROVIDER],
})
export class DingtalkModule {}
