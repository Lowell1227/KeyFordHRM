import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { OperationsQueryDto } from './operations.dto';
import { WorkbenchService } from './workbench.service';

@Controller('workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @Get('operations')
  @Header('Cache-Control', 'no-store, private')
  operations(@CurrentUser() actor: AuthUser, @Query() query: OperationsQueryDto) {
    return this.workbench.operations(actor, query);
  }
}
