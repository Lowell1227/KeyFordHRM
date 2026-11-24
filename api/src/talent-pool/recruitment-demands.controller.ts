import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { MapRecruitmentDemandDto, RecruitmentDemandOptionsQueryDto, RecruitmentDemandQueryDto, SyncRecruitmentDemandsDto } from './recruitment-demands.dto';
import { RecruitmentDemandsService } from './recruitment-demands.service';
import { RecruitmentDemandApplicationsQueryDto, RecruitmentDemandApplicationsService } from './recruitment-demand-applications.service';

@Controller('recruitment-demands')
export class RecruitmentDemandsController {
  constructor(private readonly demands: RecruitmentDemandsService, private readonly applications: RecruitmentDemandApplicationsService) {}

  @Get() list(@Query() query: RecruitmentDemandQueryDto, @CurrentUser() user: AuthUser) { return this.demands.list(query, user); }
  @Get('status') status(@CurrentUser() user: AuthUser) { return this.demands.status(user); }
  @Get('directories') directories(@CurrentUser() user: AuthUser) { return this.demands.directories(user); }
  @Get('options') options(@Query() query: RecruitmentDemandOptionsQueryDto, @CurrentUser() user: AuthUser) { return this.demands.options(query, user); }
  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.demands.detail(id, user); }
  @Get(':id/applications') listApplications(@Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: RecruitmentDemandApplicationsQueryDto, @CurrentUser() user: AuthUser) { return this.applications.list(id, query, user); }
  @Post('sync') sync(@Body() input: SyncRecruitmentDemandsDto, @CurrentUser() user: AuthUser) { return this.demands.sync(input, user); }
  @Post(':id/refresh') refresh(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) { return this.demands.refresh(id, user); }
  @Patch(':id/mapping') map(@Param('id', new ParseUUIDPipe()) id: string, @Body() input: MapRecruitmentDemandDto, @CurrentUser() user: AuthUser) { return this.demands.map(id, input, user); }
}
