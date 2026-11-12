/**
 * 人才库固定词表（需求 §4/§8，前后端共用）。
 * 数据库存英文 key，展示层用 LABELS 映射中文；本期不做配置页。
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

/** 跟进方式（需求 §4.3）。 */
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

/** 手机号查重冲突的业务标识（响应 data.reason）。 */
export const TALENT_PHONE_EXISTS = 'TALENT_PHONE_EXISTS';
/** 简历文件数量超限冲突的业务标识（响应 data.reason）。 */
export const TALENT_FILE_LIMIT = 'TALENT_FILE_LIMIT';
