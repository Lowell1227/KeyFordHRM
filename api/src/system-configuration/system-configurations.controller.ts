import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { SysRole } from "@prisma/client";
import { Roles } from "@/common/decorators/roles.decorator";
import { Public } from "@/common/decorators/public.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import {
  SaveConfiguration,
  SystemConfigurationsService,
  VerifyConfiguration,
} from "./system-configurations.service";

@Controller("system/configurations")
@Roles(SysRole.system_admin)
export class SystemConfigurationsController {
  constructor(private readonly service: SystemConfigurationsService) {}
  @Get(":id")
  @Header("Cache-Control", "no-store, private")
  get(@Param("id") id: string, @CurrentUser("id") actorId: string) {
    return this.service.get(id, actorId);
  }
  @Put(":id")
  save(
    @Param("id") id: string,
    @Body() dto: SaveConfiguration,
    @CurrentUser("id") actorId: string,
  ) {
    return this.service.save(id, dto, actorId);
  }
  @Post(":id/test")
  test(
    @Param("id") id: string,
    @Body() dto: VerifyConfiguration,
    @CurrentUser("id") actorId: string,
  ) {
    return this.service.test(id, dto, actorId);
  }
  @Post(":id/apply")
  apply(
    @Param("id") id: string,
    @Body() dto: VerifyConfiguration,
    @CurrentUser("id") actorId: string,
  ) {
    return this.service.apply(id, dto, actorId);
  }
}
@Controller("system/configuration-mailboxes")
@Roles(SysRole.system_admin)
export class ConfigurationMailboxesController {
  constructor(private readonly service: SystemConfigurationsService) {}
  @Get()
  @Header("Cache-Control", "no-store, private")
  list(@CurrentUser("id") actorId: string) {
    return this.service.mailboxes(actorId);
  }
  @Post()
  create(@CurrentUser("id") actorId: string) {
    return this.service.createMailbox(actorId);
  }
}
@Controller("auth/dingtalk")
export class DingtalkPublicConfigurationController {
  constructor(private readonly service: SystemConfigurationsService) {}
  @Get("config")
  @Public()
  @Header("Cache-Control", "no-store")
  get() {
    return this.service.publicLogin();
  }
}
