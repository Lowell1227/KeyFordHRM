import { hasHrCapability } from '@/auth/hr-capabilities';
import { Prisma } from '@prisma/client';
import { currentWorkerWhere } from '@/common/personnel/current-worker';

export const TALENT_APPLICATION_ACTIONS = [
  'start_interview', 'submit_hiring', 'approve_hiring', 'return_hiring', 'accept_offer',
  'decline_offer', 'reject', 'reserve', 'withdraw', 'reopen',
] as const;
export type TalentApplicationAction = typeof TALENT_APPLICATION_ACTIONS[number];

export const TALENT_RESERVE_REASON_LABELS = {
  commute_distance: '通勤距离', salary_expectation: '薪资期望', work_schedule: '工作制偏好', other: '其他',
} as const;
export type TalentReserveReason = keyof typeof TALENT_RESERVE_REASON_LABELS;
export const TALENT_RESERVE_REASONS = Object.keys(TALENT_RESERVE_REASON_LABELS) as TalentReserveReason[];

export interface RecruitmentActor {
  id: string;
  sysRole: string;
  hrCapabilities?: readonly string[] | null;
  status?: string;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
  isAssessorOnly?: boolean;
  canViewAll?: boolean;
}

export function isCurrentRecruitmentActor(actor: RecruitmentActor): boolean {
  return ['active', 'probation'].includes(actor.status ?? '') && !actor.archivedAt && !actor.deletedAt && !actor.isAssessorOnly;
}

export function canReadRecruitment(actor: RecruitmentActor): boolean {
  return !actor.isAssessorOnly && (hasHrCapability(actor, 'employee_archive_edit') || hasHrCapability(actor, 'employee_archive_review'));
}

export function canWriteRecruitment(actor: RecruitmentActor): boolean {
  return isCurrentRecruitmentActor(actor) && hasHrCapability(actor, 'employee_archive_edit');
}

export function talentOwnerWhere(): Prisma.UserWhereInput {
  return { ...currentWorkerWhere, isAssessorOnly: false, OR: [
    { sysRole: { in: ['hr', 'system_admin'] } },
    { sysRole: 'hr_user', hrCapabilities: { has: 'employee_archive_edit' } },
  ] };
}

export function hasTalentHiringConfirm(actor: RecruitmentActor): boolean {
  return isCurrentRecruitmentActor(actor) && (actor.sysRole === 'hr' || Boolean(actor.hrCapabilities?.includes('talent_hiring_confirm')));
}

export function canConfirmTalentHiring(actor: RecruitmentActor, requestedById: string | null): boolean {
  return hasTalentHiringConfirm(actor) && requestedById !== null && requestedById !== actor.id;
}

export interface ApplicationPolicyState {
  stage: string;
  hiringRequestedById: string | null;
  reviewReturnStage?: string | null;
}

export function canReadTalentApplication(actor: RecruitmentActor, application: ApplicationPolicyState): boolean {
  return canReadRecruitment(actor) || (application.stage === 'hiring_review' && canConfirmTalentHiring(actor, application.hiringRequestedById));
}

export function allowedApplicationActions(actor: RecruitmentActor, application: ApplicationPolicyState, activeOnboarding: boolean): TalentApplicationAction[] {
  if (!canReadTalentApplication(actor, application)) return [];
  const { stage } = application;
  return TALENT_APPLICATION_ACTIONS.filter(action => {
    if (action === 'approve_hiring' || action === 'return_hiring') {
      return stage === 'hiring_review' && canConfirmTalentHiring(actor, application.hiringRequestedById);
    }
    if (!canWriteRecruitment(actor)) return false;
    switch (action) {
      case 'start_interview': return ['screening', 'reserve'].includes(stage);
      case 'submit_hiring': return ['screening', 'interviewing'].includes(stage);
      case 'accept_offer': case 'decline_offer': return stage === 'offered';
      case 'reject': return ['screening', 'interviewing', 'reserve'].includes(stage);
      case 'reserve': return ['screening', 'interviewing'].includes(stage);
      case 'withdraw': return !['hired', 'withdrawn'].includes(stage) && !activeOnboarding;
      case 'reopen': return ['rejected', 'reserve', 'declined', 'withdrawn'].includes(stage);
    }
  });
}

export function isFeedbackOpen(applicationStage: string | null, interviewStatus: string): boolean {
  return interviewStatus !== 'cancelled' && (applicationStage === null || ['screening', 'interviewing', 'reserve'].includes(applicationStage));
}

export function isApplicationOpenForInterview(stage: string): boolean {
  return ['screening', 'interviewing', 'reserve'].includes(stage);
}
