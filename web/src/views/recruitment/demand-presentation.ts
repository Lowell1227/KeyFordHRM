import type { RecruitmentDemandLocalAction, RecruitmentDemandSourceKind, RecruitmentDemandSourceState } from '@/types/recruitment-demand.types';

export const DEMAND_SOURCE_LABELS: Record<RecruitmentDemandSourceState, string> = {
  draft: '草稿', pending: '审批中', approved: '已批准', rejected: '已拒绝 / 退回', withdrawn: '已撤销', unknown: '状态待核实',
};
export const LOCAL_DEMAND_ACTION_LABELS: Record<RecruitmentDemandLocalAction, string> = {
  submit: '提交审核', approve: '审核通过', return: '退回修改', withdraw: '撤销需求',
};
type DemandOrigin = { sourceKind?: RecruitmentDemandSourceKind; instanceId?: string | null; id?: string; demandId?: string };
export function isLocalDemand(value: DemandOrigin | null | undefined): boolean { return value?.sourceKind === 'local'; }
export function demandOriginLabel(value: DemandOrigin): string { return isLocalDemand(value) ? '系统创建' : '钉钉'; }
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
export function demandEventLabel(action: string): string {
  return ({ map: '核对部门、岗位和人数', sync: '同步原单', sync_failed: '同步未完成', superseded: '被更正单替代',
    local_create: '新建需求草稿', local_edit: '修改需求草稿', local_update: '修改需求草稿', local_submit: '提交需求审核', local_approve: '需求审核通过',
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
