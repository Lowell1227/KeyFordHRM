import type { Prisma } from '@prisma/client';

export const TALENT_APPLICATION_STAGE_LABELS = {
  screening: '初筛', interviewing: '面试中', hiring_review: '待录用确认', offered: '已确认录用', accepted: '已接受录用',
  declined: '已拒绝录用', rejected: '已淘汰', reserve: '人才储备', withdrawn: '已撤回', onboarding: '入职办理中', hired: '已入职',
} as const;
export const TALENT_APPLICATION_STAGES = Object.keys(TALENT_APPLICATION_STAGE_LABELS);

/** Position and stage must describe one application, including its historical stages. */
export function talentApplicationFilter(query: { applicationPosition?: string; applicationStage?: string }): Prisma.TalentApplicationWhereInput | undefined {
  if (!query.applicationPosition && !query.applicationStage) return undefined;
  return {
    ...(query.applicationPosition ? { positionName: query.applicationPosition } : {}),
    ...(query.applicationStage ? { stage: query.applicationStage } : {}),
  };
}
