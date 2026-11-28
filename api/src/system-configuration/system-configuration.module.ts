import { Global, Module } from "@nestjs/common";
import { AiProgressModule } from "@/ai-progress/ai-progress.module";
import { RuntimeSettingsService } from "./runtime-settings.service";
import { SystemConfigurationsService } from "./system-configurations.service";
import {
  ConfigurationMailboxesController,
  DingtalkPublicConfigurationController,
  SystemConfigurationsController,
} from "./system-configurations.controller";

@Global()
@Module({
  imports: [AiProgressModule],
  controllers: [
    SystemConfigurationsController,
    ConfigurationMailboxesController,
    DingtalkPublicConfigurationController,
  ],
  providers: [RuntimeSettingsService, SystemConfigurationsService],
  exports: [RuntimeSettingsService, SystemConfigurationsService],
})
export class SystemConfigurationModule {}
