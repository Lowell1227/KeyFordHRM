import http from './http';
import type { Paginated } from '@/types/api.types';
import type { RecruitmentDemandIntentQuery, RecruitmentDemandProgress } from '@/types/recruitment-demand.types';
import type { RecruitmentDemandApplication, RecruitmentDemandApplicationQuery, RecruitmentDemandDirectories, RecruitmentDemandLocalCreate, RecruitmentDemandLocalUpdate, RecruitmentDemandLocalCommand, RecruitmentDemandMapping, RecruitmentDemandQuery, RecruitmentDemandStatus, RecruitmentDemandSyncInput, RecruitmentDemandSyncResult, RecruitmentDemandView } from '@/types/recruitment-demand.types';

const base = '/recruitment-demands';
const localError = { skipErrorMessage: true };
export const recruitmentDemandsApi = {
  createLocal(body: RecruitmentDemandLocalCreate): Promise<RecruitmentDemandView> {
    return http.post(`${base}/local`, body, localError) as unknown as Promise<RecruitmentDemandView>;
  },
  updateLocal(id: string, body: RecruitmentDemandLocalUpdate): Promise<RecruitmentDemandView> {
    return http.patch(`${base}/${encodeURIComponent(id)}/local`, body, localError) as unknown as Promise<RecruitmentDemandView>;
  },
  localAction(id: string, body: RecruitmentDemandLocalCommand): Promise<RecruitmentDemandView> {
    return http.post(`${base}/${encodeURIComponent(id)}/local-actions`, body, localError) as unknown as Promise<RecruitmentDemandView>;
  },
  list(query: RecruitmentDemandQuery & { workQueue?: 'review' | 'returned' }): Promise<Paginated<RecruitmentDemandView>> {
    return http.get(base, { params: query, ...localError }) as unknown as Promise<Paginated<RecruitmentDemandView>>;
  },
  status(): Promise<RecruitmentDemandStatus> {
    return http.get(`${base}/status`, localError) as unknown as Promise<RecruitmentDemandStatus>;
  },
  directories(): Promise<RecruitmentDemandDirectories> {
    return http.get(`${base}/directories`, localError) as unknown as Promise<RecruitmentDemandDirectories>;
  },
  options(query: { applicationId: string; keyword?: string; page?: number; pageSize?: number }): Promise<Paginated<RecruitmentDemandView>> {
    return http.get(`${base}/options`, { params: query, ...localError }) as unknown as Promise<Paginated<RecruitmentDemandView>>;
  },
  intentOptions(query: RecruitmentDemandIntentQuery): Promise<Paginated<RecruitmentDemandView>> {
    return http.get(`${base}/intent-options`, { params: query, ...localError }) as unknown as Promise<Paginated<RecruitmentDemandView>>;
  },
  progress(id: string): Promise<RecruitmentDemandProgress> {
    return http.get(`${base}/${encodeURIComponent(id)}/progress`, localError) as unknown as Promise<RecruitmentDemandProgress>;
  },
  detail(id: string): Promise<RecruitmentDemandView> {
    return http.get(`${base}/${encodeURIComponent(id)}`, localError) as unknown as Promise<RecruitmentDemandView>;
  },
  applications(id: string, query: RecruitmentDemandApplicationQuery): Promise<Paginated<RecruitmentDemandApplication>> {
    return http.get(`${base}/${encodeURIComponent(id)}/applications`, { params: query, ...localError }) as unknown as Promise<Paginated<RecruitmentDemandApplication>>;
  },
  sync(body: RecruitmentDemandSyncInput): Promise<RecruitmentDemandSyncResult> {
    return http.post(`${base}/sync`, body, { ...localError, timeout: 60000 }) as unknown as Promise<RecruitmentDemandSyncResult>;
  },
  refresh(id: string): Promise<RecruitmentDemandView> {
    return http.post(`${base}/${encodeURIComponent(id)}/refresh`, {}, { ...localError, timeout: 60000 }) as unknown as Promise<RecruitmentDemandView>;
  },
  mapping(id: string, body: RecruitmentDemandMapping): Promise<RecruitmentDemandView> {
    return http.patch(`${base}/${encodeURIComponent(id)}/mapping`, body, localError) as unknown as Promise<RecruitmentDemandView>;
  },
};
