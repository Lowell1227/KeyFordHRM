import { Body, Controller, Get, Headers, Post, ValidationPipe } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { HrCapabilities } from '@/common/decorators/hr-capabilities.decorator';
import { AuthUser } from '@/common/types/auth.types';
import { ArchiveAssistantService } from './archive-assistant.service';

export class ArchiveAssistantSaveDto {
  @IsString()
  @Length(1, 2048)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
  token!: string;
}

@Controller('employee-archives/assistant')
@HrCapabilities('employee_archive_edit')
export class ArchiveAssistantController {
  private readonly strictInput = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  constructor(private readonly assistant: ArchiveAssistantService) {}

  @Get('preview')
  preview(@Headers('x-archive-preview') token: string, @CurrentUser() viewer: AuthUser) {
    return this.assistant.preview(token, viewer);
  }

  @Post('save')
  async save(@Body() raw: Record<string, unknown>, @CurrentUser() viewer: AuthUser) {
    // Keep raw body metatype Object: the app's global permissive pipe would otherwise strip unknown fields first.
    const input = await this.strictInput.transform(raw, { type: 'body', metatype: ArchiveAssistantSaveDto });
    return this.assistant.save(input.token, viewer);
  }
}
