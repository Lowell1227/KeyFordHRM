import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SysRole } from '@prisma/client';
import { DepartmentsService } from './departments.service';
import { DepartmentQueryDto } from './dto/department-query.dto';
import { UpdateApproverDto } from './dto/update-approver.dto';
import { UpdateLeaderDto } from './dto/update-leader.dto';

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

  @Patch(':id/leader')
  @Roles(SysRole.system_admin)
  async updateLeader(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeaderDto,
  ) {
    return this.departmentsService.updateLeader(id, dto);
  }

  @Patch(':id/approver')
  @Roles(SysRole.system_admin)
  async updateApprover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateApproverDto,
  ) {
    return this.departmentsService.updateApprover(id, dto);
  }
}
