import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SysRole } from '@prisma/client';
import { DepartmentsService } from './departments.service';
import { DepartmentQueryDto } from './dto/department-query.dto';
import { UpdateApproverDto } from './dto/update-approver.dto';
import { UpdateLeaderDto } from './dto/update-leader.dto';
import { UpdateDepartmentStructureDto } from './dto/update-department-structure.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { MergeDepartmentDto } from './dto/merge-department.dto';
import { DepartmentChangeReviewQueryDto, RejectDepartmentChangeDto } from './dto/department-change-review.dto';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  async findAll(@Query() query: DepartmentQueryDto) {
    return this.departmentsService.findAll(query);
  }

  @Get('tree')
  async getTree() {
    return this.departmentsService.findAll({});
  }

  @Get('change-requests')
  @Roles(SysRole.hr, SysRole.system_admin)
  async findChangeRequests(@Query() query: DepartmentChangeReviewQueryDto) {
    return this.departmentsService.findChangeRequests(query);
  }

  @Post('change-requests/:requestId/approve')
  @Roles(SysRole.hr, SysRole.system_admin)
  async approveChange(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.approveChange(requestId, operator);
  }

  @Post('change-requests/:requestId/reject')
  @Roles(SysRole.hr, SysRole.system_admin)
  async rejectChange(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() dto: RejectDepartmentChangeDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.rejectChange(requestId, dto.reason, operator);
  }

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.create(dto, operator);
  }

  @Patch(':id/leader')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async updateLeader(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeaderDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.updateStructure(id, { leaderId: dto.leaderId }, operator);
  }

  @Patch(':id/approver')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async updateApprover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateApproverDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.updateStructure(id, { approverId: dto.approverId }, operator);
  }

  @Patch(':id/structure')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async updateStructure(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDepartmentStructureDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.updateStructure(id, dto, operator);
  }

  @Post(':id/merge')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async merge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MergeDepartmentDto,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.merge(id, dto, operator);
  }

  @Delete(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  @HrCapabilities('organization_edit')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() operator: AuthUser,
  ) {
    return this.departmentsService.remove(id, operator);
  }
}
