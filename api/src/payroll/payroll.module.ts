import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { RosterSensitiveExportService } from '@/users/roster-sensitive-export.service';
import { PayrollAccessModule } from './payroll-access.module';
import { PayrollController } from './payroll.controller';
import { PayrollDataService } from './payroll-data.service';
import { PayrollSourcesService } from './payroll-sources.service';
import { PayrollBatchesService } from './payroll-batches.service';
import { PayrollExportService } from './payroll-export.service';
import { PayrollParameterReleasesService } from './payroll-parameter-releases.service';
import { PayrollGrantsController } from './payroll-grants.controller';
import { PayrollGrantsService } from './payroll-grants.service';
import { DingtalkModule } from '@/dingtalk/dingtalk.module';
import { PayrollAttendanceSyncService } from './payroll-attendance-sync.service';
import { PayrollAttendanceSyncController } from './payroll-attendance-sync.controller';
import { PayrollReadinessController } from './payroll-readiness.controller';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollAbsenceController } from './payroll-absence.controller';
import { PayrollAbsenceService } from './payroll-absence.service';
import { PayrollRecoveryController } from './payroll-recovery.controller';
import { PayrollRecoveryService } from './payroll-recovery.service';

@Module({ imports: [PrismaModule, PayrollAccessModule, DingtalkModule], controllers: [PayrollController, PayrollGrantsController, PayrollAttendanceSyncController, PayrollReadinessController, PayrollAbsenceController, PayrollRecoveryController], providers: [PayrollDataService, PayrollGrantsService, PayrollAttendanceSyncService, PayrollReadinessService, PayrollAbsenceService, PayrollRecoveryService,
  PayrollSourcesService, { provide: 'PAYROLL_SOURCE_READER', useExisting: PayrollSourcesService }, PayrollBatchesService,
  RosterSensitiveExportService, PayrollExportService, PayrollParameterReleasesService] })
export class PayrollModule {}
