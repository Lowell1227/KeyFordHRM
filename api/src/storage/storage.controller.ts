import {
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
import { StorageService, UploadedFileMeta } from './storage.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /** POST /storage/upload — 通用单文件上传，返回可持久访问的下载 URL。 */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File): Promise<UploadedFileMeta> {
    return this.storageService.uploadFile(file);
  }

  /** GET /storage/download?key=... — 代理下载 MinIO 对象。 */
  @Get('download')
  async download(@Query('key') key: string, @Res() res: Response): Promise<void> {
    if (!key) {
      res.status(400).json({ code: 'PARAM_INVALID', message: '缺少 key 参数' });
      return;
    }
    const objectName = decodeURIComponent(key);
    await this.storageService.pipeDownload(objectName, res);
  }
}
