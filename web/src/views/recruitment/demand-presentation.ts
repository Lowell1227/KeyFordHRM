import type { RecruitmentDemandSourceState } from '@/types/recruitment-demand.types';

export const DEMAND_SOURCE_LABELS: Record<RecruitmentDemandSourceState, string> = {
  pending: '审批中', approved: '已批准', rejected: '已拒绝', withdrawn: '已撤销', unknown: '状态待核实',
};

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
  if (response?.status === 403) return '当前无权读取或核对招聘需求，请联系招聘经办核对权限。';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message.join('；') : message)
    || (response?.status === 409 ? '招聘需求或应聘已变化，输入已保留。请刷新核对后再提交。' : '招聘需求读取或保存失败，请重试。');
}
