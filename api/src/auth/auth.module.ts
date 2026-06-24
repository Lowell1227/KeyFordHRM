import { Module } from '@nestjs/common';
import { DingtalkModule } from '@/dingtalk/dingtalk.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [DingtalkModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
