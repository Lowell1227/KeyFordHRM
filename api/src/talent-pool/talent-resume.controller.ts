import { Controller, Get, Header, HttpCode, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { UploadFileInterceptor } from '@/common/upload-file.interceptor';
import { RESUME_LIMITS } from './talent-resume-client';
import { TalentResumeService } from './talent-resume.service';
import { TalentManagementGuard } from './talent-management.guard';

@Controller('talent-resume')
@Roles(SysRole.hr, SysRole.system_admin)
@HrCapabilities('recruitment_edit', 'employee_archive_edit')
@UseGuards(TalentManagementGuard)
export class TalentResumeController {
  constructor(private readonly resumes: TalentResumeService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  getStatus(@CurrentUser() user: AuthUser) { return this.resumes.getStatus(user); }

  @Post('parse')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(UploadFileInterceptor('file', {
    // Busboy emits partsLimit at equality; files/fields enforce one file and no form fields.
    fileSize: RESUME_LIMITS.fileBytes, files: 1, fields: 0, parts: 2, fieldNameSize: 32, headerPairs: 20,
  }))
  parse(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    return this.resumes.parse(file, user);
  }
}
