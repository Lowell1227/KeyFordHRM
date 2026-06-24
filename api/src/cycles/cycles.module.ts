import { Module } from '@nestjs/common';
import { CyclesController } from './cycles.controller';
import { CyclesService } from './cycles.service';
import { LaunchService } from './launch.service';
import { ExemptService } from './exempt.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { NotificationsModule } from '@/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [CyclesController],
  providers: [CyclesService, LaunchService, ExemptService],
})
export class CyclesModule {}
