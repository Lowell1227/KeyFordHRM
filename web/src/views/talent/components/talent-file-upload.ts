import { ElMessage } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import { uploadApi } from '@/api/upload.api';
import type { Attachment } from '@/types/api.types';
import type { TalentResumeFile } from '@/types/talent.types';
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

export interface TalentFileUploadState {
  uploaded?: Attachment & { size?: number };
  file?: File;
  preparing?: Promise<File>;
  bound?: TalentResumeFile;
}

export async function prepareTalentFile(original: File, state: TalentFileUploadState = {}): Promise<File> {
  if (state.file) return state.file;
  if (!state.preparing) {
    state.preparing = (isImageFile(original) ? compressImage(original) : Promise.resolve(original))
      .then(file => { state.file = file; return file; })
      .finally(() => { delete state.preparing; });
  }
  return state.preparing;
}

/** 压缩结果与上传对象可复用于解析和失败续传；返回是否成功绑定。 */
export async function uploadAndBindTalentFile(candidateId: string, original: File,
  state: TalentFileUploadState = {}, isCurrent: () => boolean = () => true): Promise<boolean> {
  const ext = talentFileExtension(original.name);
  if (!TALENT_FILE_EXTENSIONS.includes(ext)) {
    ElMessage.error(`不支持的文件类型：${original.name}（仅支持 PDF/DOC/DOCX/JPG/PNG）`);
    return false;
  }
  if (!isCurrent()) return false;
  if (state.bound?.candidateId === candidateId) return true;
  const file = await prepareTalentFile(original, state);
  if (file.size > TALENT_MAX_FILE_BYTES) {
    ElMessage.error(`${file.name} 超过 10MB，请压缩后重试`);
    return false;
  }
  if (!isCurrent()) return false;
  const uploaded = state.uploaded ?? await uploadApi.upload(file, 'talent-resume') as Attachment & { size?: number };
  state.uploaded = uploaded;
  if (!isCurrent()) return false;
  state.bound = await talentPoolApi.bindFile(candidateId, {
    objectKey: extractTalentObjectKey(uploaded.url),
    fileName: file.name,
    mimeType: uploaded.mimeType ?? file.type,
    fileSize: uploaded.size ?? file.size,
  }) as unknown as TalentResumeFile;
  return true;
}
