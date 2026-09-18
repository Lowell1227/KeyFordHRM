import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeArchivesController],
  providers: [
    EmployeeArchivesService,
    EmployeeRosterImportService,
    EmployeeDataReviewsService,
    EmployeeEffectiveDateService,
    EmployeeNumberService,
    EmployeeIdentityMatchService,
    EmployeeOnboardingService,
    PersonnelDiagnosticsService,
  ],
  exports: [
    EmployeeArchivesService,
    EmployeeDataReviewsService,
    EmployeeEffectiveDateService,
    EmployeeNumberService,
    EmployeeOnboardingService,
    PersonnelDiagnosticsService,
  ],
})
export class EmployeeArchivesModule {}
