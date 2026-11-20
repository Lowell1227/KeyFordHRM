/**
 * 人才库类型与固定词表（需求 v2）。
 * 词表与 api/src/talent-pool/talent.constants.ts 保持一致：数据库存英文 key，展示层映射中文。
 */

export const TALENT_STATUSES = ['new', 'contacted', 'interviewing', 'hired', 'rejected', 'reserve'] as const;
export type TalentEmploymentStatus = 'active' | 'probation' | 'resigned' | 'pending_entry' | 'unknown';
export const TALENT_EMPLOYMENT_STATUS_LABELS: Record<TalentEmploymentStatus, string> = {
  active: '在职', probation: '试用', resigned: '已离职', pending_entry: '待入职', unknown: '关联待核对',
};
export type TalentStatus = (typeof TALENT_STATUSES)[number];
export const TALENT_STATUS_LABELS: Record<TalentStatus, string> = {
  new: '新入库',
  contacted: '沟通中',
  interviewing: '面试中',
  hired: '已入职',
  rejected: '已淘汰',
  reserve: '人才储备',
};
/** 状态 pill 颜色（需求 §5.1：新入库灰、沟通中蓝、面试中橙、已入职绿、已淘汰浅灰、储备紫）。 */
export const TALENT_STATUS_TAG: Record<TalentStatus, { type: 'info' | 'primary' | 'warning' | 'success' | 'danger'; effect?: 'light' }> = {
  new: { type: 'info' },
  contacted: { type: 'primary' },
  interviewing: { type: 'warning' },
  hired: { type: 'success' },
  rejected: { type: 'info', effect: 'light' },
  reserve: { type: 'danger', effect: 'light' },
};

export const TALENT_SOURCE_CHANNELS = [
  'referral', 'job_site', 'campus', 'headhunter', 'social', 'offline_event', 'email', 'other',
] as const;
export type TalentSourceChannel = (typeof TALENT_SOURCE_CHANNELS)[number];
export const TALENT_SOURCE_LABELS: Record<TalentSourceChannel, string> = {
  referral: '内推',
  job_site: '招聘网站',
  campus: '校招',
  headhunter: '猎头',
  social: '社媒',
  offline_event: '线下活动',
  email: '邮箱投递',
  other: '其他',
};

export const TALENT_TAGS = [
  'sales', 'design', 'supply_chain', 'functional', 'management', 'project_management', 'ecommerce_operations',
  'fresh_grad', 'same_industry', 'immediate_available', 'high_potential', 'interviewed_rejected',
] as const;
export type TalentTag = (typeof TALENT_TAGS)[number];
export const TALENT_TAG_LABELS: Record<TalentTag, string> = {
  sales: '销售',
  design: '设计',
  supply_chain: '供应链',
  functional: '职能',
  management: '管理岗',
  project_management: '项目管理',
  ecommerce_operations: '电商运营',
  fresh_grad: '应届生',
  same_industry: '同行业',
  immediate_available: '可即刻到岗',
  high_potential: '高潜',
  interviewed_rejected: '已面未录',
};

export const FOLLOW_UP_CHANNELS = ['phone', 'wechat', 'email', 'face_to_face', 'other'] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];
export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = {
  phone: '电话',
  wechat: '微信',
  email: '邮件',
  face_to_face: '面谈',
  other: '其他',
};

export const EDUCATION_OPTIONS = ['high_school', 'college', 'bachelor', 'master', 'doctorate', 'other'] as const;
export type EducationOption = (typeof EDUCATION_OPTIONS)[number];
export const EDUCATION_LABELS: Record<EducationOption, string> = {
  high_school: '高中及以下',
  college: '大专',
  bachelor: '本科',
  master: '硕士',
  doctorate: '博士',
  other: '其他',
};

export const TALENT_GENDERS = ['male', 'female', 'unknown'] as const;
export type TalentGender = (typeof TALENT_GENDERS)[number];
export const TALENT_GENDER_LABELS: Record<TalentGender, string> = {
  male: '男',
  female: '女',
  unknown: '未知',
};

