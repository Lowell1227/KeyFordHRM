import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmployeeArchivesController } from './employee-archives.controller';
import { EmployeeArchivesService } from './employee-archives.service';
import { EmployeeRosterImportService } from './employee-roster-import.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeArchivesController],
  providers: [EmployeeArchivesService, EmployeeRosterImportService],
  exports: [EmployeeArchivesService],
})
export class EmployeeArchivesModule {}
