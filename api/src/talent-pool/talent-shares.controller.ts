import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { StorageService } from '@/storage/storage.service';
import { Public } from '@/common/decorators/public.decorator';
import { TalentSharesService } from './talent-shares.service';
import { TalentShareSessionGuard } from './talent-share-session.guard';

/**
 * 被分享人只读视图（需求 §5.4）。
 * 显式外链免登录；旧分享的会话、白名单及资格由专用守卫与服务校验。
 */
@Controller('talents/shares')
@Public()
@UseGuards(TalentShareSessionGuard)
export class TalentSharesController {
  constructor(
    private readonly shares: TalentSharesService,
    private readonly storage: StorageService,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  view(@Param('token') token: string, @CurrentUser() user?: AuthUser) {
    return this.shares.resolve(token, user);
  }

  @Get(':token/file/:fileId')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async downloadFile(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Res() res: Response,
  ) {
    const objectKey = await this.shares.resolveFile(token, fileId, user);
    await this.storage.pipeDownload(objectKey, res);
  }
}
