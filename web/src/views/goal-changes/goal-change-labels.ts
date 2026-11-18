import type { GoalChangeStatus } from '@/api/goal-changes.api';

export const statusLabels: Record<GoalChangeStatus, string> = {
  draft: '草稿', revision: '退回修改', indicator_reviewing: '绩效直属上级审核',
  indicator_dept_reviewing: '部门负责人审核', indicator_confirming: '员工确认',
  indicator_approving: '分管领导审批', active: '已生效', revoked: '已撤销',
};
export const grantLabels = { open: '已开放', consumed: '已使用', revoked: '已撤销' };
export const actionLabels: Record<string, string> = {
  create: '发起变更', edit: '修改草稿', update: '修改草稿', save_draft: '保存草稿', submit: '提交目标变更',
  approve: '审核通过', reject: '退回修改', decide: '审核', activate: '变更生效',
  active: '变更生效', revoke: '撤销变更', skip: '自动跳过',
};
export function percent(weight: number) { return Number((weight * 100).toFixed(4)); }
