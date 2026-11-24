import { hasHrCapability } from '@/auth/hr-capabilities';
import { Prisma } from '@prisma/client';
import { currentWorkerWhere } from '@/common/personnel/current-worker';
import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';

export const TALENT_APPLICATION_ACTIONS = [
  'start_interview', 'submit_hiring', 'approve_hiring', 'return_hiring', 'accept_offer',
  'decline_offer', 'reject', 'reserve', 'withdraw', 'reopen', 'terminate_offer',
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
  return !actor.isAssessorOnly && (hasHrCapability(actor, 'recruitment_view')
    || hasHrCapability(actor, 'employee_archive_edit') || hasHrCapability(actor, 'employee_archive_review'));
}

export function canWriteRecruitment(actor: RecruitmentActor): boolean {
  return isCurrentRecruitmentActor(actor) && hasHrCapability(actor, 'employee_archive_edit');
}

export function canEditRecruitment(actor: RecruitmentActor): boolean {
  return isCurrentRecruitmentActor(actor) && (hasHrCapability(actor, 'recruitment_edit') || hasHrCapability(actor, 'employee_archive_edit'));
}

export const recruitmentActorSelect = {
  id: true, name: true, sysRole: true, deptId: true, canViewAll: true,
  hrCapabilities: true, status: true, archivedAt: true, deletedAt: true, isAssessorOnly: true,
} satisfies Prisma.UserSelect;

async function currentRecruitmentActor(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id'>) {
  if (!user?.id) throw new ForbiddenException('当前账号不具备招聘办理资格');
  const actor = await tx.user.findUnique({ where: { id: user.id }, select: recruitmentActorSelect });
  if (!actor || !isCurrentRecruitmentActor(actor)) throw new ForbiddenException('当前账号不具备招聘办理资格');
  return actor;
}

export async function assertRecruitmentReader(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id'>) {
  const actor = await currentRecruitmentActor(tx, user);
  if (!canReadRecruitment(actor)) throw new ForbiddenException('无权限查看招聘资料');
  return actor;
}

export async function assertRecruitmentWriter(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id'>) {
  const actor = await currentRecruitmentActor(tx, user);
  if (!canWriteRecruitment(actor)) throw new ForbiddenException('无权限维护招聘资料');
  return actor;
}

export async function assertRecruitmentEditor(tx: Prisma.TransactionClient, user: Pick<AuthUser, 'id'>) {
  const actor = await currentRecruitmentActor(tx, user);
  if (!canEditRecruitment(actor)) throw new ForbiddenException('无权限经办招聘资料');
  return actor;
}

export function talentOwnerWhere(): Prisma.UserWhereInput {
  return { ...currentWorkerWhere, isAssessorOnly: false, OR: [
    { sysRole: { in: ['hr', 'system_admin'] } },
    { sysRole: 'hr_user', hrCapabilities: { has: 'employee_archive_edit' } },
    { hrCapabilities: { has: 'recruitment_edit' } },
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
  events?: ReadonlyArray<{ action: string; version: number }>;
  onboardingRequests?: ReadonlyArray<{ recordStatus: string }>;
}

export function hasActiveTalentAcceptance(events: ReadonlyArray<{ action: string; version: number }>): boolean {
  let latest: { action: string; version: number } | undefined;
  for (const event of events) {
    if (!['accept_offer', 'terminate_offer'].includes(event.action)) continue;
    if (!latest || event.version > latest.version) latest = event;
  }
  return latest?.action === 'accept_offer';
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
    if (!canEditRecruitment(actor)) return false;
    switch (action) {
      case 'start_interview': return ['screening', 'reserve'].includes(stage);
      case 'submit_hiring': return ['screening', 'interviewing'].includes(stage);
      case 'accept_offer': case 'decline_offer': return stage === 'offered';
      case 'reject': return ['screening', 'interviewing', 'reserve'].includes(stage);
      case 'reserve': return ['screening', 'interviewing'].includes(stage);
      case 'withdraw': return !['hired', 'withdrawn'].includes(stage) && !activeOnboarding && !hasActiveTalentAcceptance(application.events ?? []);
      case 'reopen': return ['rejected', 'reserve', 'declined', 'withdrawn'].includes(stage);
      case 'terminate_offer': return stage !== 'hired' && !activeOnboarding && !application.onboardingRequests?.some(request => request.recordStatus === 'effective')
        && hasActiveTalentAcceptance(application.events ?? []);
    }
  });
}

export function isFeedbackOpen(applicationStage: string | null, interviewStatus: string): boolean {
  return interviewStatus !== 'cancelled' && (applicationStage === null || ['screening', 'interviewing', 'reserve'].includes(applicationStage));
}

export function isApplicationOpenForInterview(stage: string): boolean {
  return ['screening', 'interviewing', 'reserve'].includes(stage);
}
