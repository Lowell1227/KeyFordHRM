import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { PayrollAccessService } from './payroll-access.service';

@Module({ imports: [PrismaModule], providers: [PayrollAccessService], exports: [PayrollAccessService] })
export class PayrollAccessModule {}
