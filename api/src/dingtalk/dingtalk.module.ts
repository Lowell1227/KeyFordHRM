import { Global, Module } from '@nestjs/common';
import { MESSAGE_PUSH_PROVIDER } from '@/notifications/message-push.provider';
import { DingtalkService } from './dingtalk.service';
import { DingtalkBotCredentialsService } from './dingtalk-bot-credentials.service';
import { DingtalkPushProvider } from './dingtalk-push.provider';

@Global()
@Module({
  providers: [
    DingtalkService,
    DingtalkBotCredentialsService,
    DingtalkPushProvider,
    {
      provide: MESSAGE_PUSH_PROVIDER,
      useClass: DingtalkPushProvider,
    },
  ],
  exports: [DingtalkService, DingtalkBotCredentialsService, DingtalkPushProvider, MESSAGE_PUSH_PROVIDER],
})
export class DingtalkModule {}
