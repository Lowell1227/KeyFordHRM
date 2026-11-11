/**
 * 免审直改的档案个人信息字段（需求：docs/requirements/2026-11-11-archive-review-exemption.md）。
 * 这些字段保存后直接写入正式数据并记录审计日志，不进入审核队列；
 * 组织、任职、合同、社保/公积金、证件、绩效上级等字段仍走原有审核流。
 */
export const DIRECT_APPLY_PROFILE_FIELDS = [
  'phone',
  'gender',
  'birthDate',
  'ethnicity',
  'education',
  'professionalTitle',
  'school',
  'graduationDate',
  'major',
  'maritalStatus',
  'childrenStatus',
  'childrenCount',
  'politicalStatus',
  'nativePlace',
  'householdType',
  'idAddress',
  'currentAddress',
  'emergencyContactName',
  'emergencyContactRelation',
  'emergencyContactPhone',
] as const;

export type DirectApplyProfileField = (typeof DIRECT_APPLY_PROFILE_FIELDS)[number];

export const DIRECT_APPLY_PROFILE_FIELD_LABELS: Record<DirectApplyProfileField, string> = {
  phone: '手机号',
  gender: '性别',
  birthDate: '出生日期',
  ethnicity: '民族',
  education: '学历',
  professionalTitle: '职称',
  school: '毕业院校',
  graduationDate: '毕业日期',
  major: '专业',
  maritalStatus: '婚姻状况',
  childrenStatus: '子女状况',
  childrenCount: '子女数量',
  politicalStatus: '政治面貌',
  nativePlace: '籍贯',
  householdType: '户籍类型',
  idAddress: '身份证地址',
  currentAddress: '现住址',
  emergencyContactName: '紧急联系人',
  emergencyContactRelation: '与联系人关系',
  emergencyContactPhone: '紧急联系电话',
};
