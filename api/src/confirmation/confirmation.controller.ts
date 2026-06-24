import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ConfirmationService } from './confirmation.service';
import { CreateConfirmationDto } from './dto/create-confirmation.dto';
import { UpdateConfirmationDto } from './dto/update-confirmation.dto';
import { ConfirmationQueryDto } from './dto/confirmation-query.dto';
import { ApproveConfirmationDto } from './dto/approve-confirmation.dto';
import { RejectConfirmationDto } from './dto/reject-confirmation.dto';

@Controller('confirmation-applications')
export class ConfirmationController {
  constructor(private readonly confirmationService: ConfirmationService) {}

  @Post()
  @Roles(SysRole.hr, SysRole.system_admin)
  create(@Body() dto: CreateConfirmationDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.create(dto, viewer);
  }

  @Get()
  @Roles(SysRole.hr, SysRole.system_admin)
  findAll(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findAll(dto, viewer);
  }

  @Get('pending')
  findPending(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findPending(dto, viewer);
  }

  @Get('mine')
  findMine(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findMine(dto, viewer);
  }

  @Get('warnings')
  @Roles(SysRole.hr, SysRole.system_admin)
  warnings(@CurrentUser() viewer: AuthUser) {
    return this.confirmationService.warnings(viewer);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findOne(id, viewer);
  }

  @Put(':id')
  @Roles(SysRole.hr, SysRole.system_admin)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateConfirmationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.update(id, dto, viewer);
  }

  @Post(':id/submit')
  @Roles(SysRole.hr, SysRole.system_admin)
  submit(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.submit(id, viewer);
  }

  @Post(':id/approve')
  approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApproveConfirmationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.approve(id, dto, viewer);
  }

  @Post(':id/reject')
  reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectConfirmationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.reject(id, dto, viewer);
  }
}
