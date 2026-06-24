import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { PublishService } from './publish.service';
import { PublishCycleDto } from './dto/publish-cycle.dto';

@Controller('cycles/:id')
@Roles(SysRole.hr, SysRole.system_admin)
export class PublishController {
  constructor(private readonly publishService: PublishService) {}

  /** POST /cycles/:id/publish — 结果公示发布。 */
  @Post('publish')
  @HttpCode(200)
  publish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: PublishCycleDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.publishService.publishCycle(id, dto, viewer);
  }
}
