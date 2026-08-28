import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import type { BucketItemStat } from 'minio';
import JSZip from 'jszip';

export interface UploadedFileMeta {
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export type UploadPurpose = 'general' | 'employee-contract-image' | 'employee-contract-attachment';

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
  async uploadFile(file: Express.Multer.File, purpose: UploadPurpose = 'general'): Promise<UploadedFileMeta> {
    const safeMimeType = await this.assertFileValid(file, purpose);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const prefix = purpose === 'employee-contract-image'
      ? 'employee-contracts/images'
      : purpose === 'employee-contract-attachment'
        ? 'employee-contracts/attachments'
        : 'uploads';
    const safeOriginalName = file.originalname.replace(/[\\/]/g, '_');
    const objectName = `${prefix}/${today}/${randomUUID()}-${safeOriginalName}`;

    await this.client.putObject(this.bucket, objectName, file.buffer, file.size, {
      'Content-Type': safeMimeType,
    });

    return {
      name: file.originalname,
      url: `/storage/download?key=${encodeURIComponent(objectName)}`,
      size: file.size,
      mimeType: safeMimeType,
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const disposition = objectName.startsWith('employee-contracts/') ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(originalName)}`);
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

  private async assertFileValid(file: Express.Multer.File, purpose: UploadPurpose): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException({ code: 'PARAM_INVALID', message: '请上传文件' });
    }
    if (purpose === 'employee-contract-image') {
      if (file.size > 2 * 1024 * 1024) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同图片单张不能超过 2MB' });
      }
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同图片仅支持 JPG、PNG、WEBP' });
      }
      const safeMimeType = this.contractImageMime(file.buffer, ext);
      if (!safeMimeType) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同图片文件内容与格式不符' });
      }
      return safeMimeType;
    }
    if (purpose === 'employee-contract-attachment') {
      if (file.size > 10 * 1024 * 1024) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同附件单个不能超过 10MB' });
      }
      const allowed = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      if (!allowed.includes(file.mimetype) && !['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同附件仅支持 PDF、DOC、DOCX、XLS、XLSX' });
      }
      const safeMimeType = await this.contractAttachmentMime(file.buffer, ext);
      if (!safeMimeType) {
        throw new BadRequestException({ code: 'PARAM_INVALID', message: '合同附件文件内容与格式不符' });
      }
      return safeMimeType;
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
    return this.safeMimeForExtension(ext) ?? (mimeOk ? file.mimetype : 'application/octet-stream');
  }

  private contractImageMime(buffer: Buffer, ext: string): string | null {
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if ((ext === '.jpg' || ext === '.jpeg') && isJpeg) return 'image/jpeg';
    if (ext === '.png' && isPng) return 'image/png';
    if (ext === '.webp' && isWebp) return 'image/webp';
    return null;
  }

  private async contractAttachmentMime(buffer: Buffer, ext: string): Promise<string | null> {
    const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    const isOle = buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const isZip = buffer.length >= 4
      && buffer[0] === 0x50 && buffer[1] === 0x4b
      && ((buffer[2] === 0x03 && buffer[3] === 0x04)
        || (buffer[2] === 0x05 && buffer[3] === 0x06)
        || (buffer[2] === 0x07 && buffer[3] === 0x08));
    if (ext === '.pdf' && isPdf) return 'application/pdf';
    if (ext === '.doc' && isOle) return 'application/msword';
    if (ext === '.xls' && isOle) return 'application/vnd.ms-excel';
    if ((ext === '.docx' || ext === '.xlsx') && isZip) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const entries = Object.keys(zip.files);
        const hasContentTypes = entries.includes('[Content_Types].xml');
        if (ext === '.docx' && hasContentTypes && entries.some((name) => name.startsWith('word/'))) {
          return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
        if (ext === '.xlsx' && hasContentTypes && entries.some((name) => name.startsWith('xl/'))) {
          return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private safeMimeForExtension(ext: string): string | null {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain; charset=utf-8',
    };
    return mimeTypes[ext] ?? null;
  }
}
