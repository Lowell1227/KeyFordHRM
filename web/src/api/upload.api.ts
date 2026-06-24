import http from './http';
import type { Attachment } from '@/types/api.types';

export const uploadApi = {
  /** POST /storage/upload — 通用单文件上传。 */
  upload(file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    return http.post('/storage/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as unknown as Promise<Attachment>;
  },
};
