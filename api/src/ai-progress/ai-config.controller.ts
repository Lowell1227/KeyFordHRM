import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { AiConfigService } from './ai-config.service';
import {
  AiProviderParamsDto,
  SaveAiProviderDto,
  SetAiAllowlistDto,
  SetAiBotEnabledDto,
} from './dto/ai-config.dto';

@Controller('ai-progress/config')
@Roles(SysRole.system_admin)
export class AiConfigController {
  constructor(private readonly config: AiConfigService) {}

  @Get()
  getState() {
    return this.config.getPublicState();
  }

  @Put('providers/:provider')
  save(
    @Param() params: AiProviderParamsDto,
    @Body() dto: SaveAiProviderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.config.saveProvider(params.provider, dto, user.id);
  }

  @Post('providers/:provider/test')
  test(@Param() params: AiProviderParamsDto, @CurrentUser() user: AuthUser) {
    return this.config.testProvider(params.provider, user.id);
  }

  @Post('providers/:provider/activate')
  activate(@Param() params: AiProviderParamsDto, @CurrentUser() user: AuthUser) {
    return this.config.activate(params.provider, user.id);
  }

  @Patch('bot')
  setBot(@Body() dto: SetAiBotEnabledDto, @CurrentUser() user: AuthUser) {
    return this.config.setBotEnabled(dto.enabled, user.id);
  }

  @Put('allowlist')
  setAllowlist(@Body() dto: SetAiAllowlistDto, @CurrentUser() user: AuthUser) {
    return this.config.setAllowlist(dto.userIds, user.id);
  }
}
