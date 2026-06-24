import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import type { BucketItemStat } from 'minio';

export interface UploadedFileMeta {
  name: string;
  url: string;
  size: number;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: Minio.Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endPoint = this.config.getOrThrow<string>('MINIO_ENDPOINT');
    const port = parseInt(this.config.get<string>('MINIO_PORT', '9000'), 10);
    const useSSL = this.config.get<string>('MINIO_USE_SSL', 'false') === 'true';
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');

    this.client = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** 上传单个文件到 MinIO，返回可供前端下载的代理 URL。 */
  async uploadFile(file: Express.Multer.File): Promise<UploadedFileMeta> {
    this.assertFileValid(file);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const objectName = `uploads/${today}/${randomUUID()}-${file.originalname}`;

    await this.client.putObject(this.bucket, objectName, file.buffer, file.size, {
      'Content-Type': file.mimetype || 'application/octet-stream',
    });

    return {
      name: file.originalname,
      url: `/storage/download?key=${encodeURIComponent(objectName)}`,
      size: file.size,
    };
  }

  /** 获取 MinIO 对象的预签名下载 URL（供后端内部跳转或日志使用）。 */
  async getPresignedUrl(objectName: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectName, expirySeconds);
  }

  /** 返回对象在 MinIO 中的元信息，用于验收核对。 */
  async statObject(objectName: string): Promise<BucketItemStat> {
    return this.client.statObject(this.bucket, objectName);
  }

  /** 流式返回对象内容到响应。 */
  async pipeDownload(objectName: string, res: any): Promise<void> {
    const stat = await this.client.statObject(this.bucket, objectName);
    const stream = await this.client.getObject(this.bucket, objectName);

    const originalName = this.extractOriginalFilename(objectName);
    res.setHeader('Content-Type', stat.metaData?.['content-type'] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    stream.pipe(res);
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
    }
  }

  private extractOriginalFilename(objectName: string): string {
    const basename = objectName.slice(objectName.lastIndexOf('/') + 1);
    // objectName: uploads/yyyy/mm/dd/{uuid}-{originalName}
    // uuid 长度 36，加上分隔符 '-' 共 37 位前缀
    return basename.length > 37 ? basename.slice(37) : basename;
  }

  private assertFileValid(file: Express.Multer.File): void {
    if (!file || !file.buffer) {
      throw new BadRequestException({ code: 'PARAM_INVALID', message: '请上传文件' });
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException({ code: 'PARAM_INVALID', message: '文件大小不能超过 20MB' });
    }

    const ext = file.originalname?.toLowerCase().slice(file.originalname.lastIndexOf('.')) ?? '';
    const mimeOk = file.mimetype && ALLOWED_MIME_TYPES.has(file.mimetype);
    const extOk = ALLOWED_EXTENSIONS.has(ext);
    if (!mimeOk && !extOk) {
      throw new BadRequestException({
        code: 'PARAM_INVALID',
        message: `不支持的文件类型：${ext || file.mimetype}`,
      });
    }
  }
}
