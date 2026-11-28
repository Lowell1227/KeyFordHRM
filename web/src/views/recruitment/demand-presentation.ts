import type { RecruitmentDemandLocalAction, RecruitmentDemandSourceKind, RecruitmentDemandSourceState, RecruitmentDemandTrackingState, RecruitmentDemandView } from '@/types/recruitment-demand.types';

export const DEMAND_SOURCE_LABELS: Record<RecruitmentDemandSourceState, string> = {
  draft: '草稿', pending: '审批中', approved: '已批准', rejected: '已拒绝 / 退回', withdrawn: '已撤销', unknown: '状态待核实',
};
export const LOCAL_DEMAND_ACTION_LABELS: Record<RecruitmentDemandLocalAction, string> = {
  submit: '提交审核', submit_approve: '提交并通过', approve: '审核通过', return: '退回修改', withdraw: '撤销需求',
};
export const DEMAND_TRACKING_LABELS: Record<RecruitmentDemandTrackingState, string> = {
  recruiting: '招聘中', filled: '已招满', paused: '暂停招聘', cancelled: '取消招聘',
};
type DemandOrigin = { sourceKind?: RecruitmentDemandSourceKind; instanceId?: string | null; id?: string; demandId?: string };
export function isLocalDemand(value: DemandOrigin | null | undefined): boolean { return value?.sourceKind === 'local'; }
export function demandOriginLabel(value: DemandOrigin): string { return isLocalDemand(value) ? 'HRM录入' : '钉钉同步'; }
export function demandReference(value: DemandOrigin): string {
  return isLocalDemand(value) ? `系统需求 ${value.demandId || value.id || ''}`.trim() : value.instanceId || '原单号未取得';
}
export function demandStateLabel(value: DemandOrigin & { sourceState: RecruitmentDemandSourceState }): string {
  if (isLocalDemand(value)) return ({ pending: '待审核', approved: '已审核通过', rejected: '已退回' } as Partial<Record<RecruitmentDemandSourceState, string>>)[value.sourceState] || DEMAND_SOURCE_LABELS[value.sourceState];
  return value.sourceState === 'rejected' ? '已拒绝' : DEMAND_SOURCE_LABELS[value.sourceState];
}
export function demandUsabilityLabel(value: DemandOrigin & { usable: boolean }): string {
  return value.usable ? isLocalDemand(value) ? '已审核通过，可供选用' : '已核对，可供选用' : isLocalDemand(value) ? '待审核或不可使用' : '待核对或不可使用';
}
export function demandDepartmentLabel(value: Pick<RecruitmentDemandView, 'departmentName'> & { departmentFullPath?: string | null; rawDepartment?: string | null }): string {
  return value.departmentFullPath || value.departmentName || value.rawDepartment || '部门待核对';
}
export function demandPositionLabel(value: { id: string; name: string; code?: string }, positions: Array<{ id: string; name: string }>): string {
  return positions.some(item => item.id !== value.id && item.name === value.name) && value.code ? `${value.name} · ${value.code}` : value.name;
}
function demandReferenceDate(value?: string | null): string {
  const instant = Date.parse(value || '');
  return Number.isFinite(instant) ? new Date(instant + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
}
export function demandOptionLabel(value: DemandOrigin & Partial<Pick<RecruitmentDemandView,
  'positionName' | 'rawPosition' | 'departmentName' | 'departmentFullPath' | 'rawDepartment' | 'approvedAt' | 'createdAt'>>): string {
  const reference = (isLocalDemand(value) ? value.id || value.demandId : value.instanceId) || value.id || value.demandId;
  const approved = demandReferenceDate(value.approvedAt), created = demandReferenceDate(value.createdAt);
  return [value.positionName || value.rawPosition || '岗位待核对',
    value.departmentFullPath || value.departmentName || value.rawDepartment || '部门待核对',
    approved ? `批准${approved}` : created ? `创建${created}` : '', reference ? `#${reference.slice(0, 8)}` : '']
    .filter(Boolean).join(' · ');
}
export function demandHeadcountLabel(value: Pick<RecruitmentDemandView, 'sourceState' | 'approvedHeadcount' | 'requestedHeadcount' | 'rawHeadcount'>): string {
  if (value.sourceState === 'approved') {
    if (value.approvedHeadcount === null) return '批准人数待核对';
    return value.approvedHeadcount === undefined ? '—' : `批准 ${value.approvedHeadcount} 人`;
  }
  return value.requestedHeadcount != null ? `申请 ${value.requestedHeadcount} 人` : value.rawHeadcount || '人数待核对';
}
export function demandTrackingLabel(value: Pick<RecruitmentDemandView, 'sourceState' | 'trackingState'> & Partial<Pick<RecruitmentDemandView, 'approvedAt' | 'approvedHeadcount'>>): string {
  if (value.sourceState !== 'approved' && !(value.approvedAt && value.approvedHeadcount != null)) return '—';
  return value.trackingState ? DEMAND_TRACKING_LABELS[value.trackingState] || '进度待核对' : '进度待核对';
}
export function demandReviewersLabel(value: Pick<RecruitmentDemandView, 'reviewers'>): string {
  const reviewers = value.reviewers || [];
  return reviewers.length === 1 ? reviewers[0].name : reviewers.length ? `审核组（${reviewers.length}人）` : '未设置审核人';
}
export function demandDetailIssues(value: Pick<RecruitmentDemandView, 'sourceKind' | 'sourceState' | 'issues'>): string[] {
  const normal = isLocalDemand(value) ? {
    draft: ['请先提交招聘需求', '请先提交招聘需求，交独立审核人审核'],
    pending: ['招聘需求待审核', '招聘需求待独立审核'],
    rejected: ['请按退回意见修改后重新提交招聘需求'], withdrawn: ['招聘需求已撤销，不能用于新的录用提交'],
  }[value.sourceState as 'draft' | 'pending' | 'rejected' | 'withdrawn'] || []
    : ['pending', 'rejected', 'withdrawn'].includes(value.sourceState) ? ['需求尚未终审通过或已失效'] : [];
  return (value.issues || []).filter(issue => !normal.includes(issue));
}
export function demandNextStep(value: RecruitmentDemandView): string {
  if (value.sourceState === 'withdrawn') return '不再新增录用，在办应聘继续办理';
  if (isLocalDemand(value) && value.sourceState !== 'approved') {
    if (value.sourceState === 'unknown') return '核对需求状态';
    if (value.submissionIssue) return value.submissionIssue;
    if (value.allowedActions?.includes('submit_approve')) return '提交并通过';
    if (value.sourceState === 'pending' && value.allowedActions?.includes('approve')) return '待我审核';
    if (!value.reviewers?.length) return '联系管理员设置审核人';
    const reviewers = demandReviewersLabel(value);
    if (value.sourceState === 'pending') return `待${reviewers}审核`;
    return value.sourceState === 'rejected' ? `修改后提交${reviewers}审核` : `提交${reviewers}审核`;
  }
  if (value.sourceState !== 'approved') return '等待钉钉审批结果';
  if (!value.usable) return '核对异常信息';
  return ({ recruiting: '推进应聘与面试', filled: '核对到岗与结案', paused: '等待恢复招聘', cancelled: '核对在办应聘' } as Record<string, string>)[value.trackingState || ''] || '查看招聘进度';
}
export function demandEventLabel(action: string): string {
  return ({ map: '核对部门、岗位和人数', sync: '同步原单', sync_failed: '同步未完成', superseded: '被更正单替代',
    local_create: '新建需求草稿', local_edit: '修改需求草稿', local_update: '修改需求草稿', local_submit: '提交需求审核', local_submit_approve: '提交并通过需求', local_approve: '需求审核通过',
    local_return: '退回需求修改', local_withdraw: '撤销需求' } as Record<string, string>)[action] || '需求更新';
}

export function safeDemandSourceLink(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'dingtalk.com' || url.hostname.endsWith('.dingtalk.com'))) return '';
    return url.href;
  } catch { return ''; }
}

export function demandErrorMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
  if (response?.status === 403) return '当前无权办理这项招聘需求操作，请联系管理员核对权限。';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message.join('；') : message)
    || (response?.status === 409 ? '招聘需求或应聘已变化，输入已保留。请刷新核对后再提交。' : '招聘需求读取或保存失败，请重试。');
}
