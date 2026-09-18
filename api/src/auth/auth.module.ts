import { Module } from '@nestjs/common';
import { DingtalkModule } from '@/dingtalk/dingtalk.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BusinessCapabilitiesService } from './business-capabilities.service';
import { EmployeeArchivesModule } from '@/employee-archives/employee-archives.module';

@Module({
  imports: [DingtalkModule, EmployeeArchivesModule],
  controllers: [AuthController],
  providers: [AuthService, BusinessCapabilitiesService],
  exports: [BusinessCapabilitiesService],
})
export class AuthModule {}
