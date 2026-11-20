import type { TalentApplicationView } from '@/types/talent.types';

export type InterviewApplication = Pick<TalentApplicationView, 'id' | 'positionName' | 'recruitmentBatch'>;

export function interviewApplicationLabel(application: Omit<InterviewApplication, 'id'> | null | undefined) {
  return application ? [application.positionName, application.recruitmentBatch].filter(Boolean).join(' · ') : '未关联应聘记录';
}
