/**
 * 人才库类型与固定词表（需求 v2）。
 * 词表与 api/src/talent-pool/talent.constants.ts 保持一致：数据库存英文 key，展示层映射中文。
 */

export const TALENT_STATUSES = ['new', 'contacted', 'interviewing', 'hired', 'rejected', 'reserve'] as const;
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
  'sales', 'design', 'supply_chain', 'functional', 'management',
  'fresh_grad', 'same_industry', 'immediate_available', 'high_potential', 'interviewed_rejected',
] as const;
export type TalentTag = (typeof TALENT_TAGS)[number];
export const TALENT_TAG_LABELS: Record<TalentTag, string> = {
  sales: '销售',
  design: '设计',
  supply_chain: '供应链',
  functional: '职能',
  management: '管理岗',
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
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: TalentGender;
  birthYear: number | null;
  currentCompany: string | null;
  currentPosition: string | null;
  yearsOfExperience: number | null;
  education: EducationOption | null;
  school: string | null;
  major: string | null;
  expectCity: string | null;
  expectSalaryMin: number | null;
  expectSalaryMax: number | null;
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
  keyword?: string;
  status?: TalentStatus;
  source?: TalentSourceChannel;
  tag?: TalentTag;
  salaryMin?: number;
  salaryMax?: number;
  dueOnly?: boolean;
  staleOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/** POST/PATCH /talents 请求体（PATCH 为 Partial）。 */
export interface TalentCandidateInput {
  name?: string;
  phone?: string;
  email?: string | null;
  gender?: TalentGender;
  birthYear?: number | null;
  currentCompany?: string | null;
  currentPosition?: string | null;
  yearsOfExperience?: number | null;
  education?: EducationOption | null;
  school?: string | null;
  major?: string | null;
  expectCity?: string | null;
  expectSalaryMin?: number | null;
  expectSalaryMax?: number | null;
  sourceChannel?: TalentSourceChannel;
  appliedPosition?: string | null;
  status?: TalentStatus;
  tags?: TalentTag[];
  note?: string | null;
  /** 仅在标记「已入职」时提供（PATCH /talents/:id 或 POST /talents/:id/convert）。 */
  userId?: string;
}

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
  recipientIds: string[];
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
