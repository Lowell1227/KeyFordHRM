import type { TalentInterviewView } from '@/types/talent.types';
import { safeTencentMeetingLink } from './interview-meeting-link';
import { formatInterviewTime } from './interview-time';

export function interviewInvitationCopies(invitation: TalentInterviewView, origin: string) {
  const meetingUrl = safeTencentMeetingLink(invitation.meetingUrl ?? '');
  const candidate = [invitation.invitationText,
    meetingUrl && !invitation.invitationText.includes(meetingUrl) ? meetingUrl : null,
  ].filter(Boolean).join('\n');
  // Only use the authorized response; ordinary participants have no candidate/application detail.
  const interviewer = [
    '面试官邀请',
    `候选人：${invitation.candidateNameSnapshot}`,
    invitation.application?.positionName ? `应聘岗位：${invitation.application.positionName}` : null,
    `面试时间：${formatInterviewTime(invitation.startsAt)} 至 ${formatInterviewTime(invitation.endsAt)}（北京时间）`,
    meetingUrl ? `会议链接：${meetingUrl}` : null,
    `面试安排与本人反馈：${new URL(`/talent-interviews/${encodeURIComponent(invitation.id)}`, origin).href}`,
  ].filter(Boolean).join('\n');
  return { candidate, interviewer };
}
