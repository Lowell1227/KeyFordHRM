import type { InterviewStatus } from './enums';

export interface InterviewQuery {
  page?: number;
  pageSize?: number;
  cycleId?: string;
  status?: InterviewStatus;
  keyword?: string;
}
