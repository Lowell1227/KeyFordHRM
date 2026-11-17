import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { LegacyTaskAttachmentsService } from './legacy-task-attachments.service';

@Module({
  controllers: [StorageController],
  providers: [StorageService, LegacyTaskAttachmentsService],
  exports: [StorageService, LegacyTaskAttachmentsService],
})
export class StorageModule {}
