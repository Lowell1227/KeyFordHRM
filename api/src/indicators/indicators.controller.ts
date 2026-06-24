import { Controller, Get, Post, Put, Body, Query, Param, UseInterceptors, UploadedFile, StreamableFile, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { IndicatorsService } from './indicators.service';
import { CreateIndicatorDto } from './dto/create-indicator.dto';
import { UpdateIndicatorDto } from './dto/update-indicator.dto';
import { IndicatorQueryDto } from './dto/indicator-query.dto';

@Controller('indicators')
export class IndicatorsController {
  constructor(private readonly indicatorsService: IndicatorsService) {}

  // 指标库列表对所有已登录用户开放：目标地图「关联指标」下拉等需要它（属参考数据）。
  // 创建 / 更新 / 导入 / 模板 / 导出仍限 hr / system_admin。
  @Get()
  async findAll(@Query() query: IndicatorQueryDto) {
    return this.indicatorsService.findAll(query);
  }

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
  @HttpCode(200)
  async create(@Body() dto: CreateIndicatorDto, @CurrentUser() user: AuthUser) {
    return this.indicatorsService.create(dto, user);
  }

  @Put(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateIndicatorDto,
  ) {
    return this.indicatorsService.update(id, dto);
  }

  @Post('import')
  @Roles(SysRole.hr, SysRole.system_admin)
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(200)
  async import(
    @UploadedFile() file: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.indicatorsService.import(file, user);
  }

  @Get('import/template')
  @Roles(SysRole.hr, SysRole.system_admin)
  async getTemplate() {
    const workbook = await this.indicatorsService.getTemplate();
    const buffer = await workbook.xlsx.writeBuffer();
    return new StreamableFile(buffer as any, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="indicators-template.xlsx"',
    });
  }

  @Get('export')
  @Roles(SysRole.hr, SysRole.system_admin)
  async export(@Query() query: IndicatorQueryDto) {
    const workbook = await this.indicatorsService.export(query);
    const buffer = await workbook.xlsx.writeBuffer();
    return new StreamableFile(buffer as any, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="indicators-export.xlsx"',
    });
  }
}
