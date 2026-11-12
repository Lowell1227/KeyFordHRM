import { Body, Controller, Get, Put } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PersonnelConfigService } from './personnel-config.service';
import { UpdateReviewModeDto } from './dto/personnel-config.dto';

@Controller('personnel-config')
export class PersonnelConfigController {
  constructor(private readonly personnelConfig: PersonnelConfigService) {}

  @Get('review-mode')
  getReviewMode() {
    return this.personnelConfig.getReviewMode().then(mode => ({ mode }));
  }

  @Put('review-mode')
  @Roles(SysRole.system_admin)
  updateReviewMode(@Body() dto: UpdateReviewModeDto, @CurrentUser() operator: AuthUser) {
    return this.personnelConfig.setReviewMode(dto.mode, operator.id);
  }
}
