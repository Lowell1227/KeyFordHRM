import type {
  SysRole,
  EmploymentType,
  UserStatus,
  CompanyCode,
  CycleType,
  ScoringFrequency,
  AssessmentPeriodType,
  CycleStatus,
  IndicatorType,
  IndicatorVisibilityScope,
  DimensionType,
  PerfGrade,
  TaskStatus,
  AppealStatus,
  AppealResult,
  FlowNodeType,
  FlowAction,
  SignatureBusinessType,
  SignatureRole,
  SignatureMethod,
  InterviewMethod,
  InterviewStatus,
  ImprovementPlanStatus,
  ProbationReviewStatus,
  ProbationIndicatorType,
  ConfirmationStatus,
  VoteResult,
  ObjectiveLevel,
  ObjectiveStatus,
  ObjectiveReviewStatus,
  ActionItemStatus,
  TeamTaskStage,
  TeamStageState,
} from './enums';

/** 后端统一响应包装。 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
  timestamp: number;
}

/** 分页响应。 */
export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

/** GET /auth/me 当前用户。 */
export type BusinessIdentityType =
  | 'performance_manager'
  | 'department_leader'
  | 'performance_approver'
  | 'cycle_hr_owner';

export interface BusinessIdentity {
  type: BusinessIdentityType;
  label: string;
  count: number;
}

export interface BusinessCapabilities {
  canManageTeam: boolean;
  canReviewDepartment: boolean;
  canViewPerformanceApproval: boolean;
  canOperatePerformanceApproval: boolean;
  canHandleHrCycle: boolean;
  canHandleInterviews: boolean;
  canHandleProbationReviews: boolean;
  canHandleConfirmationApprovals: boolean;
  canViewReports: boolean;
  canManageObjectives: boolean;
  identities: BusinessIdentity[];
}

export type SystemPermission = 'standard_user' | 'hr_user' | 'hr_admin' | 'system_admin';

export type HrCapability =
  | 'employee_archive_edit'
  | 'employee_archive_review'
  | 'organization_edit'
  | 'cycle_plan_edit'
  | 'cycle_plan_review';

export interface CurrentUser {
  id: string;
  name: string;
  status?: UserStatus;
  employeeNo?: string;
  phone?: string;
  deptId: string | null;
  deptName?: string;
  deptPath?: string;
  position?: string;
  sysRole: SysRole;
  systemPermission?: SystemPermission;
  hrCapabilities?: HrCapability[];
  businessIdentities?: BusinessIdentity[];
  isAssessorOnly: boolean;
  canViewAll: boolean;
  directManagerId?: string | null;
  directManagerName?: string;
  avatarUrl?: string;
  businessCapabilities?: BusinessCapabilities;
}

/** 登录响应。 */
export interface LoginResult {
  token: string;
  expiresIn: number;
  passwordChangeRequired: boolean;
  user: CurrentUser;
}

// ---------------------------------------------------------------------------
// 用户 / 部门
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  employeeNo?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  deptId?: string | null;
  deptName?: string;
  position?: string;
  entryDate?: string;
  leaveDate?: string;
  employmentType: EmploymentType;
  status: UserStatus;
  directManagerId?: string | null;
  directManagerName?: string;
  sysRole: SysRole;
  systemPermission?: SystemPermission;
  hrCapabilities?: HrCapability[];
  businessIdentities?: BusinessIdentity[];
  isAssessorOnly: boolean;
  canViewAll: boolean;
  createdAt?: string;
  updatedAt?: string;
  dingtalkBindingState?: 'unbound' | 'enabled' | 'disabled';
}

export interface DirectReport {
  id: string;
  employeeNo: string | null;
  name: string;
  avatarUrl: string | null;
  deptId: string | null;
  deptName: string | null;
  position: string | null;
  sysRole: SysRole;
  status: UserStatus;
  directManagerId: string | null;
}

export interface UserQuery {
  page?: number;
  pageSize?: number;
  deptId?: string;
  status?: UserStatus;
  employmentType?: EmploymentType;
  sysRole?: SysRole;
  keyword?: string;
  includeTestAccounts?: boolean;
  unassigned?: boolean;
}

export interface UpdateUserSettingsBody {
  sysRole?: SysRole;
  hrCapabilities?: HrCapability[];
}

export interface UpdateRoleBody {
  sysRole: SysRole;
}

export type SetPasswordBody = Record<string, never>;

