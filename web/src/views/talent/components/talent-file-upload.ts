import { ElMessage } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import { uploadApi } from '@/api/upload.api';
import type { Attachment } from '@/types/api.types';
import { compressImage, isImageFile } from '@/utils/image-compress';

/** 简历文件限制（需求 §5.2）。 */
export const TALENT_MAX_FILES = 3;
export const TALENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TALENT_FILE_EXTENSIONS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];

export function talentFileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function formatTalentFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 上传接口返回的是受控下载代理 URL，从中解析对象键用于绑定。 */
export function extractTalentObjectKey(proxyUrl: string): string {
  const queryIndex = proxyUrl.indexOf('?');
  if (queryIndex < 0) return proxyUrl.replace(/^\//, '');
  const key = new URLSearchParams(proxyUrl.slice(queryIndex + 1)).get('key');
  return (key ?? proxyUrl).replace(/^\//, '');
}

/**
 * 压缩（图片）→ 类型/大小校验 → 上传 → 绑定到候选人。
 * 单个文件失败只提示不中断批量；返回是否成功绑定。
 */
export async function uploadAndBindTalentFile(candidateId: string, original: File): Promise<boolean> {
  const ext = talentFileExtension(original.name);
  if (!TALENT_FILE_EXTENSIONS.includes(ext)) {
    ElMessage.error(`不支持的文件类型：${original.name}（仅支持 PDF/DOC/DOCX/JPG/PNG）`);
    return false;
  }
  const file = isImageFile(original) ? await compressImage(original) : original;
  if (file.size > TALENT_MAX_FILE_BYTES) {
    ElMessage.error(`${file.name} 超过 10MB，请压缩后重试`);
    return false;
  }
  const uploaded = await uploadApi.upload(file, 'talent-resume') as Attachment & { size?: number };
  await talentPoolApi.bindFile(candidateId, {
    objectKey: extractTalentObjectKey(uploaded.url),
    fileName: file.name,
    mimeType: uploaded.mimeType ?? file.type,
    fileSize: uploaded.size ?? file.size,
  });
  return true;
}