/** GET /talents 列表项（含附件计数与最新下次跟进日期）。 */
export interface TalentCandidateListItem {
  employmentStatus?: TalentEmploymentStatus | null;
  id: string;
  editVersion: string;
  name: string;
  phone: string;
  email: string | null;
  gender: TalentGender;
  birthYear: number | null;
  currentCompany: string | null;
  currentPosition: string | null;
  yearsOfExperience: number | null;
  education: string | null;
  educationReferenceDataId?: string | null;
  school: string | null;
  major: string | null;
  expectCity: string | null;
  expectSalaryMin: number | null;
  expectSalaryMax: number | null;
  expectSalaryMinYuan?: number | null;
  expectSalaryMaxYuan?: number | null;
  expectSalaryUnit?: string;
  salaryNeedsReview?: boolean;
  sourceChannel: TalentSourceChannel;
  appliedPosition: string | null;
  status: TalentStatus;
  tags: TalentTag[];
  note: string | null;
  lastFollowUpAt: string | null;
  convertedUserId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextFollowUpAt: string | null;
  fileCount: number;
  ownerId?: string | null;
  ownerName?: string | null;
  latestApplication?: Pick<TalentApplicationView, 'id' | 'positionName' | 'stage'> | null;
  onboardingRequest?: TalentOnboardingRequest | null;
}

export interface TalentResumeFile {
  id: string;
  candidateId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sortOrder: number;
  uploadedById: string;
  createdAt: string;
}

