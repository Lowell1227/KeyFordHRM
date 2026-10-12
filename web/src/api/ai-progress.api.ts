import http from './http';
import type { AiConfigState, AiProvider, AiProviderTestResult, SaveAiProviderBody } from '@/types/api.types';

const base = '/ai-progress/config';
const options = { skipErrorMessage: true };

export const aiProgressApi = {
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
