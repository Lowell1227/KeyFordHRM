import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { DataScopeModule } from '@/common/services/data-scope.module';
import { ObjectivesController } from './objectives.controller';
import { ObjectivesService } from './objectives.service';

@Module({
  imports: [PrismaModule, DataScopeModule],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
})
export class ObjectivesModule {}
