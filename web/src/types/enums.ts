// 与后端 Prisma 枚举对齐（snake_case 字符串值）

export type SysRole = 'system_admin' | 'hr' | 'hr_user' | 'chairman' | 'vp' | 'dept_head' | 'manager' | 'employee';

export type EmploymentType = 'full_time' | 'part_time' | 'rehire' | 'external';

export type UserStatus = 'active' | 'probation' | 'resigned';

export type CompanyCode = 'fuede' | 'fuede_sports' | 'beijing_fuede' | 'fansibao';

export type CycleType = 'quarterly' | 'semiannual' | 'monthly' | 'annual' | 'probation' | 'custom';

export type ScoringFrequency = 'monthly' | 'cycle';

export type AssessmentPeriodType = 'month' | 'cycle';

export type CycleStatus =
  | 'draft'
  | 'scheduled'
  | 'launch_blocked'
  | 'indicator_setting'
  | 'self_eval'
  | 'manager_score'
  | 'hr_calibration'
  | 'approval'
  | 'published'
  | 'appeal'
  | 'closed';

export type TaskStatus =
  | 'pending'
  | 'indicator_drafting'
  | 'indicator_reviewing'
  | 'indicator_setting'
  | 'indicator_confirming'
  | 'goal_confirmed'
  | 'self_eval'
  | 'manager_scoring'
  | 'dept_review'
  | 'hr_calibration'
  | 'approval'
  | 'published'
  | 'confirmed'
  | 'appealing'
  | 'closed'
  | 'exempted';

export type TeamTaskStage = 'goal-review' | 'manager-eval';

export type TeamStageState = 'not_started' | 'pending' | 'completed' | 'exempted';

export type IndicatorType = 'kpi' | 'attitude' | 'bonus' | 'penalty' | 'veto';

export type IndicatorVisibilityScope =
  | 'company'
  | 'department'
  | 'department_tree'
  | 'direct_reports'
  | 'all_reports'
  | 'supervisors'
  | 'custom';

export type DimensionType = 'kpi' | 'attitude' | 'bonus' | 'penalty';

export type PerfGrade = 'A' | 'B' | 'C' | 'D';

export type AppealStatus = 'pending' | 'resolved';

export type AppealResult = 'maintained' | 'modified';

export type FlowNodeType =
  | 'indicator_setting'
  | 'indicator_confirm'
  | 'self_eval'
  | 'manager_score'
  | 'dept_review'
  | 'hr_calibration'
  | 'approval'
  | 'publish'
  | 'employee_confirm'
  | 'appeal';

export type FlowAction = 'submit' | 'approve' | 'reject' | 'transfer' | 'comment';

export type SignatureBusinessType = 'assessment_task' | 'probation_task' | 'interview';

export type SignatureRole = 'assessor' | 'hr' | 'assessee';

export type SignatureMethod = 'online_confirm' | 'handwritten_image';

export type InterviewMethod = 'one_on_one' | 'phone' | 'performance_meeting';

export type InterviewStatus = 'pending' | 'filled' | 'employee_signed' | 'closed';

export type ImprovementPlanStatus = 'draft' | 'in_progress' | 'completed';

export type ProbationReviewStatus =
  | 'pending'
  | 'indicator_setting'
  | 'self_eval'
  | 'manager_scoring'
  | 'closed';

export type ProbationIndicatorType = 'work_objective' | 'values';

export type ObjectiveLevel = 'company' | 'department' | 'individual';

export type ObjectiveStatus = 'draft' | 'active' | 'archived';

export type ObjectiveReviewStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'not_required';

export type ActionItemStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export type ConfirmationStatus =
  | 'draft'
  | 'submitted'
  | 'manager_approved'
  | 'hr_approved'
  | 'approved'
  | 'rejected';

export type VoteResult = 'pass' | 'extend' | 'fail';

export const INTERVIEW_METHOD_LABELS: Record<InterviewMethod, string> = {
  one_on_one: '一对一',
  phone: '电话',
  performance_meeting: '绩效会议',
};

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, { label: string; type: string }> = {
  pending: { label: '待面谈', type: 'warning' },
  filled: { label: '已填写', type: 'primary' },
  employee_signed: { label: '员工已签字', type: 'success' },
  closed: { label: '已完成', type: 'success' },
};

