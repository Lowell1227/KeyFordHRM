import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesModule } from '@/employee-archives/employee-archives.module';
import { PersonnelDigestService } from '@/employee-archives/personnel-digest.service';
import { PayrollAccessModule } from '@/payroll/payroll-access.module';
import { PayrollParameterReleasesService } from '@/payroll/payroll-parameter-releases.service';
import { PayrollReadinessService } from '@/payroll/payroll-readiness.service';
import { PayrollSourcesService } from '@/payroll/payroll-sources.service';
import { ConfirmationModule } from '@/confirmation/confirmation.module';
import { ApprovalModule } from '@/approval/approval.module';
import { CalibrationModule } from '@/calibration/calibration.module';
import { TasksModule } from '@/tasks/tasks.module';
import { WorkbenchController } from './workbench.controller';
import { WorkbenchService } from './workbench.service';
import { PerformanceOperationsService } from './performance-operations.service';

@Module({
  imports: [PrismaModule, EmployeeArchivesModule, PayrollAccessModule, ConfirmationModule, ApprovalModule, CalibrationModule, TasksModule],
  controllers: [WorkbenchController],
  providers: [WorkbenchService, PerformanceOperationsService, PersonnelDigestService, PayrollParameterReleasesService,
    PayrollReadinessService, PayrollSourcesService, { provide: 'PAYROLL_SOURCE_READER', useExisting: PayrollSourcesService }],
})
export class WorkbenchModule {}
