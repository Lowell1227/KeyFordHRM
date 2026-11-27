import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentWorkbenchService } from './talent-workbench.service';
import { PaginationDto } from '@/common/dto/pagination.dto';

@Controller('talent-recruitment')
export class TalentWorkbenchController {
  constructor(private readonly workbench: TalentWorkbenchService) {}

  @Get('workbench')
  getWorkbench(@CurrentUser() user: AuthUser) { return this.workbench.getWorkbench(user); }

  @Get('workbench/onboarding-handoff')
  listOnboardingHandoff(@Query() query: PaginationDto, @CurrentUser() user: AuthUser) {
    return this.workbench.listOnboardingHandoff(query, user);
  }
}