export interface TalentFollowUp {
  id: string;
  candidateId: string;
  occurredAt: string;
  channel: FollowUpChannel;
  summary: string;
  nextFollowUpAt: string | null;
  createdById: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface TalentShareRecord {
  id: string;
  candidateId: string;
  token: string;
  recipientIds: string[];
  isPublicLink: boolean;
  includeResume: boolean;
  message: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  lastViewedById: string | null;
  createdById: string;
  createdAt: string;
  /** 接收人姓名（后端详情接口关联，与 recipientIds 同序）。 */
  recipientNames?: string[];
}

/** GET /talents/:id 详情（含简历、跟进、分享记录）。 */
export interface TalentCandidateDetail extends Omit<TalentCandidateListItem, 'nextFollowUpAt' | 'fileCount'> {
  deletedAt: string | null;
  createdById: string;
  updatedById: string | null;
  files: TalentResumeFile[];
  followUps: TalentFollowUp[];
  shares: TalentShareRecord[];
}

/** GET /talents 查询参数。 */
export interface TalentQuery {
  applicationPosition?: string;
  applicationStage?: TalentApplicationStage;
  keyword?: string;
  status?: TalentStatus;
  source?: TalentSourceChannel;
  tag?: TalentTag;
  salaryMin?: number;
  salaryMax?: number;
  salaryMinYuan?: number;
  salaryMaxYuan?: number;
  dueOnly?: boolean;
  staleOnly?: boolean;
  mineOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/** POST/PATCH /talents 请求体（PATCH 为 Partial）。 */
export interface TalentCandidateInput {
  ownerId?: string;
  name?: string;
  phone?: string;
  email?: string | null;
  gender?: TalentGender;
  birthYear?: number | null;
  currentCompany?: string | null;
  currentPosition?: string | null;
  yearsOfExperience?: number | null;
  education?: string | null;
  educationReferenceDataId?: string | null;
  school?: string | null;
  major?: string | null;
  expectCity?: string | null;
  expectSalaryMin?: number | null;
  expectSalaryMax?: number | null;
  expectSalaryMinYuan?: number | null;
  expectSalaryMaxYuan?: number | null;
  sourceChannel?: TalentSourceChannel;
  appliedPosition?: string | null;
  status?: TalentStatus;
  tags?: TalentTag[];
  note?: string | null;
  /** 旧客户端兼容字段；服务端拒绝手动关联，须办理入职并确认到岗。 */
  userId?: string;
}

export type UpdateTalentInput = TalentCandidateInput & { editVersion: string };

/** GET /talents/check-phone 响应。 */
export interface TalentPhoneCheckResult {
  exists: boolean;
  candidate?: { id: string; name: string; status: TalentStatus; statusLabel: string };
}

/** POST /talents/:id/files 绑定已上传文件。 */
export interface BindTalentFileBody {
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

/** POST /talents/:id/follow-ups 请求体。 */
export interface CreateFollowUpBody {
  occurredAt?: string;
  channel: FollowUpChannel;
  summary: string;
  nextFollowUpAt?: string | null;
}

/** POST /talents/:id/shares 请求体。 */
export interface CreateShareBody {
  requestId?: string;
  isPublicLink?: boolean;
  recipientIds?: string[];
  expiresInDays: 7 | 30;
  includeResume?: boolean;
  message?: string;
}

export interface CreateShareResult {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

/** 被分享人脱敏视图（严格字段白名单，需求 §5.4）。 */
export interface SharedCandidateView {
  name: string;
  gender: TalentGender | null;
  genderLabel: string | null;
  age: number | null;
  currentCompany: string | null;
  currentPosition: string | null;
  yearsOfExperience: number | null;
  education: string | null;
  school: string | null;
  major: string | null;
  expectCity: string | null;
  appliedPosition: string | null;
  tags: string[];
  status: TalentStatus;
  statusLabel: string;
}

export interface ShareFileView {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/** GET /talents/shares/:token 响应。 */
export interface ShareView {
  token: string;
  message: string | null;
  includeResume: boolean;
  expiresAt: string;
  createdAt: string;
  candidate: SharedCandidateView;
  files: ShareFileView[];
}

/** 手机号查重冲突标识（响应 data.reason，HTTP 409）。 */
export const TALENT_PHONE_EXISTS = 'TALENT_PHONE_EXISTS';
/** 简历文件数量超限标识（响应 data.reason，HTTP 409）。 */
export const TALENT_FILE_LIMIT = 'TALENT_FILE_LIMIT';

export type TalentInterviewStatus = 'scheduled' | 'completed' | 'cancelled';
export const INTERVIEW_STATUS_LABELS: Record<TalentInterviewStatus, string> = { scheduled: '待面试', completed: '已完成', cancelled: '已取消' };
export const INTERVIEW_SYNC_LABELS: Record<string, string> = {
  unconfigured: '日程未配置', pending: '日程待同步', processing: '日程同步中', synced: '日程已同步', failed: '日程同步失败', uncertain: '日程结果待核对',
};
export interface TalentInterviewView {
  id: string;
  applicationId?: string | null;
  application?: Pick<TalentApplicationView, 'positionName' | 'recruitmentBatch'> | null;
  candidateNameSnapshot: string;
  startsAt: string;
  endsAt: string;
  invitationText: string;
  meetingUrl: string | null;
  status: TalentInterviewStatus;
  version: number;
  sourceDeleted: boolean;
  participantNames: string[];
  candidateId?: string;
  note?: string | null;
  participants?: Array<{ userId: string; userNameSnapshot: string }>;
  syncStatus?: string;
  calendarSyncedVersion?: number;
}
export interface TalentInterviewInput {
  requestId?: string;
  candidateId: string;
  applicationId?: string;
  startsAt: string;
  endsAt: string;
  participantIds: string[];
  invitationText: string;
  meetingUrl?: string | null;
  note?: string | null;
}
export interface TalentDeleteImpact {
  candidateId: string;
  version: string;
  requiresForce: boolean;
  interviews: Array<{ id: string; status: TalentInterviewStatus; version: number; startsAt: string }>;
  requests: Array<{ id: string; recordStatus: string; onboardingStatus: string; requestVersion: number; updatedAt: string }>;
}

export type TalentApplicationStage = 'screening' | 'interviewing' | 'hiring_review' | 'offered' | 'accepted' | 'declined' | 'rejected' | 'reserve' | 'withdrawn' | 'onboarding' | 'hired';
export const APPLICATION_STAGE_LABELS: Record<TalentApplicationStage, string> = {
  screening: '初筛', interviewing: '面试中', hiring_review: '待录用确认', offered: '已确认录用', accepted: '已接受录用',
  declined: '已拒绝录用', rejected: '已淘汰', reserve: '人才储备', withdrawn: '已撤回', onboarding: '入职办理中', hired: '已入职',
};
export type TalentApplicationAction = 'start_interview' | 'submit_hiring' | 'approve_hiring' | 'return_hiring' | 'accept_offer' | 'decline_offer' | 'reject' | 'reserve' | 'withdraw' | 'reopen';
export type TalentReserveReason = 'commute_distance' | 'salary_expectation' | 'work_schedule' | 'other';
export const TALENT_RESERVE_REASON_LABELS: Record<TalentReserveReason, string> = {
  commute_distance: '通勤距离', salary_expectation: '薪资期望', work_schedule: '工作制偏好', other: '其他',
};
export const APPLICATION_ACTION_LABELS: Record<TalentApplicationAction, string> = {
  start_interview: '进入面试', submit_hiring: '提交录用', approve_hiring: '确认录用', return_hiring: '退回经办',
  accept_offer: '候选人接受', decline_offer: '候选人拒绝', reject: '淘汰', reserve: '转储备', withdraw: '撤回应聘', reopen: '重开应聘',
};
export interface TalentOnboardingRequest {
  id: string;
  onboardingStatus: string | null;
  recordStatus: string;
  cancelledAt: string | null;
  archivedAt?: string | null;
}
export interface TalentApplicationEvent {
  reserveReasons?: TalentReserveReason[];
  id: string;
  applicationId: string;
  actorId: string;
  actorName: string | null;
  action: string;
  fromStage: TalentApplicationStage | null;
  toStage: TalentApplicationStage;
  version: number;
  note: string | null;
  createdAt: string;
}
export interface TalentApplicationView {
  id: string;
  candidateId: string;
  candidateName?: string;
  positionName: string;
  recruitmentBatch: string | null;
  deptId: string | null;
  departmentNameSnapshot: string | null;
  ownerId: string;
  ownerName: string | null;
  creatorName: string | null;
  stage: TalentApplicationStage;
  revision: number;
  expectedEntryDate: string | null;
  hiringReason: string | null;
  hiringRequestedById: string | null;
  hiringRequestedAt: string | null;
  hiringReviewedById: string | null;
  hiringReviewedAt: string | null;
  reviewReturnStage: TalentApplicationStage | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  allowedActions: string[];
  events: TalentApplicationEvent[];
  onboardingRequest: TalentOnboardingRequest | null;
}
export interface TalentApplicationInput {
  positionName: string;
  recruitmentBatch?: string | null;
  deptId?: string | null;
  ownerId?: string;
  expectedEntryDate?: string | null;
}
export interface TalentRecruitmentOwner { id: string; name: string; employeeNo: string | null; deptName: string | null }
export type TalentFeedbackOutcome = 'pass' | 'reject' | 'pending';
export const FEEDBACK_OUTCOME_LABELS: Record<TalentFeedbackOutcome, string> = { pass: '通过', reject: '不通过', pending: '待定' };
export interface TalentInterviewFeedbackView {
  interviewId: string;
  userId: string;
  userName: string | null;
  status: 'draft' | 'submitted';
  outcome: TalentFeedbackOutcome | null;
  summary: string | null;
  revision: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history?: TalentFeedbackHistory[];
}
export interface TalentFeedbackHistory {
  actorName?: string | null;
  action: string;
  summary?: string | null;
  outcome?: TalentFeedbackOutcome | null;
  note?: string | null;
  createdAt: string;
  revision: number;
}
export interface TalentFeedbackResponse {
  interviewVersion: number;
  own: TalentInterviewFeedbackView | null;
  items: TalentInterviewFeedbackView[];
  canEdit: boolean;
  canReturn: boolean;
}
