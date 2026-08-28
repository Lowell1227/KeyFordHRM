import http from './http';
import type { Attachment } from '@/types/api.types';
import type { AxiosResponse } from 'axios';

export const uploadApi = {
  /** POST /storage/upload — 通用单文件上传。 */
  upload(file: File, purpose: 'general' | 'employee-contract-image' | 'employee-contract-attachment' = 'general'): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    return http.post('/storage/upload', formData, {
      params: { purpose },
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as unknown as Promise<Attachment>;
  },

  async download(url: string): Promise<Blob> {
    const response = await http.get(url, { responseType: 'blob' }) as unknown as AxiosResponse<Blob>;
    return response.data;
  },
};
