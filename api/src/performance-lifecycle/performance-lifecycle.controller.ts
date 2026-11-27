import { UseFilters } from '@nestjs/common';
import { PerformanceLifecycleExceptionFilter } from '@/performance-lifecycle/lifecycle-exception.filter';
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { LifecycleMutationDto } from './lifecycle.dto';
import { LifecycleKind, LIFECYCLE_KINDS } from './lifecycle-policy';
import { PerformanceLifecycleService } from './performance-lifecycle.service';

@UseFilters(PerformanceLifecycleExceptionFilter)
@Controller('performance-lifecycle')
export class PerformanceLifecycleController {
  constructor(private readonly service: PerformanceLifecycleService) {}
  private kind(value: string): LifecycleKind {
    if (!(LIFECYCLE_KINDS as readonly string[]).includes(value)) throw new BadRequestException('记录类型无效');
    return value as LifecycleKind;
  }
  @Get(':kind/:id')
  findOne(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer: AuthUser) {
    return this.service.findOne(this.kind(kind), id, viewer);
  }
  @Post(':kind/:id/terminate')
  terminate(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() input: LifecycleMutationDto, @CurrentUser() viewer: AuthUser) {
    return this.service.mutate(this.kind(kind), id, 'terminate', input, viewer);
  }
  @Post(':kind/:id/delete')
  delete(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() input: LifecycleMutationDto, @CurrentUser() viewer: AuthUser) {
    return this.service.mutate(this.kind(kind), id, 'delete', input, viewer);
  }
}
