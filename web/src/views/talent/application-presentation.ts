import { APPLICATION_STAGE_LABELS, type TalentApplicationStage, type TalentApplicationView } from '@/types/talent.types';
import type { RecruitmentDemandDirectories, RecruitmentDemandView } from '@/types/recruitment-demand.types';

export function applicationStageLabel(row: { stage: TalentApplicationStage; offerTerminated?: boolean }) {
  return row.offerTerminated ? '录用已终止' : APPLICATION_STAGE_LABELS[row.stage];
}

export function hiringPreflightIssues(
  row: Pick<TalentApplicationView, 'deptId' | 'positionName'>,
  directories: RecruitmentDemandDirectories | null,
  demand: RecruitmentDemandView | null,
  note?: string,
): string[] {
  const issues = hiringApplicationIssues(row, directories);
  if (!demand) issues.push('请选择已批准的招聘需求');
  else if (!demand.usable) issues.push('所选招聘需求当前不可用');
  else if (demand.deptId !== row.deptId || demand.positionName !== row.positionName) issues.push('招聘需求与应聘部门、岗位不一致');
  if (note !== undefined && !note.trim()) issues.push('请填写录用意见');
  return issues;
}

export function hiringApplicationIssues(row: Pick<TalentApplicationView, 'deptId' | 'positionName'>, directories: RecruitmentDemandDirectories | null): string[] {
  const issues: string[] = [];
  if (!row.deptId) issues.push('应聘部门未填写');
  else if (directories && !directories.departments.some(dept => dept.id === row.deptId)) issues.push('应聘部门已停用或不可用');
  if (!row.positionName.trim() || (directories && !directories.positions.some(job => job.name === row.positionName))) issues.push('应聘岗位未匹配启用的岗位目录');
  return issues;
}

interface ApplicationProgress {
  stage: TalentApplicationStage;
  offerTerminated?: boolean;
  nextInterview?: { startsAt: string; endsAt?: string } | null;
  latestInterview?: { status: string } | null;
  activitySummary?: { scheduledCount: number; unsubmittedFeedbackCount: number };
}

export function applicationNextStep(row: ApplicationProgress, now = new Date()): string {
  if (row.offerTerminated) return '查看终止原因与历史';
  if (['screening', 'interviewing', 'reserve'].includes(row.stage)) {
    if (row.nextInterview) {
      if (new Date(row.nextInterview.startsAt) > now) return '等待面试，查看安排';
      return row.nextInterview.endsAt && new Date(row.nextInterview.endsAt) > now ? '面试进行中，查看安排' : '确认本场面试结果';
    }
    if (row.activitySummary?.scheduledCount) return '查看面试安排并确认结果';
    if (row.activitySummary?.unsubmittedFeedbackCount) return '查看面试结果，补齐反馈';
    if (row.latestInterview?.status === 'completed') return row.stage === 'screening' ? '核对反馈，进入面试阶段' : '核对反馈，评估录用或安排下一轮';
    return row.stage === 'screening' ? '完成初筛，进入面试阶段或安排面试' : '安排面试，或评估本次应聘结果';
  }
  return ({ hiring_review: '等待独立录用确认', offered: '记录候选人接受或拒绝', accepted: '办理入职', onboarding: '跟进入职审核与到岗',
    hired: '查看员工档案', declined: '查看拒绝原因与历史', rejected: '查看淘汰原因与历史', withdrawn: '查看撤回原因与历史' } as Record<string, string>)[row.stage] || '查看应聘详情';
}

export interface RecruitmentOnboardingPrefill { deptId?: string; positionId?: string; expectedEntryDate?: string }
export function onboardingRecruitmentPrefill(
  application: Pick<TalentApplicationView, 'stage' | 'deptId' | 'positionName' | 'expectedEntryDate' | 'recruitmentDemandSnapshot'>,
  departments: Array<{ id: string; isActive: boolean }>,
  positions: Array<{ id: string; name: string; isActive: boolean }>,
): RecruitmentOnboardingPrefill {
  if (application.stage !== 'accepted') return {};
  const result: RecruitmentOnboardingPrefill = {};
  if (application.expectedEntryDate) result.expectedEntryDate = application.expectedEntryDate.slice(0, 10);
  const snapshot = application.recruitmentDemandSnapshot;
  if (!snapshot) return result;
  if (snapshot.departmentId === application.deptId && departments.some(dept => dept.id === snapshot.departmentId && dept.isActive)) result.deptId = snapshot.departmentId;
  if (snapshot.positionName === application.positionName && positions.some(job => job.id === snapshot.positionId && job.name === snapshot.positionName && job.isActive)) result.positionId = snapshot.positionId;
  return result;
}
