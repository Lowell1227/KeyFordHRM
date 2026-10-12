import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { ObjectivesModule } from '@/objectives/objectives.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';
import { ProviderClient } from './provider-client';

@Module({
  imports: [PrismaModule, AuthModule, ObjectivesModule],
  controllers: [AiConfigController],
  providers: [AiConfigService, ProviderClient],
  exports: [AiConfigService, ProviderClient],
})
export class AiProgressModule {}
