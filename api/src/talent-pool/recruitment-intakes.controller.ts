import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { UploadFileInterceptor } from '@/common/upload-file.interceptor';
import { TalentManagementGuard } from './talent-management.guard';
import type { AuthUser } from '@/common/types/auth.types';
import { AssociateRecruitmentIntakeDto, CloseRecruitmentIntakeDto, ConfirmRecruitmentIntakeDto, CreateRecruitmentIntakeDto, ParseRecruitmentIntakeDto, RecruitmentIntakeQueryDto, RecruitmentIntakeVersionDto, SyncRecruitmentMailboxDto, UpdateRecruitmentIntakeDto } from './recruitment-intakes.dto';
import { RecruitmentIntakesService } from './recruitment-intakes.service';

@Controller('recruitment-intakes')
@Roles(SysRole.hr,SysRole.system_admin)
@HrCapabilities('recruitment_edit','employee_archive_edit')
@UseGuards(TalentManagementGuard)
export class RecruitmentIntakesController {
  constructor(private readonly intakes: RecruitmentIntakesService) {}
  @Get() @Header('Cache-Control','no-store, private') list(@Query() query:RecruitmentIntakeQueryDto,@CurrentUser() user:AuthUser){return this.intakes.list(query,user);}
  @Post() create(@Body() input:CreateRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.create(input,user);}
  @Get('mailbox/status') @Header('Cache-Control','no-store, private') mailboxStatus(@CurrentUser() user:AuthUser){return this.intakes.mailboxStatus(user);}
  @Post('mailbox/sync') sync(@Body() input:SyncRecruitmentMailboxDto,@CurrentUser() user:AuthUser){return this.intakes.syncMailbox(input,user);}
  @Get(':id') @Header('Cache-Control','no-store, private') detail(@Param('id',new ParseUUIDPipe()) id:string,@CurrentUser() user:AuthUser){return this.intakes.detail(id,user);}
  @Patch(':id') update(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:UpdateRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.update(id,input,user);}
  @Post(':id/files') @UseInterceptors(UploadFileInterceptor('file',{fileSize:10*1024*1024,files:1,fields:1,parts:3,fieldSize:128,fieldNameSize:32,headerPairs:20}))
  upload(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:RecruitmentIntakeVersionDto,@UploadedFile() file:Express.Multer.File,@CurrentUser() user:AuthUser){return this.intakes.upload(id,input.expectedRevision,file,user);}
  @Get(':id/files/:fileId') @Header('Cache-Control','no-store, private') @Header('X-Content-Type-Options','nosniff')
  file(@Param('id',new ParseUUIDPipe()) id:string,@Param('fileId',new ParseUUIDPipe()) fileId:string,@CurrentUser() user:AuthUser){return this.intakes.file(id,fileId,user);}
  @Post(':id/parse') parse(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ParseRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.parse(id,input,user);}
  @Post(':id/confirm') confirm(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:ConfirmRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.confirm(id,input,user);}
  @Post(':id/close') close(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:CloseRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.close(id,input,user);}
  @Post(':id/associate') associate(@Param('id',new ParseUUIDPipe()) id:string,@Body() input:AssociateRecruitmentIntakeDto,@CurrentUser() user:AuthUser){return this.intakes.associate(id,input,user);}
}
