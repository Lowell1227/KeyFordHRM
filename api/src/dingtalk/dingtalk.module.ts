import { Global, Module } from '@nestjs/common';
import { MESSAGE_PUSH_PROVIDER } from '@/notifications/message-push.provider';
import { DingtalkService } from './dingtalk.service';
import { DingtalkSyncService } from './dingtalk-sync.service';
import { DingtalkPushProvider } from './dingtalk-push.provider';
import { DingtalkSyncController } from './sync.controller';

@Global()
@Module({
  controllers: [DingtalkSyncController],
  providers: [
    DingtalkService,
    DingtalkSyncService,
    DingtalkPushProvider,
    {
      provide: MESSAGE_PUSH_PROVIDER,
      useClass: DingtalkPushProvider,
    },
  ],
  exports: [DingtalkService, DingtalkSyncService, DingtalkPushProvider, MESSAGE_PUSH_PROVIDER],
})
export class DingtalkModule {}