export interface Department {
  id: string;
  dingtalkDeptId?: string;
  name: string;
  fullPath?: string;
  parentId?: string | null;
  leaderId?: string | null;
  leaderName?: string;
  approverId?: string | null;
  approverName?: string;
  effectiveApproverId?: string | null;
  effectiveApproverName?: string | null;
  effectiveApproverSource?:
    | 'manual_override'
    | 'leader_manager'
    | 'parent_leader'
    | 'ancestor_chain'
    | 'unresolved';
  effectiveApproverDeptId?: string | null;
  effectiveApproverDeptName?: string | null;
  company: CompanyCode;
  sortOrder: number;
  isActive: boolean;
  directMemberCount?: number;
  memberCount?: number;
  children?: Department[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DepartmentQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  company?: CompanyCode;
  isActive?: boolean;
  flat?: boolean;
}

export interface UpdateApproverBody {
  approverId: string | null;
}

export interface UpdateLeaderBody {
  leaderId: string | null;
}

export interface UpdateDepartmentStructureBody {
  name?: string;
  parentId?: string | null;
  company?: CompanyCode;
  leaderId?: string | null;
  approverId?: string | null;
}

// ---------------------------------------------------------------------------
// 指标库
// ---------------------------------------------------------------------------

export interface Indicator {
  id: string;
  name: string;
  code?: string;
  category?: string;
  type: IndicatorType;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  groupName?: string;
  isActive: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IndicatorQuery {
  page?: number;
  pageSize?: number;
  type?: IndicatorType;
  category?: string;
  groupName?: string;
  keyword?: string;
  isActive?: boolean;
}

export interface CreateIndicatorBody {
  name: string;
  code?: string;
  category?: string;
  type: IndicatorType;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  groupName?: string;
  isActive?: boolean;
}

export type UpdateIndicatorBody = Partial<CreateIndicatorBody>;

// ---------------------------------------------------------------------------
// 考核模板
// ---------------------------------------------------------------------------

export interface TemplateIndicator {
  id?: string;
  indicatorId?: string;
  name: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  weight: number;
  sortOrder: number;
}

export interface TemplateDimension {
  id?: string;
  name: string;
  type: DimensionType;
  weight: number;
  sortOrder: number;
  indicators: TemplateIndicator[];
}

export interface AssessmentTemplate {
  id: string;
  name: string;
  description?: string | null;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore: number;
  isActive: boolean;
  version: number;
  createdBy?: string;
  createdByName?: string;
  dimensions: TemplateDimension[];
  createdAt?: string;
  updatedAt?: string;
}

/** GET /templates 列表项（后端返回的轻量视图）。 */
export interface TemplateListItem {
  id: string;
  name: string;
  description?: string | null;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore: number;
  isActive: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  dimensionCount: number;
  indicatorCount: number;
  isLocked?: boolean;
  lockedUsageCount?: number;
}

export interface TemplateQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  isActive?: boolean;
}

export interface CreateTemplateBody {
  name: string;
  description?: string;
  applicableDepts: string[];
  applicableUsers: string[];
  maxScore?: number;
  isActive?: boolean;
  dimensions: TemplateDimension[];
}

export type UpdateTemplateBody = Partial<Omit<CreateTemplateBody, 'dimensions'>> & {
  dimensions?: TemplateDimension[];
};

// ---------------------------------------------------------------------------
// 考核周期
// ---------------------------------------------------------------------------

export interface PublishVisibleFields {
  totalScore: boolean;
  grade: boolean;
  indicatorScores: boolean;
  managerComment: boolean;
  coefficient: boolean;
}

export type CycleNotificationMode = 'off' | 'launch_only' | 'launch_and_reminders';

export interface DingtalkNotificationSettings {
  available: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
}

export interface CyclePeriodSchedule {
  id?: string;
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  periodStart: string;
  periodEnd: string;
  selfEvalOpenAt: string;
  selfEvalDueAt: string;
  managerDueAt: string;
  isException: boolean;
}

export interface CycleScheduleIssue {
  code: string;
  periodKey?: string;
  message: string;
}

export interface CycleSchedulePreview {
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  schedules: CyclePeriodSchedule[];
  blockers: CycleScheduleIssue[];
  warnings: CycleScheduleIssue[];
}

export interface AssessmentCycle {
  id: string;
  planVersion: number;
  name: string;
  type: CycleType;
  workflowVersion?: 1 | 2;
  scoringFrequency?: ScoringFrequency;
  reviewFrequency?: 'cycle';
  periodSchedules?: CyclePeriodSchedule[];
  companyFinalApproverId?: string | null;
  companyFinalApprover?: { id: string; name: string } | null;
  startDate: string;
  endDate: string;
  goalSettingOpenAt?: string;
  selfEvalOpenAt?: string;
  deadlineIndicatorSetting?: string;
  deadlineIndicatorConfirm?: string;
  deadlineSelfEval?: string;
  deadlineManagerScore?: string;
  deadlineHrCalibration?: string;
  deadlineApproval?: string;
  deadlinePublish?: string;
  deadlineAppeal?: string;
  status: CycleStatus;
  publishVisibleFields: PublishVisibleFields;
  gradeAMaxRatio: number;
  gradeBMaxRatio: number;
  gradeCMaxRatio: number;
  gradeDMaxRatio: number;
  createdBy?: string;
  creator?: { id: string; name: string } | null;
  hrOwnerId?: string;
  hrOwner?: { id: string; name: string } | null;
  reviewerId?: string;
  reviewer?: { id: string; name: string } | null;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
  reviewComment?: string | null;
  monthlyFollowUpRequired?: boolean;
  participantDeptIds?: string[];
  participantUserIds?: string[];
  explicitExemptDeptIds?: string[];
  explicitExemptUserIds?: string[];
  notificationMode?: CycleNotificationMode;
  scheduledAt?: string;
  scheduledById?: string;
  openedAt?: string;
  openedById?: string;
  openSource?: 'manual' | 'scheduled';
  launchBlockedAt?: string;
  launchBlockedReason?: string;
  snapshotCount?: number;
  taskStats?: {
    total: number;
    approved?: number;
    unsubmitted: number;
    pendingManagerReview: number;
    pendingEmployeeConfirmation: number;
    goalCompleted: number;
    exempted: number;
    overdue: number;
    byStatus: Partial<Record<TaskStatus, number>>;
  };
  personalTask?: {
    id: string;
    employeeId: string;
    status: TaskStatus;
    isExempt: boolean;
  } | null;
  visibleTasks?: Array<{
    id: string;
    employeeId: string;
    status: TaskStatus;
    isExempt: boolean;
  }>;
  publishedAt?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CycleQuery {
  page?: number;
  pageSize?: number;
  status?: CycleStatus;
  type?: CycleType;
  group?: CycleStatusGroup;
  keyword?: string;
}

export type CycleStatusGroup = 'attention' | 'active' | 'finished';

/** POST /cycles 创建周期请求体（对齐 CreateCycleDto）。
 *  deadline_appeal 由公示时自动计算，前端无需提供。
 */
export interface CreateCycleBody {
  name: string;
  type: CycleType;
  workflowVersion?: 1 | 2;
  scoringFrequency?: ScoringFrequency;
  reviewFrequency?: 'cycle';
  periodSchedules?: CyclePeriodSchedule[];
  companyFinalApproverId?: string | null;
  companyFinalApprover?: { id: string; name: string } | null;
  notificationMode?: CycleNotificationMode;
  startDate: string;
  endDate: string;
  goalSettingOpenAt?: string;
  selfEvalOpenAt?: string;
  hrOwnerId?: string;
  reviewerId?: string;
  monthlyFollowUpRequired?: boolean;
  participantDeptIds?: string[];
  participantUserIds?: string[];
  explicitExemptDeptIds?: string[];
  explicitExemptUserIds?: string[];
  deadlineIndicatorSetting?: string;
  deadlineIndicatorConfirm?: string;
  deadlineSelfEval?: string;
  deadlineManagerScore?: string;
  deadlineHrCalibration?: string;
  deadlineApproval?: string;
  deadlinePublish?: string;
  gradeAMaxRatio?: number;
  gradeBMaxRatio?: number;
  gradeCMaxRatio?: number;
  gradeDMaxRatio?: number;
  publishVisibleFields?: PublishVisibleFields;
}

/** PATCH /cycles/:id/deadlines 请求体。 */
export interface UpdateDeadlinesBody {
  expectedPlanVersion: number;
  deadlineIndicatorSetting?: string;
  deadlineIndicatorConfirm?: string;
  deadlineSelfEval?: string;
  deadlineManagerScore?: string;
  deadlineHrCalibration?: string;
  deadlineApproval?: string;
  deadlinePublish?: string;
}

/** PATCH /cycles/:id 更新草稿周期请求体。 */
export type UpdateCycleBody = Partial<CreateCycleBody> & { expectedPlanVersion: number };

export interface AssessmentTemplateSnapshot {
  id: string;
  cycleId: string;
  templateId: string;
  snapshotData: Record<string, unknown>;
  createdAt: string;
}

export interface CycleProgress {
  totalTasks: number;
  selfEvalDone: number;
  managerScoreDone: number;
  hrCalibrated: number;
  approved: number;
  published: number;
  appealed: number;
  exempted: number;
}

// ---------------------------------------------------------------------------
// 考核任务
// ---------------------------------------------------------------------------

export interface IndicatorInstance {
  id: string;
  taskId: string;
  templateIndicatorId?: string;
  name: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  weight: number;
  indicatorType: IndicatorType;
  dimensionName?: string;
  dimensionWeight: number;
  actualValue?: string | null;
  actualNote?: string;
  selfScore?: number;
  selfComment?: string;
  managerScore?: number;
  managerComment?: string;
  extraScores?: ExtraScoreItem[];
  finalScore?: number;
  sortOrder: number;
  visibilityScope: IndicatorVisibilityScope;
  visibilityScopes: IndicatorVisibilityScope[];
  visibleDepartmentIds: string[];
  visibleUserIds: string[];
  alignedObjectives: Array<{
    id: string;
    title: string;
    level: ObjectiveLevel;
    ownerId: string | null;
  }>;
  alignedParentIndicators: IndicatorAlignmentCandidate[];
}

export interface IndicatorAlignmentCandidate {
  id: string;
  name: string;
  owner: { id: string; name: string };
}

export interface IndicatorAlignmentOwner {
  id: string;
  name: string;
  avatarUrl: string | null;
  relation: 'performance_manager';
  items: IndicatorAlignmentCandidate[];
}

export interface IndicatorAlignmentCandidatesResult {
  items: IndicatorAlignmentCandidate[];
  owners: IndicatorAlignmentOwner[];
  reason: string | null;
}

export interface IndicatorMapNode {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  progress: number;
  sortOrder: number;
  visibilityScopes: IndicatorVisibilityScope[];
  owner: {
    id: string;
    name: string;
    deptId: string | null;
    deptName: string | null;
  };
}

export interface IndicatorMapEdge {
  id: string;
  source: string;
  target: string;
}

export interface IndicatorMapResult {
  cycle: { id: string; name: string; startDate: string; endDate: string };
  roots: string[];
  nodes: IndicatorMapNode[];
  edges: IndicatorMapEdge[];
  sameDepartmentUnaligned: IndicatorMapNode[];
  permissions: {
    viewerTaskId: string;
    viewerId: string;
    managerId: string | null;
    canViewSameDepartment: boolean;
  };
}

export interface ExtraScoreItem {
  label: string;
  value: number;
}

export interface SelfEvalSummary {
  id?: string;
  taskId: string;
  achievements?: string;
  improvements?: string;
  suggestions?: string;
  nextGoals?: string;
  supportNeeded?: string;
  attachments?: Attachment[];
  submittedAt?: string;
}

export interface ManagerEvalSummary {
  id?: string;
  taskId: string;
  strengths?: string;
  improvements?: string;
  developmentPlan?: string;
  attachments?: Attachment[];
  submittedAt?: string;
}

export interface PerformanceInterview {
  id: string;
  taskId: string;
  cycleId: string;
  employeeId: string;
  interviewerId: string;
  status: InterviewStatus;
  interviewTime?: string | null;
  location?: string | null;
  method?: InterviewMethod | null;
  scoreInformed: boolean;
  achievements?: string | null;
  weaknesses?: string | null;
  nextGoals?: string | null;
  remediation?: string | null;
  supportNeeded?: string | null;
  otherMatters?: string | null;
  deadline?: string | null;
  managerSignedAt?: string | null;
  employeeSignedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // 详情视图附加
  employeeName?: string | null;
  deptName?: string | null;
  interviewerName?: string | null;
}

export interface UpdateInterviewBody {
  interviewTime?: string;
  location?: string;
  method?: InterviewMethod;
  scoreInformed?: boolean;
  achievements?: string;
  weaknesses?: string;
  nextGoals?: string;
  remediation?: string;
  supportNeeded?: string;
  otherMatters?: string;
}

export interface GradeResult {
  id?: string;
  taskId: string;
  calculatedScore?: number;
  rawGrade?: PerfGrade;
  calibratedGrade?: PerfGrade;
  calibrationNote?: string;
  isVeto: boolean;
  vetoReason?: string;
  vetoOperatorId?: string;
  vetoOperatorName?: string;
  coefficient?: number;
  isPublished: boolean;
  publishedAt?: string;
  hrCalibratorId?: string;
  hrCalibratorName?: string;
  hrCalibratedAt?: string;
  approverId?: string;
  approverName?: string;
  approvedAt?: string;
  employeeConfirmedAt?: string;
}

export interface AssessmentTask {
  id: string;
  cycleId: string;
  cycleName?: string;
  snapshotId: string;
  employeeId: string;
  employeeName?: string;
  employeeNo?: string;
  deptId?: string | null;
  deptName?: string;
  managerId?: string | null;
  managerName?: string;
  deptHeadId?: string | null;
  deptHeadName?: string;
  approverId?: string | null;
  approverName?: string;
  status: TaskStatus;
  isExempt: boolean;
  exemptReason?: string;
  indicatorSetAt?: string;
  indicatorConfirmedAt?: string;
  selfEvalSubmittedAt?: string;
  managerScoredAt?: string;
  deptReviewedAt?: string;
  hrCalibratedAt?: string;
  approvedAt?: string;
  publishedAt?: string;
  employeeConfirmedAt?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 任务在列表中的轻量视图。 */
export interface TaskListItem extends AssessmentTask {
  progress?: number;
  totalScore?: number;
  grade?: PerfGrade;
  rawGrade?: PerfGrade;
  workflowVersion?: number;
  periods?: AssessmentPeriodSummary[];
}

export interface TaskDetail extends AssessmentTask {
  workflowVersion?: number;
  periods?: AssessmentPeriodSummary[];
  workflowContext?: TaskWorkflowContext;
  indicatorInstances: IndicatorInstance[];
  selfEvalSummary?: SelfEvalSummary;
  managerEvalSummary?: ManagerEvalSummary;
  gradeResult?: GradeResult;
  performanceInterview?: PerformanceInterview | null;
  flowRecords?: FlowRecord[];
}

export interface TaskWorkflowContext {
  stage: 'goal_setting' | 'self_eval' | 'review' | 'result' | 'completed';
  statusLabel: string;
  currentHandler: {
    id: string;
    name: string;
    nodeType: 'employee' | 'manager' | 'deptHead' | 'hr' | 'approver';
  } | null;
  currentDeadline: string | null;
  canRemind: boolean;
  reminderNodeType: 'employee' | 'manager' | 'deptHead' | 'hr' | 'approver' | null;
  reminderAvailableAt: string | null;
}

export interface LaunchPreflightResult {
  ready: boolean;
  planHash: string | null;
  cycle: Pick<AssessmentCycle, 'id' | 'name' | 'status' | 'goalSettingOpenAt' | 'planVersion'>;
  companyFinalApprover?: { id: string; name: string } | null;
  participantCount: number;
  templateCount: number;
  participants: Array<{
    employeeId: string;
    employeeName: string;
    deptId: string | null;
    deptName: string | null;
    managerId: string | null;
    managerName: string | null;
    deptHeadId: string | null;
    approverId: string | null;
    templateId: string | null;
    templateName: string | null;
    templateVersion: number | null;
    isExempt: boolean;
    exemptReason: string | null;
    participantDisposition?: 'active' | 'cycle_exempt' | 'top_leader_exempt';
  }>;
  exclusions?: Array<{
    employeeId: string;
    employeeName: string;
    reasonCode: 'PROBATION_NOT_IN_PLAN';
    reason: string;
  }>;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  reviewReminderAvailableAt: string | null;
}

export interface CycleParticipantRecord {
  cycleId: string;
  recordedAt: string;
  source: 'manual' | 'scheduled';
  operator: { id: string; name: string } | null;
  summary: {
    total: number;
    active: number;
    exempted: number;
  };
  participants: Array<{
    employeeId: string;
    employeeName: string;
    deptId: string | null;
    deptName: string | null;
    managerId: string | null;
    managerName: string | null;
    participantDisposition: 'active' | 'cycle_exempt' | 'top_leader_exempt';
    isExempt: boolean;
    exemptReason: string | null;
    status: TaskStatus | null;
  }>;
}

export interface TaskQuery {
  page?: number;
  pageSize?: number;
  cycleId?: string;
  status?: TaskStatus;
  employeeId?: string;
  managerId?: string;
  deptId?: string;
  keyword?: string;
}

export interface TeamTaskQuery {
  page?: number;
  pageSize?: number;
  stage: TeamTaskStage;
  stageState?: TeamStageState;
  cycleId?: string;
  deptId?: string;
  employeeId?: string;
  keyword?: string;
}

/** GET /tasks/team item; only fields returned by TeamTasksService.toListItem. */
export interface TeamTaskListItem {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  deptId: string | null;
  deptName: string | null;
  managerId: string | null;
  status: TaskStatus;
  totalScore: number | null;
  rawGrade: string | null;
  updatedAt: string;
  employeeNo: string | null;
  avatarUrl: string | null;
  position: string | null;
  stageState: TeamStageState;
  periodReview: {
    id: string;
    periodKey: string;
    periodType: 'month' | 'cycle';
    status: AssessmentPeriodStatus;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
  } | null;
}

export interface TeamTaskPage extends Paginated<TeamTaskListItem> {
  counts: {
    all: number;
    notStarted: number;
    pending: number;
    completed: number;
    exempted: number;
  };
  facets: {
    departments: Array<{ id: string; name: string }>;
    employees: Array<{
      id: string;
      name: string;
      employeeNo: string | null;
      deptId: string | null;
    }>;
  };
}

export interface BatchReviewResult {
  succeeded: Array<{ taskId: string; status: TaskStatus }>;
  failed: Array<{ taskId: string; reason: string }>;
}

export interface IndicatorReferenceItem {
  id: string;
  taskId: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  name: string;
  weight: number;
  visibilityScope: IndicatorVisibilityScope;
  visibilityScopes: IndicatorVisibilityScope[];
}

export interface TaskWorkspaceQuery {
  scope: 'mine' | 'team';
  stage: TeamTaskStage;
  cycleId?: string;
  deptId?: string;
  employeeId?: string;
  taskId?: string;
  periodId?: string;
  stageState?: TeamStageState;
  keyword?: string;
  page?: number;
}

export interface CreateTaskBody {
  cycleId: string;
  employeeId: string;
}

export interface BatchCreateTaskBody {
  cycleId: string;
  employeeIds: string[];
}

export interface SetIndicatorBody {
  expectedUpdatedAt: string;
  instances: Array<
    Omit<Pick<
      IndicatorInstance,
      | 'templateIndicatorId'
      | 'name'
      | 'description'
      | 'scoringStandard'
      | 'dataSource'
      | 'dataCaliber'
      | 'targetValue'
      | 'targetValueText'
      | 'unit'
      | 'indicatorType'
      | 'dimensionName'
      | 'dimensionWeight'
      | 'sortOrder'
      | 'visibilityScope'
      | 'visibleDepartmentIds'
      | 'visibleUserIds'
    >, 'id'> & {
      weight?: number;
      visibilityScopes?: IndicatorVisibilityScope[];
      alignedObjectiveIds: string[];
      alignedParentIndicatorIds?: string[];
    }
  >;
  action?: 'save' | 'submit';
  note?: string;
}

export interface UpdateActualValueBody {
  indicators: {
    id: string;
    actualValue?: string;
    actualNote?: string;
  }[];
}

export interface IndicatorProposalItem {
  templateIndicatorId?: string;
  name: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  weight?: number;
  indicatorType?: IndicatorType;
  dimensionName?: string;
  dimensionWeight?: number;
  sortOrder?: number;
}

export interface SubmitIndicatorProposalBody {
  items: IndicatorProposalItem[];
  note?: string;
}

export interface SubmitIndicatorProposalResult {
  id: string;
  submittedAt: string;
}

export interface SubmitSelfEvalBody {
  indicators: {
    id: string;
    selfScore: number;
    selfComment?: string;
  }[];
  summary: Omit<SelfEvalSummary, 'id' | 'taskId' | 'submittedAt'>;
}

export interface ManagerScoreIndicatorItem {
  id: string;
  managerScore: number;
  managerComment?: string;
  extraScores?: ExtraScoreItem[];
}

export interface SubmitManagerScoreBody {
  expectedUpdatedAt: string;
  indicators: ManagerScoreIndicatorItem[];
  evalSummary: Omit<ManagerEvalSummary, 'id' | 'taskId' | 'submittedAt'>;
  veto?: VetoGradeBody;
}

export interface SaveManagerEvaluationDraftBody {
  expectedUpdatedAt: string;
  indicators: Array<{
    id: string;
    managerScore?: number | null;
    managerComment?: string;
    extraScores?: ExtraScoreItem[];
  }>;
  evalSummary: Omit<ManagerEvalSummary, 'id' | 'taskId' | 'submittedAt'>;
}

export interface WithdrawManagerScoreBody {
  expectedUpdatedAt: string;
}

export interface WithdrawIndicatorsBody {
  expectedUpdatedAt: string;
}

export interface BatchIndicatorReviewBody {
  tasks: Array<{ taskId: string; updatedAt: string }>;
}

export interface BatchRejectIndicatorReviewBody extends BatchIndicatorReviewBody {
  reason: string;
}

export interface ReferenceIndicatorQuery {
  page?: number;
  pageSize?: number;
  cycleId?: string;
  ownerId?: string;
  keyword?: string;
}

export interface DeptReviewBody {
  action: 'pass' | 'reject';
  comment?: string;
}

export interface ExemptTaskBody {
  isExempt: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 校准 / 审批 / 公示
// ---------------------------------------------------------------------------

export interface GradeDistributionEntry {
  count: number;
  ratio: number;
  maxRatio: number;
  isOverLimit: boolean;
}

export interface CalibrationCandidate {
  taskId: string;
  employeeName: string;
  deptName?: string;
  position?: string;
  // 未到评分阶段的任务这两项为 null（workbench 返回全员在途任务）
  calculatedScore: number | null;
  rawGrade: PerfGrade | null;
  calibratedGrade?: PerfGrade;
  isVeto?: boolean;
  managerName?: string;
}

export interface CalibrationSummary {
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  totalActive: number;
  pendingCalibration: number;
}

export interface SubmitCalibrationBody {
  submit: boolean;
  calibrations: {
    taskId: string;
    calibratedGrade: PerfGrade;
    calibrationNote?: string;
    isVeto?: boolean;
    vetoReason?: string;
  }[];
}

export interface VetoGradeBody {
  isVeto: boolean;
  vetoReason?: string;
}

export interface ApprovalTaskView {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  position?: string | null;
  deptId?: string | null;
  deptName?: string;
  status: TaskStatus;
  totalScore: number;
  rawGrade?: string | null;
  calibratedGrade?: string | null;
  isVeto: boolean;
  approverId?: string | null;
  approvedAt?: string | null;
}

export interface SubmitApprovalBody {
  comment?: string;
}

export interface PublishBody {
  visibleFields?: Partial<PublishVisibleFields>;
}

/** POST /cycles/:id/publish — HR 批量公示结果请求体。 */
export interface PublishResultsBody {
  taskIds: string[];
  sendDingtalkNotification?: boolean;
}

/** POST /cycles/:id/publish — HR 批量公示结果响应。 */
export interface PublishResultsResult {
  cycleId: string;
  published: number;
  publishedAt: string;
  deadlineAppeal: string;
}

// ---------------------------------------------------------------------------
// 申诉
// ---------------------------------------------------------------------------

export interface Attachment {
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
}

export type AssessmentPeriodStatus = 'unopened' | 'self_eval' | 'manager_scoring' | 'completed' | 'no_result';

export interface AssessmentPeriodSummary {
  id: string;
  periodKey: string;
  periodType: 'month' | 'cycle';
  sequence: number;
  status: AssessmentPeriodStatus;
  selfEvalOpenAt: string;
  selfEvalDueAt: string;
  managerDueAt: string;
  employeeSubmittedAt: string | null;
  managerSubmittedAt: string | null;
}

export interface PerformanceCycleContext {
  id: string;
  name: string;
  type: CycleType;
  startDate: string;
  endDate: string;
  openedAt: string;
  scoringFrequency: ScoringFrequency;
  task: {
    id: string;
    status: TaskStatus;
    isExempt: boolean;
    exemptReason: string | null;
    participantDisposition: 'active' | 'cycle_exempt' | 'top_leader_exempt';
    manager: { id: string; name: string } | null;
  };
  periods: Array<AssessmentPeriodSummary & {
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
  }>;
}

export interface PeriodReviewHistoryItem {
  periodKey: string;
  progress: number | null;
  healthStatus: GoalTrackingHealthStatus | null;
  actualValueText: string | null;
  selfScore: number | null;
  managerScore: number | null;
}

export interface PeriodReviewIndicator {
  indicatorVersionItemId: string;
  sourceInstanceId: string | null;
  name: string;
  description: string | null;
  scoringStandard: string | null;
  targetValue: number | null;
  targetValueText: string | null;
  unit: string | null;
  weight: number;
  isScoreRequired: boolean;
  monthlyProgressSource: 'draft_or_result' | 'active_progress' | 'none';
  progress: number | null;
  healthStatus: GoalTrackingHealthStatus | null;
  actualValueText: string | null;
  employeeComment: string | null;
  problemReason: string | null;
  nextMonthPlan: string | null;
  supportNeeded: string | null;
  attachments: Attachment[];
  selfScore: number | null;
  managerScore: number | null;
  managerComment: string | null;
  latestProgress: GoalTrackingLatestProgress | null;
  alignedObjectives: Array<{ id: string; title: string; level: ObjectiveLevel }>;
  history: PeriodReviewHistoryItem[];
}

export interface PeriodReviewDetail {
  period: {
    id: string;
    taskId: string;
    periodKey: string;
    periodType: 'month' | 'cycle';
    status: AssessmentPeriodStatus;
    periodStart: string;
    periodEnd: string;
    selfEvalOpenAt: string;
    selfEvalDueAt: string;
    managerDueAt: string;
    employeeSubmittedAt: string | null;
    managerSubmittedAt: string | null;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
    selfGrade: PerfGrade | null;
    managerGrade: PerfGrade | null;
    draftVersion: number;
  };
  context: {
    cycleName: string;
    employeeName: string;
    employeeNo: string | null;
    deptName: string | null;
    managerName: string | null;
    statusLabel: string;
  };
  permissions: { canEditEmployee: boolean; canEditManager: boolean };
  indicators: PeriodReviewIndicator[];
}

export interface EmployeePeriodReviewItemBody {
  indicatorVersionItemId: string;
  progress?: number | null;
  healthStatus?: GoalTrackingHealthStatus | null;
  employeeComment?: string | null;
  selfScore?: number | null;
}

export interface SaveEmployeePeriodReviewDraftBody {
  expectedVersion: number;
  selfGrade?: PerfGrade | null;
  indicators: EmployeePeriodReviewItemBody[];
}

export interface SubmitEmployeePeriodReviewBody {
  expectedVersion: number;
  idempotencyKey: string;
  selfGrade: PerfGrade;
  indicators: EmployeePeriodReviewItemBody[];
}

export interface PeriodReviewActionResult {
  periodId: string;
  status: AssessmentPeriodStatus;
  draftVersion: number;
  savedAt: string;
}

export interface ManagerPeriodReviewItemBody {
  indicatorVersionItemId: string;
  managerScore?: number | null;
  managerComment?: string | null;
}

export interface SaveManagerPeriodReviewDraftBody {
  expectedVersion: number;
  managerGrade?: PerfGrade | null;
  indicators: ManagerPeriodReviewItemBody[];
}

export interface ReturnManagerPeriodReviewBody {
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string | null;
}

export interface SubmitManagerPeriodReviewBody extends SaveManagerPeriodReviewDraftBody {
  idempotencyKey: string;
  managerGrade: PerfGrade;
}

/** 申诉列表项（对齐后端 AppealListItem，不含 coefficient）。 */
export interface AppealListItem {
  id: string;
  taskId: string;
  cycleId: string;
  status: AppealStatus;
  reason: string;
  finalResult: AppealResult | null;
  hrResolution: string | null;
  createdAt: string;
  hrResolvedAt: string | null;
  appellant: { id: string; name: string } | null;
  dept: { id: string; name: string | null } | null;
  cycle: { id: string; name: string } | null;
}

/** 申诉详情（对齐后端 AppealDetail）。 */
export interface AppealDetail extends AppealListItem {
  appellantId: string;
  attachments: Attachment[];
  appealDeadline: string | null;
  updatedAt: string;
  taskGrade: {
    calculatedScore: number | null;
    rawGrade: PerfGrade | null;
    calibratedGrade: PerfGrade | null;
  } | null;
}

/** 旧版完整 Appeal 对象，保留供兼容；新代码优先使用 AppealListItem / AppealDetail。 */
export interface Appeal {
  id: string;
  taskId: string;
  cycleId: string;
  cycleName?: string;
  appellantId: string;
  appellantName?: string;
  reason: string;
  attachments: Attachment[];
  status: AppealStatus;
  hrResolution?: string;
  hrResolvedAt?: string;
  hrResolverId?: string;
  hrResolverName?: string;
  finalResult?: AppealResult;
  appealDeadline: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppealQuery {
  page?: number;
  pageSize?: number;
  status?: AppealStatus;
  cycleId?: string;
  deptId?: string;
  keyword?: string;
}

export interface CreateAppealBody {
  taskId: string;
  reason: string;
  attachments?: Attachment[];
}

export interface ResolveAppealBody {
  resolution: string;
  result: AppealResult;
  newGrade?: PerfGrade;
  newGradeNote?: string;
}

// ---------------------------------------------------------------------------
// 流程记录
// ---------------------------------------------------------------------------

export interface FlowRecord {
  id: string;
  taskId: string;
  cycleId: string;
  nodeType: FlowNodeType;
  actorId?: string;
  actorName?: string;
  action: FlowAction;
  comment?: string;
  extraData?: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 报表 / 归档
// ---------------------------------------------------------------------------

/** GET /reports/cycle/:id/summary 汇总明细细项。 */
export interface ReportSummaryItem {
  taskId?: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  position: string | null;
  totalScore: number | null;
  grade: PerfGrade | null;
  managerName: string | null;
}

/** GET /reports/cycle/:id/summary 汇总统计。 */
export interface ReportSummaryStats {
  total: number;
  resulted: number;
  pending: number;
  qualified: number;
  qualifiedRate: number;
  grades: Record<PerfGrade, { count: number; ratio: number }>;
}

/** GET /reports/cycle/:id/summary 响应。 */
export interface ReportSummary {
  stats: ReportSummaryStats;
  items: ReportSummaryItem[];
}

/** GET /reports/cycle/:id/progress 响应。 */
export interface ReportCycleProgress {
  byStatus: Record<TaskStatus, number>;
  overdueByNode: Array<{ node: string; overdueCount: number }>;
}

/** GET /reports/cycle/:id/grade-list 响应。 */
export interface GradeListResponse {
  aList: ReportSummaryItem[];
  cList: ReportSummaryItem[];
  dList: ReportSummaryItem[];
}

/** GET /reports/employee/:id/archive 响应单项。 */
export interface EmployeeArchiveItem {
  cycleId: string;
  cycleName: string;
  startDate: string;
  endDate: string;
  grade: PerfGrade;
  totalScore: number;
}

/** GET /reports/cycle/:id/summary 查询参数。 */
export interface ReportQueryDto {
  deptId?: string;
  grade?: PerfGrade;
  format?: 'json' | 'excel';
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  userId: string;
  senderId: string | null;
  senderName: string | null;
  taskId: string | null;
  cycleId: string | null;
  type: string;
  title: string;
  content: string | null;
  extraData?: Record<string, unknown> | null;
  channel: string;
  status: 'pending' | 'sent' | 'failed';
  isRead: boolean;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationQuery {
  page?: number;
  pageSize?: number;
  status?: Notification['status'];
  unreadOnly?: boolean;
}

export interface UnreadCount {
  count: number;
}

export interface NotificationReadResult extends Notification {
  unreadCount: number;
}

export interface MarkAllNotificationsReadResult {
  marked: number;
  readAt: string;
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// 绩效改进计划
// ---------------------------------------------------------------------------

export interface ImprovementMeasure {
  description: string;
  responsible: string;
  deadline: string;
}

export interface ImprovementPlan {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeNo?: string;
  deptName?: string;
  cycleId: string;
  cycleName?: string;
  taskId: string;
  creatorId: string | null;
  creatorName?: string;
  improvementNeed: string | null;
  importance: string | null;
  improvementGoal: string | null;
  targetDate: string | null;
  measures: ImprovementMeasure[];
  finalScore: number | null;
  status: ImprovementPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ImprovementPlanQuery {
  page?: number;
  pageSize?: number;
  status?: ImprovementPlanStatus;
  employeeId?: string;
  cycleId?: string;
}

export interface FillImprovementPlanBody {
  improvementNeed: string;
  importance: string;
  improvementGoal: string;
  targetDate: string;
  measures: ImprovementMeasure[];
}

export interface CompleteImprovementPlanBody {
  finalScore: number;
}

export interface ConsecutiveDWarning {
  hasWarning: boolean;
  consecutiveCount: number;
  archives: Array<{
    cycleId: string;
    cycleName: string;
    grade: PerfGrade;
    archivedAt: string;
  }>;
}

export interface ConsecutiveDWarningItem {
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  consecutiveCount: number;
  archives: Array<{
    cycleId: string;
    cycleName: string;
    grade: PerfGrade;
    archivedAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// 试用期考核（Probation Review）
// ---------------------------------------------------------------------------

export interface ProbationReviewIndicator {
  id: string;
  name: string;
  type: ProbationIndicatorType;
  weight: number;
  description?: string | null;
  targetValue?: string | null;
  selfScore?: number | null;
  selfComment?: string | null;
  managerScore?: number | null;
  managerComment?: string | null;
  sortOrder: number;
}

export interface ProbationReview {
  id: string;
  status: ProbationReviewStatus;
  employeeId: string;
  employee: { id: string; name: string };
  managerId: string;
  manager: { id: string; name: string };
  hrId: string;
  hr: { id: string; name: string };
  plannedRegularDate?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  employeeSignedAt?: string | null;
  managerSignedAt?: string | null;
  hrSignedAt?: string | null;
  completedAt?: string | null;
  indicators: ProbationReviewIndicator[];
  signatures: Signature[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProbationReviewQuery {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  managerId?: string;
  status?: ProbationReviewStatus;
  keyword?: string;
}

export interface CreateProbationReviewBody {
  employeeId: string;
  managerId: string;
  plannedRegularDate?: string;
  indicators?: Array<{
    name: string;
    type: ProbationIndicatorType;
    weight: number;
    description?: string;
    targetValue?: string;
    sortOrder?: number;
  }>;
}

export type UpdateProbationReviewBody = Partial<CreateProbationReviewBody>;

export interface SubmitProbationSelfEvalBody {
  indicators: Array<{ id: string; selfScore: number; selfComment?: string }>;
}

export interface SubmitProbationManagerScoreBody {
  indicators: Array<{
    id: string;
    managerScore: number;
    managerComment?: string;
  }>;
  strengths?: string;
  improvements?: string;
}

export interface ProbationReviewActionResult {
  id: string;
  status: ProbationReviewStatus;
}

// ---------------------------------------------------------------------------
// 转正申请（Confirmation Application）
// ---------------------------------------------------------------------------

export interface ConfirmationApplication {
  id: string;
  status: ConfirmationStatus;
  employeeId: string;
  employee: { id: string; name: string };
  probationReviewId?: string | null;
  managerId: string;
  manager: { id: string; name: string };
  hrId: string;
  hr: { id: string; name: string };
  companyApproverId: string;
  companyApprover: { id: string; name: string };
  summary?: string | null;
  salary?: number | null;
  voteResult?: VoteResult | null;
  voteParticipants?: string[];
  voteComment?: string | null;
  voteMeetingTime?: string | null;
  actualRegularDate?: string | null;
  rejectedBy?: { id: string; name: string } | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
  steps?: ApprovalStep[];
  canApprove?: boolean;
  canReject?: boolean;
  pendingRole?: 'manager' | 'hr' | 'company' | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApprovalStep {
  role: 'manager' | 'hr' | 'company';
  status: 'pending' | 'approved' | 'rejected';
  approver: { id: string; name: string } | null;
  comment: string | null;
  actedAt: string | null;
}

export interface ConfirmationQuery {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  status?: ConfirmationStatus;
  keyword?: string;
}

export interface CreateConfirmationBody {
  employeeId: string;
  probationReviewId?: string;
  managerId: string;
  hrId: string;
  companyApproverId: string;
  summary?: string;
  salary?: number;
  voteResult?: VoteResult;
  voteParticipants?: string[];
  voteComment?: string;
  voteMeetingTime?: string;
  actualRegularDate?: string;
}

export type UpdateConfirmationBody = Partial<CreateConfirmationBody>;

export interface ConfirmationWarning {
  employeeId: string;
  employeeName: string;
  employeeNo: string | null;
  deptName: string | null;
  plannedRegularDate: string | null;
  daysUntil: number | null;
  hasApplication: boolean;
}

// ---------------------------------------------------------------------------
// 三方签字（SignBlock 用）
// ---------------------------------------------------------------------------

export interface Signature {
  id: string;
  businessType: SignatureBusinessType;
  businessRecordId: string;
  role: SignatureRole;
  signerId: string;
  signerName: string;
  signedAt: string;
  method: SignatureMethod;
  imageUrl?: string | null;
}

export interface SignatureQuery {
  businessType: SignatureBusinessType;
  businessRecordId: string;
}

export interface CreateSignatureBody {
  businessType: SignatureBusinessType;
  businessRecordId: string;
  role: SignatureRole;
  method?: SignatureMethod;
  imageUrl?: string;
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// 目标地图（E1）
// ---------------------------------------------------------------------------

export interface Objective {
  id: string;
  title: string;
  description: string | null;
  level: ObjectiveLevel;
  deptId: string | null;
  deptName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  parentId: string | null;
  cycleId: string | null;
  cycleName: string | null;
  weight: number | null;
  priority: number;
  progress: number;
  status: ObjectiveStatus;
  reviewStatus: ObjectiveReviewStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  canReview: boolean;
  ownerReportingDepth: number | null;
  relatedIndicatorId: string | null;
  relatedIndicatorName: string | null;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Objective[];
}

export interface ObjectiveQuery {
  page?: number;
  pageSize?: number;
  level?: ObjectiveLevel;
  deptId?: string;
  ownerId?: string;
  parentId?: string | null;
  cycleId?: string;
  status?: ObjectiveStatus;
  keyword?: string;
  flat?: boolean;
}

export interface CreateObjectiveBody {
  title: string;
  description?: string;
  level: ObjectiveLevel;
  deptId?: string;
  ownerId?: string;
  parentId?: string;
  cycleId?: string;
  weight?: number;
  priority?: number;
  relatedIndicatorId?: string;
}

export type UpdateObjectiveBody = Partial<CreateObjectiveBody> & {
  status?: ObjectiveStatus;
};

export interface UpdateObjectiveProgressBody {
  progress: number;
}

export interface ObjectiveReviewBody {
  expectedUpdatedAt: string;
  comment?: string;
}

export interface GoalTrackingLatestProgress {
  id: string;
  title?: string;
  content?: string;
  progress: number | null;
  healthStatus?: GoalTrackingHealthStatus | null;
  attachments?: Attachment[];
  createdBy?: string;
  creatorName?: string;
  updatedAt: string;
  businessPeriodKey: string;
  source: 'active_progress' | 'monthly_self_evaluation';
}

export type GoalTrackingHealthStatus = 'on_track' | 'at_risk' | 'blocked' | 'completed';

export interface GoalTrackingSelfEvaluationResult {
  periodKey: string;
  selfScore: number | null;
  submittedAt: string;
}

export interface GoalTrackingItem {
  id: string;
  title: string;
  taskId?: string;
  description?: string | null;
  scoringStandard?: string | null;
  dataSource?: string | null;
  dataCaliber?: string | null;
  targetValue?: number | null;
  targetValueText?: string | null;
  unit?: string | null;
  indicatorType?: IndicatorType;
  dimensionName?: string | null;
  dimensionWeight?: number;
  visibilityScope?: IndicatorVisibilityScope;
  visibilityScopes?: IndicatorVisibilityScope[];
  ownerId: string | null;
  ownerName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  priority: number;
  status: ObjectiveStatus;
  progress: number;
  weight: number | null;
  latestProgress: GoalTrackingLatestProgress | null;
  latestSelfEvaluation: GoalTrackingSelfEvaluationResult | null;
}

export interface GoalTrackingResult {
  taskId?: string | null;
  taskStatus?: TaskStatus | null;
  canEdit?: boolean;
  monthlyFollowUpRequired?: boolean;
  summary?: {
    periodCount: number;
    employeeSubmittedCount: number;
    managerCompletedCount: number;
    activeBusinessPeriodKey: string | null;
    activeUpdatedGoalCount: number;
    goalCount: number;
    latestSelfEvaluation: {
      periodKey: string;
      selfScoreTotal: number | null;
      submittedAt: string;
    } | null;
  };
  totalWeight: number;
  items: GoalTrackingItem[];
}

export interface GoalTrackingChangeRecord {
  id: string;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface GoalTrackingIndicatorDetail extends GoalTrackingItem {
  taskStatus: TaskStatus;
  canEdit: boolean;
  activeBusinessPeriodKey: string | null;
  actualValue: number | null;
  actualNote: string | null;
  alignedObjectives: Array<{
    id: string;
    title: string;
    level: ObjectiveLevel;
    ownerId: string | null;
  }>;
  alignedParentIndicators?: IndicatorAlignmentCandidate[];
  progressUpdates: GoalTrackingLatestProgress[];
  selfEvaluationResults: GoalTrackingSelfEvaluationResult[];
  changeRecords: GoalTrackingChangeRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateGoalTrackingProgressBody {
  progress: number;
  healthStatus: GoalTrackingHealthStatus;
  content: string;
  expectedLatestUpdateAt?: string | null;
}

export type PeriodMonitoringStatus = 'employee_pending' | 'employee_overdue' | 'manager_pending' | 'manager_completed';

export interface PeriodMonitoringQuery {
  page?: number;
  pageSize?: number;
  periodKey?: string;
  status?: PeriodMonitoringStatus;
  keyword?: string;
}

export interface PeriodMonitoringRow {
  id: string;
  taskId: string;
  periodKey: string;
  sequence: number;
  status: AssessmentPeriodStatus;
  derivedStatus: PeriodMonitoringStatus;
  draftVersion: number;
  employeeId: string;
  employeeNo: string | null;
  employeeName: string;
  deptName: string | null;
  managerName: string | null;
  selfEvalOpenAt: string;
  selfEvalDueAt: string;
  managerDueAt: string;
  employeeSubmittedAt: string | null;
  managerSubmittedAt: string | null;
  lockedAt: string | null;
  selfScoreTotal: number | null;
  managerScoreTotal: number | null;
  selfGrade: PerfGrade | null;
  managerGrade: PerfGrade | null;
  canReopen: boolean;
  reopenBlockedReason: string | null;
}

export interface PeriodMonitoringResult extends Paginated<PeriodMonitoringRow> {
  cycle: { id: string; name: string };
  summary: {
    employeePending: number;
    employeeOverdue: number;
    managerPending: number;
    managerCompleted: number;
    total: number;
  };
}

export interface ReopenPeriodReviewBody {
  expectedVersion: number;
  reason: string;
}

export interface GoalTrackingQuery {
  ownerId?: string;
  cycleId?: string;
  objectiveId?: string;
}

// ---------------------------------------------------------------------------
// 行动计划（E2）
// ---------------------------------------------------------------------------

export interface ActionItem {
  id: string;
  objectiveId: string;
  objectiveTitle: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: ActionItemStatus;
  parentId: string | null;
  progress: number;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
  children?: ActionItem[];
}

export interface ActionItemQuery {
  objectiveId?: string;
  status?: ActionItemStatus;
  assigneeId?: string;
  parentId?: string | null;
  page?: number;
  pageSize?: number;
}

export interface CreateActionItemBody {
  objectiveId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  startDate?: string;
  dueDate?: string;
  status?: ActionItemStatus;
  parentId?: string;
  progress?: number;
}

export type UpdateActionItemBody = Partial<Omit<CreateActionItemBody, 'objectiveId'>>;

export interface UpdateActionItemProgressBody {
  progress: number;
}
