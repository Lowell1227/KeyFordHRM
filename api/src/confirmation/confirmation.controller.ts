import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ConfirmationService } from './confirmation.service';
import { CreateSelfConfirmationDto } from './dto/create-self-confirmation.dto';
import { SaveSelfConfirmationDto } from './dto/save-self-confirmation.dto';
import { ConfirmationQueryDto } from './dto/confirmation-query.dto';
import { ApproveConfirmationDto } from './dto/approve-confirmation.dto';
import { RejectConfirmationDto } from './dto/reject-confirmation.dto';
import { StorageService } from '@/storage/storage.service';
import { BackfillMeetingDateDto } from './dto/backfill-meeting-date.dto';
import { ReturnConfirmationDto } from './dto/return-confirmation.dto';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';

@Controller('confirmation-applications')
export class ConfirmationController {
  constructor(private readonly confirmationService: ConfirmationService, private readonly storageService: StorageService) {}

  @Post()
  create(@Body() dto: CreateSelfConfirmationDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.create(dto, viewer);
  }

  @Get()
  @Roles(SysRole.hr)
  @HrCapabilities('confirmation_manage')
  findAll(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findAll(dto, viewer);
  }

  @Get('assigned')
  findAssigned(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findAssigned(dto, viewer);
  }

  @Get('pending')
  findPending(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findPending(dto, viewer);
  }

  @Get('assigned-history')
  findAssignedHistory(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findAssignedHistory(dto, viewer);
  }

  @Get('mine')
  findMine(@Query() dto: ConfirmationQueryDto, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findMine(dto, viewer);
  }

  @Get('my-roster')
  myRoster(@CurrentUser() viewer: AuthUser) {
    return this.confirmationService.myRoster(viewer);
  }

  @Get('warnings')
  @Roles(SysRole.hr)
  @HrCapabilities('confirmation_manage')
  warnings(@CurrentUser() viewer: AuthUser) {
    return this.confirmationService.warnings(viewer);
  }

  @Post(':id/meeting-attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addMeetingAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.addMeetingAttachment(id, file, viewer);
  }

  @Get(':id/meeting-attachments/:attachmentId/download')
  async downloadMeetingAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
    @Res() res: Response,
    @CurrentUser() viewer: AuthUser,
  ) {
    const key = await this.confirmationService.meetingAttachmentKey(id, attachmentId, viewer);
    await this.storageService.pipeDownload(key, res);
  }

  @Put(':id/meeting-date')
  backfillMeetingDate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: BackfillMeetingDateDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.backfillMeetingDate(id, dto, viewer);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.findOne(id, viewer);
  }

  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SaveSelfConfirmationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.update(id, dto, viewer);
  }

  @Post(':id/submit')
  submit(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() viewer: AuthUser) {
    return this.confirmationService.submit(id, viewer);
  }

  @Post(':id/return')
  returnForSupplement(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReturnConfirmationDto,
    @CurrentUser() viewer: AuthUser,
  ) {
    return this.confirmationService.returnForSupplement(id, dto, viewer);
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
