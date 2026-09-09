import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { AppealsService } from './appeals.service';
import { EmployeeResultObjectionDto } from './dto/employee-result-objection.dto';

/** 本人结果操作；独立于 HR 的申诉后台权限，归属和流转条件由服务校验。 */
@Controller('tasks')
export class EmployeeResultObjectionController {
  constructor(private readonly appealsService: AppealsService) {}

  @Post(':id/employee-disagree')
  @HttpCode(200)
  disagree(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: EmployeeResultObjectionDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.appealsService.employeeDisagree(id, dto.reason, viewer);
  }
}
