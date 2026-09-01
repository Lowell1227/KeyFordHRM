import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeArchivesController],
  providers: [EmployeeArchivesService, EmployeeRosterImportService, EmployeeDataReviewsService, EmployeeEffectiveDateService, PersonnelDiagnosticsService],
  exports: [EmployeeArchivesService, EmployeeDataReviewsService, EmployeeEffectiveDateService, PersonnelDiagnosticsService],
})
export class EmployeeArchivesModule {}
