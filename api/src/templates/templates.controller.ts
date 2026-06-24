import { Controller, Delete, Get, Post, Put, Body, Param, Query, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { SysRole } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PaginationDto } from '@/common/dto/pagination.dto';
import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';

class TemplateQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (value === undefined ? true : value === 'true' || value === true))
  isActive = true;
}

class DeleteTemplatesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids!: string[];
}

@Controller('templates')
@Roles(SysRole.hr, SysRole.system_admin)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateTemplateDto, @CurrentUser() user: AuthUser) {
    return this.templatesService.create(dto, user);
  }

  @Get()
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.chairman, SysRole.vp, SysRole.dept_head, SysRole.manager, SysRole.employee)
  findAll(@Query() query: TemplateQueryDto) {
    return this.templatesService.findAll(query);
  }

  @Delete()
  removeMany(@Body() dto: DeleteTemplatesDto) {
    return this.templatesService.removeMany(dto.ids);
  }

  @Get(':id')
  @Roles(SysRole.system_admin, SysRole.hr, SysRole.chairman, SysRole.vp, SysRole.dept_head, SysRole.manager, SysRole.employee)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.findOne(id);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Post(':id/duplicate')
  @HttpCode(200)
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.templatesService.duplicate(id, user);
  }
}
