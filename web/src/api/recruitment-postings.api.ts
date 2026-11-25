import http from './http';
import type { Paginated } from '@/types/api.types';
import type { PostingFields, PostingQuery, RecruitmentPosting } from '@/types/recruitment-intake.types';
const base = '/recruitment-postings', silent = { skipErrorMessage: true };
export const recruitmentPostingsApi = {
  list(query: PostingQuery): Promise<Paginated<RecruitmentPosting>> { return http.get(base, { ...silent, params: query }) as unknown as Promise<Paginated<RecruitmentPosting>>; },
  detail(id: string): Promise<RecruitmentPosting> { return http.get(`${base}/${encodeURIComponent(id)}`, silent) as unknown as Promise<RecruitmentPosting>; },
  create(body: PostingFields & { requestId: string }): Promise<RecruitmentPosting> { return http.post(base, body, silent) as unknown as Promise<RecruitmentPosting>; },
  update(id: string, body: Partial<PostingFields> & { expectedRevision: number; reason: string }): Promise<RecruitmentPosting> { return http.patch(`${base}/${encodeURIComponent(id)}`, body, silent) as unknown as Promise<RecruitmentPosting>; },
};
