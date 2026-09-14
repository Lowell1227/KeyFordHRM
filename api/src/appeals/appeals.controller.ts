import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { AppealsService } from './appeals.service';
import { AppealQueryDto } from './dto/appeal-query.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { UpdateAppealDto } from './dto/update-appeal.dto';
import { AppealsAccessGuard } from './appeals-access.guard';

/** HR 申诉台账接口。 */
@Controller('appeals')
@UseGuards(AppealsAccessGuard)
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  /** POST /appeals — HR 录入申诉记录。 */
  @Post()
  create(@Body() dto: CreateAppealDto, @CurrentUser() viewer: AuthUser) {
    return this.appealsService.create(dto, viewer);
  }

  /** GET /appeals — 列表。 */
  @Get()
  findAll(@Query() query: AppealQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.appealsService.findAll(query, viewer);
  }

  @Get('people')
  people(@Query() query: AppealQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.appealsService.people(query, viewer);
  }

  @Get('cycles')
  cycles(@CurrentUser() viewer: AuthUser) {
    return this.appealsService.cycles(viewer);
  }

  /** GET /appeals/:id — 详情。 */
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.appealsService.findOne(id, viewer);
  }

  /** PUT /appeals/:id — 补充或修订台账，不影响绩效任务。 */
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAppealDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.appealsService.update(id, dto, viewer);
  }
}
