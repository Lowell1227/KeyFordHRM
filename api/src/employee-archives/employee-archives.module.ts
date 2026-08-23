import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeArchivesController],
  providers: [EmployeeArchivesService, EmployeeRosterImportService, EmployeeDataReviewsService],
  exports: [EmployeeArchivesService, EmployeeDataReviewsService],
})
export class EmployeeArchivesModule {}
