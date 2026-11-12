import { BadRequestException, Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { StorageService } from '@/storage/storage.service';
import { TalentSharesService } from './talent-shares.service';

/**
 * 被分享人只读视图（需求 §5.4）。
 * 只要求登录；白名单 / 有效期 / 撤销 / 软删由服务层校验，
 * 不能加 HR 角色限制（被分享人是部门负责人）。
 */
@Controller('talents/shares')
export class TalentSharesController {
  constructor(
    private readonly shares: TalentSharesService,
    private readonly storage: StorageService,
  ) {}

  @Get(':token')
  view(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new BadRequestException({ message: '链接已失效或无权查看' });
    }
    return this.shares.resolve(token, user);
  }

  @Get(':token/file/:fileId')
  async downloadFile(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const objectKey = await this.shares.resolveFile(token, fileId, user);
    await this.storage.pipeDownload(objectKey, res);
  }
}
