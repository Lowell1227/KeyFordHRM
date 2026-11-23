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

@Module({ imports: [PrismaModule, PayrollAccessModule], controllers: [PayrollController], providers: [PayrollDataService,
  PayrollSourcesService, { provide: 'PAYROLL_SOURCE_READER', useExisting: PayrollSourcesService }, PayrollBatchesService,
  RosterSensitiveExportService, PayrollExportService, PayrollParameterReleasesService] })
export class PayrollModule {}
