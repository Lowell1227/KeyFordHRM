import { Module } from '@nestjs/common';
import { ArchiveAssistantController } from './archive-assistant.controller';
import { ArchiveAssistantService } from './archive-assistant.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';
import { EmployeeRosterImportClosedGuard } from './employee-roster-import-closed.guard';
import { EmployeeDataReviewsService } from './employee-data-reviews.service';
import { EmployeeEffectiveDateService } from './employee-effective-date.service';
import { PersonnelDiagnosticsService } from './personnel-diagnostics.service';
import { EmployeeNumberService } from './employee-number.service';
import { EmployeeIdentityMatchService } from './employee-identity-match.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeArchiveIssuesController } from './employee-archive-issues.controller';
import { EmployeeArchiveIssuesService } from './employee-archive-issues.service';

@Module({
  imports: [PrismaModule],
  controllers: [ArchiveAssistantController, EmployeeArchiveIssuesController, EmployeeArchivesController],
  providers: [
    ArchiveAssistantService,
    EmployeeArchivesService,
    EmployeeRosterImportService,
    EmployeeRosterImportClosedGuard,
    EmployeeDataReviewsService,
    EmployeeEffectiveDateService,
    EmployeeNumberService,
    EmployeeIdentityMatchService,
    EmployeeOnboardingService,
    PersonnelDiagnosticsService,
    EmployeeArchiveIssuesService,
  ],
  exports: [
    ArchiveAssistantService,
    EmployeeArchivesService,
    EmployeeDataReviewsService,
    EmployeeEffectiveDateService,
    EmployeeNumberService,
    EmployeeOnboardingService,
    PersonnelDiagnosticsService,
  ],
})
export class EmployeeArchivesModule {}
