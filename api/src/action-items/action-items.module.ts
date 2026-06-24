import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ActionItemsController } from './action-items.controller';
import { ActionItemsService } from './action-items.service';

@Module({
  imports: [PrismaModule],
  controllers: [ActionItemsController],
  providers: [ActionItemsService],
})
export class ActionItemsModule {}
