import http from './http';
import type { AiConfigState, AiProvider, AiProviderTestResult, SaveAiProviderBody,
  AiProgressDraft, UpdateAiProgressDraftBody, GoalTrackingLatestProgress } from '@/types/api.types';

const base = '/ai-progress/config';
const options = { skipErrorMessage: true };

export const aiProgressApi = {
  getDraft: (id: string) =>
    http.get(`/ai-progress/drafts/${encodeURIComponent(id)}`, options) as unknown as Promise<AiProgressDraft>,
  updateDraft: (id: string, body: UpdateAiProgressDraftBody) =>
    http.patch(`/ai-progress/drafts/${encodeURIComponent(id)}`, body, options) as unknown as Promise<AiProgressDraft>,
  saveDraft: (id: string) =>
    http.post(`/ai-progress/drafts/${encodeURIComponent(id)}/save`, undefined, options) as unknown as Promise<GoalTrackingLatestProgress>,
  getConfig: () => http.get(base, options) as unknown as Promise<AiConfigState>,
  saveProvider: (provider: AiProvider, body: SaveAiProviderBody) =>
    http.put(`${base}/providers/${provider}`, body, options) as unknown as Promise<AiConfigState>,
  testProvider: (provider: AiProvider) =>
    http.post(`${base}/providers/${provider}/test`, undefined, options) as unknown as Promise<AiProviderTestResult>,
  activateProvider: (provider: AiProvider) =>
    http.post(`${base}/providers/${provider}/activate`, undefined, options) as unknown as Promise<AiConfigState>,
  setBotEnabled: (enabled: boolean) =>
    http.patch(`${base}/bot`, { enabled }, options) as unknown as Promise<AiConfigState>,
  setAllowlist: (userIds: string[]) =>
    http.put(`${base}/allowlist`, { userIds }, options) as unknown as Promise<AiConfigState>,
};
