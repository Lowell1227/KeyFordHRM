import http from './http';
import type { Paginated, PerformanceInterview, UpdateInterviewBody, CreateInterviewBody, AssessmentCycle } from '@/types/api.types';
import type { InterviewQuery } from '@/types/interview.types';

export interface InterviewPerson { id: string; name: string; employeeNo: string | null; dept?: { name: string } | null }
export type InterviewCycle = Pick<AssessmentCycle, 'id' | 'name' | 'createdAt'>;

export const interviewsApi = {
  findAll(query?: InterviewQuery): Promise<Paginated<PerformanceInterview>> {
    return http.get('/interviews', { params: query }) as unknown as Promise<Paginated<PerformanceInterview>>;
  },
  people(keyword = ''): Promise<InterviewPerson[]> {
    return http.get('/interviews/people', { params: { keyword, pageSize: 50 } }) as unknown as Promise<InterviewPerson[]>;
  },
  cycles(): Promise<InterviewCycle[]> {
    return http.get('/interviews/cycles') as unknown as Promise<InterviewCycle[]>;
  },
  findOne(id: string): Promise<PerformanceInterview> {
    return http.get('/interviews/' + id, { skipErrorMessage: true }) as unknown as Promise<PerformanceInterview>;
  },
  create(body: CreateInterviewBody): Promise<PerformanceInterview> {
    return http.post('/interviews', body, { skipErrorMessage: true }) as unknown as Promise<PerformanceInterview>;
  },
  update(id: string, body: UpdateInterviewBody): Promise<PerformanceInterview> {
    return http.put('/interviews/' + id, body, { skipErrorMessage: true }) as unknown as Promise<PerformanceInterview>;
  },
};
