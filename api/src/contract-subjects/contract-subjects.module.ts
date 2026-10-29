import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ContractSubjectsController } from './contract-subjects.controller';
import { ContractSubjectsService } from './contract-subjects.service';
@Module({ imports: [PrismaModule], controllers: [ContractSubjectsController], providers: [ContractSubjectsService] })
export class ContractSubjectsModule {}
