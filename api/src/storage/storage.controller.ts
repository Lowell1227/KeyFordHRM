import {
  BadRequestException,
  ForbiddenException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { StorageService, UploadedFileMeta, UploadPurpose } from './storage.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthUser } from '@/common/types/auth.types';
import { hasHrCapability } from '@/auth/hr-capabilities';
import { SysRole } from '@prisma/client';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /** POST /storage/upload — 通用单文件上传，返回可持久访问的下载 URL。 */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('purpose') purpose: UploadPurpose = 'general',
    @CurrentUser() operator: AuthUser,
  ): Promise<UploadedFileMeta> {
    if (!['general', 'employee-contract-image', 'employee-contract-attachment'].includes(purpose)) {
      throw new BadRequestException({ code: 'PARAM_INVALID', message: '上传用途不正确' });
    }
    if (purpose.startsWith('employee-contract-') && !this.canAccessContractMaterials(operator)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '无权限管理合同材料' });
    }
    return this.storageService.uploadFile(file, purpose);
  }

  /** GET /storage/download?key=... — 代理下载 MinIO 对象。 */
  @Get('download')
  async download(
    @Query('key') key: string,
    @Res() res: Response,
    @CurrentUser() operator: AuthUser,
  ): Promise<void> {
    if (!key) {
      res.status(400).json({ code: 'PARAM_INVALID', message: '缺少 key 参数' });
      return;
    }
    const objectName = decodeURIComponent(key);
    if (objectName.startsWith('employee-contracts/')) {
      if (!this.canAccessContractMaterials(operator)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: '无权限访问合同材料' });
      }
    }
    await this.storageService.pipeDownload(objectName, res);
  }

  private canAccessContractMaterials(operator: AuthUser): boolean {
    return operator.sysRole === SysRole.hr
      || operator.sysRole === SysRole.system_admin
      || hasHrCapability(operator, 'employee_archive_edit')
      || hasHrCapability(operator, 'employee_archive_review');
  }
}
