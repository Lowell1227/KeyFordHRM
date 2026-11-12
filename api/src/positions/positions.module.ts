import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { PersonnelConfigModule } from '@/personnel-config/personnel-config.module';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  imports: [PrismaModule, PersonnelConfigModule],
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
