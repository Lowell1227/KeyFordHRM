import http from './http';
import type { AxiosResponse } from 'axios';

export type ResumeField = 'name' | 'phone' | 'email' | 'birthYear' | 'currentCompany' | 'currentPosition'
  | 'yearsOfExperience' | 'education' | 'school' | 'major' | 'appliedPosition' | 'expectCity'
  | 'expectSalaryMin' | 'expectSalaryMax';
export interface ResumeParseResult {
  fields: Partial<Record<ResumeField, string | number>>;
  reviewItems: Array<{ field: string; reason: string }>;
  source: { fileName: string; pageCount?: number };
}
export interface ResumeParseStatus { configured: boolean; enabled: boolean; provider: string; modelId: string }
export interface ResumeTask {
  id: string;
  context: string;
  status: 'processing' | 'succeeded' | 'failed' | 'timed_out';
  stage: 'recognizing' | 'extracting';
  fileName: string;
  createdAt: string;
  deadlineAt: string;
  expiresAt: string;
  message?: string;
  result?: ResumeParseResult;
}
export const talentResumeApi = {
  status(): Promise<ResumeParseStatus> {
    return http.get('/talent-resume/status', { skipErrorMessage: true }) as unknown as Promise<ResumeParseStatus>;
  },
  parse(file: File): Promise<ResumeParseResult> {
    const body = new FormData();
    body.append('file', file);
    return http.post('/talent-resume/parse', body, { timeout: 230000, skipErrorMessage: true }) as unknown as Promise<ResumeParseResult>;
  },
  current(context: string): Promise<ResumeTask | null> {
    return http.get('/talent-resume/tasks/current', { params: { context }, skipErrorMessage: true }) as unknown as Promise<ResumeTask | null>;
  },
  start(file: File, context: string): Promise<ResumeTask> {
    const body = new FormData();
    body.append('file', file);
    return http.post('/talent-resume/tasks', body, {
      headers: { 'X-Resume-Context': context }, skipErrorMessage: true,
    }) as unknown as Promise<ResumeTask>;
  },
  get(id: string): Promise<ResumeTask> {
    return http.get(`/talent-resume/tasks/${encodeURIComponent(id)}`, { skipErrorMessage: true }) as unknown as Promise<ResumeTask>;
  },
  retry(id: string): Promise<ResumeTask> {
    return http.post(`/talent-resume/tasks/${encodeURIComponent(id)}/retry`, undefined, { skipErrorMessage: true }) as unknown as Promise<ResumeTask>;
  },
  async file(id: string): Promise<Blob> {
    const response = await http.get(`/talent-resume/tasks/${encodeURIComponent(id)}/file`, {
      responseType: 'blob', skipErrorMessage: true,
    }) as unknown as AxiosResponse<Blob>;
    return response.data;
  },
  async clear(id: string): Promise<void> {
    // DELETE returns 204, not the shared JSON envelope.
    await http.delete(`/talent-resume/tasks/${encodeURIComponent(id)}`, { responseType: 'blob', skipErrorMessage: true });
  },
};
