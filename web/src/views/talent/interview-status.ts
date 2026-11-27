import { INTERVIEW_STATUS_LABELS, type TalentInterviewStatus } from '@/types/talent.types';

export function interviewStatusLabel(row: { status: TalentInterviewStatus; endsAt: string }, now = Date.now()): string {
  return row.status === 'scheduled' && Date.parse(row.endsAt) < now
    ? '待确认实际结果' : INTERVIEW_STATUS_LABELS[row.status];
}
