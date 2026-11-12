import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { PersonnelConfigController } from './personnel-config.controller';
import { PersonnelConfigService } from './personnel-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [PersonnelConfigController],
  providers: [PersonnelConfigService],
  exports: [PersonnelConfigService],
})
export class PersonnelConfigModule {}
