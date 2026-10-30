import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { PersonnelReferenceDataController } from './personnel-reference-data.controller';
import { PersonnelReferenceDataGuard } from './personnel-reference-data.guard';
import { PersonnelReferenceDataService } from './personnel-reference-data.service';

@Module({
  imports: [PrismaModule],
  controllers: [PersonnelReferenceDataController],
  providers: [PersonnelReferenceDataService, PersonnelReferenceDataGuard],
})
export class PersonnelReferenceDataModule {}
