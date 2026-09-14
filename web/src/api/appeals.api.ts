import http from './http';
import type { Paginated, AppealRecord, AppealPerson, AppealQuery, AppealRecordBody, AssessmentCycle } from '@/types/api.types';

export type AppealCycle = Pick<AssessmentCycle, 'id' | 'name' | 'createdAt'>;

export const appealsApi = {
  findAll(query?: AppealQuery): Promise<Paginated<AppealRecord>> {
    return http.get('/appeals', { params: query }) as unknown as Promise<Paginated<AppealRecord>>;
  },
  people(keyword = ''): Promise<AppealPerson[]> {
    return http.get('/appeals/people', { params: { keyword, pageSize: 50 } }) as unknown as Promise<AppealPerson[]>;
  },
  cycles(): Promise<AppealCycle[]> {
    return http.get('/appeals/cycles') as unknown as Promise<AppealCycle[]>;
  },
  findOne(id: string): Promise<AppealRecord> {
    return http.get(`/appeals/${id}`, { skipErrorMessage: true }) as unknown as Promise<AppealRecord>;
  },
  create(body: AppealRecordBody): Promise<AppealRecord> {
    return http.post('/appeals', body, { skipErrorMessage: true }) as unknown as Promise<AppealRecord>;
  },
  update(id: string, body: AppealRecordBody): Promise<AppealRecord> {
    return http.put(`/appeals/${id}`, body, { skipErrorMessage: true }) as unknown as Promise<AppealRecord>;
  },
};
