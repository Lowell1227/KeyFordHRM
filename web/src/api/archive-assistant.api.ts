import http from './http';
export interface ArchiveAssistantSaved {
  requestId: string; requestVersion: number; recordStatus: string; url: string; replayed: boolean;
}
export interface ArchiveAssistantPreview {
  employeeName: string; workLocation: string; notice: string; expiresAt: string; saved: ArchiveAssistantSaved | null;
}
export const previewStorageKey = (reference: string) => `archive-assistant:${reference}`;
export const archiveAssistantApi = {
  preview: (token: string) => http.get('/employee-archives/assistant/preview', {
    headers: { 'x-archive-preview': token }, skipErrorMessage: true,
  }) as unknown as Promise<ArchiveAssistantPreview>,
  save: (token: string) => http.post('/employee-archives/assistant/save', { token }, {
    skipErrorMessage: true,
  }) as unknown as Promise<ArchiveAssistantSaved>,
};
