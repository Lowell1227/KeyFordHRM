import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentWorkbenchService } from './talent-workbench.service';

@Controller('talent-recruitment')
export class TalentWorkbenchController {
  constructor(private readonly workbench: TalentWorkbenchService) {}

  @Get('workbench')
  getWorkbench(@CurrentUser() user: AuthUser) { return this.workbench.getWorkbench(user); }
}
