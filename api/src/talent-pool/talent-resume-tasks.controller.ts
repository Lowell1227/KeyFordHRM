import { Controller, Delete, Get, Header, Headers, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { UploadFileInterceptor } from '@/common/upload-file.interceptor';
import { RESUME_LIMITS } from './talent-resume-client';
import { TalentResumeTasksService } from './talent-resume-tasks.service';

@Controller('talent-resume/tasks')
@Roles(SysRole.hr, SysRole.system_admin)
@HrCapabilities('employee_archive_edit')
export class TalentResumeTasksController {
  constructor(private readonly tasks: TalentResumeTasksService) {}

  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(UploadFileInterceptor('file', {
    fileSize: RESUME_LIMITS.fileBytes, files: 1, fields: 0, parts: 2, fieldNameSize: 32, headerPairs: 20,
  }))
  start(@UploadedFile() file: Express.Multer.File | undefined, @Headers('x-resume-context') context: string,
    @CurrentUser() user: AuthUser) { return this.tasks.start(file, context, user); }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  current(@Query('context') context: string, @CurrentUser() user: AuthUser) { return this.tasks.current(context, user); }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.tasks.get(id, user); }

  @Post(':id/retry')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  retry(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.tasks.retry(id, user); }

  @Get(':id/file')
  @Header('Cache-Control', 'no-store')
  async file(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const file = await this.tasks.file(id, user);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', 'attachment');
    response.type('application/octet-stream').send(file.buffer);
  }

  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  clear(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.tasks.clear(id, user); }
}
