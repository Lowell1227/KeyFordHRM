import http from './http';

export type PersonnelReviewMode = 'relaxed' | 'standard';

export const personnelConfigApi = {
  getReviewMode(): Promise<{ mode: PersonnelReviewMode }> {
    return http.get('/personnel-config/review-mode') as unknown as Promise<{ mode: PersonnelReviewMode }>;
  },
  updateReviewMode(mode: PersonnelReviewMode): Promise<{ mode: PersonnelReviewMode }> {
    return http.put('/personnel-config/review-mode', { mode }) as unknown as Promise<{ mode: PersonnelReviewMode }>;
  },
};
