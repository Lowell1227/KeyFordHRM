import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ConfirmationController } from './confirmation.controller';
import { ConfirmationService } from './confirmation.service';
import { StorageModule } from '@/storage/storage.module';
import { DataScopeModule } from '@/common/services/data-scope.module';

@Module({
  imports: [PrismaModule, StorageModule, DataScopeModule],
  controllers: [ConfirmationController],
  providers: [ConfirmationService],
  exports: [ConfirmationService],
})
export class ConfirmationModule {}
