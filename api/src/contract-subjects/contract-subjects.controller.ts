import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { ContractSubjectQueryDto, CreateContractSubjectDto, UpdateContractSubjectDto } from './contract-subjects.dto';
import { ContractSubjectsService } from './contract-subjects.service';

@Controller('contract-subjects')
@Roles(SysRole.hr, SysRole.system_admin)
export class ContractSubjectsController {
  constructor(private readonly subjects: ContractSubjectsService) {}
  @Get()
  @HrCapabilities('employee_archive_edit', 'employee_archive_review')
  findAll(@Query() query: ContractSubjectQueryDto) { return this.subjects.findAll(query); }
  @Post()
  create(@Body() input: CreateContractSubjectDto, @CurrentUser() user: AuthUser) { return this.subjects.create(input, user); }
  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: UpdateContractSubjectDto, @CurrentUser() user: AuthUser) { return this.subjects.update(id, input, user); }
}