export const IMPROVEMENT_PLAN_STATUS_META: Record<ImprovementPlanStatus, { label: string; type: string }> = {
  draft: { label: '待制定', type: 'warning' },
  in_progress: { label: '进行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
};

// 任务状态 → 中文标签 + Element Tag 类型（StatusBadge 用）
export const TASK_STATUS_META: Record<TaskStatus, { label: string; type: string }> = {
  pending: { label: '待开始', type: 'info' },
  indicator_drafting: { label: '指标填写中', type: 'warning' },
  indicator_reviewing: { label: '待主管审核指标', type: 'warning' },
  indicator_setting: { label: '指标制定中', type: 'warning' },
  indicator_confirming: { label: '待员工确认指标', type: 'warning' },
  goal_confirmed: { label: '目标已确认', type: 'success' },
  self_eval: { label: '员工自评中', type: 'primary' },
  manager_scoring: { label: '主管评分中', type: 'primary' },
  dept_review: { label: '部门审核中', type: 'primary' },
  hr_calibration: { label: 'HR校准中', type: 'primary' },
  approval: { label: '分管总审批中', type: 'primary' },
  published: { label: '已公示', type: 'success' },
  confirmed: { label: '员工已确认', type: 'success' },
  appealing: { label: '申诉中', type: 'danger' },
  closed: { label: '已关闭', type: 'info' },
  exempted: { label: '已豁免', type: 'info' },
};

// 流程节点标签（useTaskFlow 用）
export const FLOW_NODE_LABELS: Record<FlowNodeType, string> = {
  indicator_setting: '指标制定',
  indicator_confirm: '指标确认',
  self_eval: '员工自评',
  manager_score: '主管评分',
  dept_review: '部门审核',
  hr_calibration: 'HR校准',
  approval: '分管总审批',
  publish: '结果公示',
  employee_confirm: '员工确认',
  appeal: '申诉',
};

// 等级颜色（GradeTag 用）
export const GRADE_COLORS: Record<PerfGrade, { bg: string; text: string; border: string }> = {
  A: { bg: '#f6ffed', text: '#52C41A', border: '#b7eb8f' },
  B: { bg: '#e6f4ff', text: '#1677FF', border: '#91caff' },
  C: { bg: '#fffbe6', text: '#FAAD14', border: '#ffe58f' },
  D: { bg: '#fff2f0', text: '#F5222D', border: '#ffccc7' },
};

// 签字角色中文标签（SignBlock 用）
export const SIGNATURE_ROLE_LABELS: Record<SignatureRole, string> = {
  assessor: '考核人',
  hr: 'HR',
  assessee: '被考核人',
};

// 签字方式中文标签
export const SIGNATURE_METHOD_LABELS: Record<SignatureMethod, string> = {
  online_confirm: '在线确认',
  handwritten_image: '手写图',
};

// 试用期考核状态标签
export const PROBATION_STATUS_META: Record<ProbationReviewStatus, { label: string; type: string }> = {
  pending: { label: '待开始', type: 'info' },
  indicator_setting: { label: '指标制定中', type: 'warning' },
  self_eval: { label: '员工自评中', type: 'primary' },
  manager_scoring: { label: '主管评分中', type: 'primary' },
  closed: { label: '已结束', type: 'success' },
};

// 试用期指标类型标签
export const PROBATION_INDICATOR_TYPE_LABELS: Record<ProbationIndicatorType, string> = {
  work_objective: '工作目标',
  values: '价值观',
};

// 转正申请状态标签
export const CONFIRMATION_STATUS_META: Record<ConfirmationStatus, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  submitted: { label: '待主管审批', type: 'warning' },
  manager_approved: { label: '待 HR 审批', type: 'primary' },
  hr_approved: { label: '待公司审批', type: 'primary' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
};

// 述职表决结果标签
export const VOTE_RESULT_LABELS: Record<VoteResult, { label: string; type: string }> = {
  pass: { label: '通过', type: 'success' },
  extend: { label: '延期', type: 'warning' },
  fail: { label: '不通过', type: 'danger' },
};

// 目标层级标签
export const OBJECTIVE_LEVEL_LABELS: Record<ObjectiveLevel, string> = {
  company: '公司级',
  department: '部门级',
  individual: '个人级',
};

// 目标状态标签
export const OBJECTIVE_STATUS_META: Record<ObjectiveStatus, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  active: { label: '进行中', type: 'primary' },
  archived: { label: '已归档', type: 'info' },
};

export const OBJECTIVE_REVIEW_STATUS_META: Record<ObjectiveReviewStatus, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  changes_requested: { label: '待修改', type: 'danger' },
  not_required: { label: '无需审核', type: 'info' },
};

// 行动项状态标签
export const ACTION_ITEM_STATUS_META: Record<ActionItemStatus, { label: string; type: string }> = {
  todo: { label: '待办', type: 'info' },
  in_progress: { label: '进行中', type: 'primary' },
  done: { label: '已完成', type: 'success' },
  blocked: { label: '阻塞', type: 'danger' },
};
