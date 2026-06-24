import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { AppealsService } from './appeals.service';
import { AppealQueryDto } from './dto/appeal-query.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { ResolveAppealDto } from './dto/resolve-appeal.dto';

/** 申诉记录后台接口（全部限定 HR / system_admin）。 */
@Controller('appeals')
@Roles(SysRole.hr, SysRole.system_admin)
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  /** POST /appeals — HR 录入申诉记录。 */
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateAppealDto, @CurrentUser() viewer: AuthUser) {
    return this.appealsService.create(dto, viewer);
  }

  /** GET /appeals — 列表。 */
  @Get()
  findAll(@Query() query: AppealQueryDto) {
    return this.appealsService.findAll(query, query);
  }

  @Get('mine')
  mineDeprecated() {
    throw new NotFoundException();
  }

  @Post(':id/dept-resolve')
  @HttpCode(404)
  deptResolveDeprecated() {
    throw new NotFoundException();
  }

  @Post(':id/withdraw')
  @HttpCode(404)
  withdrawDeprecated() {
    throw new NotFoundException();
  }

  /** GET /appeals/:id — 详情。 */
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.appealsService.findOne(id);
  }

  /** POST /appeals/:id/resolve — HR 录入处理结论。 */
  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResolveAppealDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.appealsService.resolve(id, dto, viewer);
  }
}
