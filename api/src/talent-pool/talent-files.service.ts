import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StorageService } from '@/storage/storage.service';
import type { AuthUser } from '@/common/types/auth.types';
import { TALENT_FILE_LIMIT } from './talent.constants';
import { BindTalentFileDto } from './dto/bind-talent-file.dto';
import { TalentsService } from './talents.service';

const ALLOWED_RESUME_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);

@Injectable()
export class TalentFilesService {
  constructor(
    private readonly talents: TalentsService,
    private readonly storage: StorageService,
  ) {}

  /** 把已上传的 MinIO 对象绑定为候选人简历文件。每候选人最多 3 个，超限 409。 */
  async bind(candidateId: string, input: BindTalentFileDto, operator: AuthUser) {
    await this.talents.findActive(candidateId);
    const objectKey = input.objectKey?.trim() ?? '';
    if (!objectKey.startsWith('talent-resume/')) {
      throw new BadRequestException('简历对象键无效，请通过人才库上传入口获取');
    }
    const fileName = input.fileName?.trim() ?? '';
    if (!fileName) throw new BadRequestException('请提供文件名');
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    if (!ALLOWED_RESUME_EXTENSIONS.has(ext)) {
      throw new BadRequestException('简历仅支持 PDF、DOC、DOCX、JPG、PNG');
    }
    // Fail closed: client metadata cannot prove an object exists.
    let fileSize = Number(input.fileSize);
    let mimeType = input.mimeType;
    try {
      const stat = await this.storage.statObject(objectKey);
      fileSize = Number(stat.size);
      const storedType = (stat.metaData as Record<string, string> | undefined)?.['content-type'];
      if (storedType) mimeType = storedType;
    } catch {
      throw new BadRequestException('无法核验简历文件，请重新上传后重试');
    }
    if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > 10 * 1024 * 1024) {
      throw new BadRequestException('简历文件大小无效，单个文件不能超过10MB');
    }
    const count = await this.prismaFileCount(candidateId);
    if (count >= 3) {
      throw new ConflictException({
        message: '简历文件最多 3 个，请先移除不需要的文件',
        data: { reason: TALENT_FILE_LIMIT },
      });
    }
    return this.talents.createFileRecord(candidateId, {
      objectKey,
      fileName,
      mimeType,
      fileSize,
      sortOrder: count,
      uploadedById: operator.id,
    });
  }

  /** 移除附件记录（不删 MinIO 对象，替换/删除留痕在审计日志）。 */
  async unbind(candidateId: string, fileId: string, operator: AuthUser) {
    await this.talents.findActive(candidateId);
    const file = await this.talents.findFile(candidateId, fileId);
    if (!file) throw new NotFoundException('简历文件不存在');
    await this.talents.deleteFileRecord(file.id, operator);
    return { id: file.id, removed: true };
  }

  private prismaFileCount(candidateId: string): Promise<number> {
    return this.talents.countFiles(candidateId);
  }
}
