import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CreatePositionDto,
  PositionChangeReviewQueryDto,
  PositionQueryDto,
  RejectPositionChangeDto,
  UpdatePositionDto,
} from './dto/position.dto';
import { PositionsService } from './positions.service';

@Controller('positions')
@Roles(SysRole.hr, SysRole.system_admin)
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  findAll(@Query() query: PositionQueryDto) {
    return this.positions.findAll(query);
  }

  @Get('change-requests')
  @HrCapabilities('employee_archive_review')
  findChangeRequests(@Query() query: PositionChangeReviewQueryDto) {
    return this.positions.findChangeRequests(query);
  }

  @Post('change-requests/:requestId/approve')
  @HrCapabilities('employee_archive_review')
  approve(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.positions.approve(requestId, operator);
  }

  @Post('change-requests/:requestId/reject')
  @HrCapabilities('employee_archive_review')
  reject(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: RejectPositionChangeDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.positions.reject(requestId, dto.reason, operator);
  }

  @Post()
  @HrCapabilities('organization_edit')
  create(@Body() dto: CreatePositionDto, @CurrentUser() operator: AuthUser) {
    return this.positions.create(dto, operator);
  }

  @Patch(':id')
  @HrCapabilities('organization_edit')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.positions.update(id, dto, operator);
  }

  @Delete(':id')
  @HrCapabilities('organization_edit')
  deactivate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.positions.deactivate(id, operator);
  }
}
