import type { TalentCandidateInput } from '@/types/talent.types';
import { talentSalaryYuan } from '@/utils/talent-salary';
import type { IntakeEvent, PostingFields } from '@/types/recruitment-intake.types';

export const INTAKE_STATE_LABELS = {
  awaiting_resume: '待收简历', pending_review: '待核对', needs_material: '待补资料', completed: '已入库', closed: '已关闭',
};
export const INTAKE_PARSE_LABELS: Record<string, string> = {
  idle: '未解析', pending: '等待解析', processing: '解析中', succeeded: '解析完成', failed: '解析失败', timed_out: '解析超时',
};
export const INTAKE_FIELD_LABELS: Record<string, string> = {
  name: '姓名', phone: '手机号', email: '邮箱', gender: '性别', birthYear: '出生年', birthMonth: '出生月', reportedAge: '自报年龄',
  currentCompany: '目前公司', currentPosition: '目前岗位', yearsOfExperience: '工作年限', education: '学历', school: '学校', major: '专业',
  appliedPosition: '意向岗位', expectCity: '意向城市', expectSalaryMin: '期望薪资下限（K/月）', expectSalaryMax: '期望薪资上限（K/月）',
};
export function applyIntakeSuggestions(draft: TalentCandidateInput, fields: Record<string, unknown>, selected: string[]): TalentCandidateInput {
  const result = { ...draft };
  for (const key of selected) {
    if (!Object.prototype.hasOwnProperty.call(INTAKE_FIELD_LABELS, key)) continue;
    const value = fields[key];
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) continue;
    if (key === 'expectSalaryMin' || key === 'expectSalaryMax') {
      if (typeof value !== 'number') continue;
      const salary = talentSalaryYuan({ [key]: value }); if (salary.needsReview) continue;
      delete result[key]; Object.assign(result, { [`${key}Yuan`]: key === 'expectSalaryMin' ? salary.min : salary.max });
    }
    else Object.assign(result, { [key]: value });
    if (key === 'education') result.educationReferenceDataId = null;
    if (key === 'birthYear' && value !== draft.birthYear && !selected.includes('birthMonth')) result.birthMonth = null;
  }
  return result;
}
export function validateIntakeDraft(value: TalentCandidateInput, required = false): Record<string, string> {
  const errors: Record<string, string> = {};
  const limits: Partial<Record<keyof TalentCandidateInput, number>> = { name: 50, email: 100, currentCompany: 150, currentPosition: 100, education: 100, school: 200, major: 150, expectCity: 100, appliedPosition: 100, note: 500 };
  for (const [key, max] of Object.entries(limits)) { const text = value[key as keyof TalentCandidateInput]; if (text != null && (typeof text !== 'string' || text.length > max!)) errors[key] = `最多${max}字`; }
  if (required && !value.name?.trim()) errors.name = '请填写姓名';
  if ((required || value.phone) && !/^1\d{10}$/.test(value.phone || '')) errors.phone = '请填写11位有效手机号';
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.email = '邮箱格式不正确';
  if (required && !value.sourceChannel) errors.sourceChannel = '请选择实际资料来源';
  const ranges = { yearsOfExperience: [0, 60], birthYear: [1900, new Date().getFullYear()], birthMonth: [1, 12], reportedAge: [0, 150], expectSalaryMinYuan: [0, 2147483647], expectSalaryMaxYuan: [0, 2147483647] } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) { const number = value[key]; const [min, max] = ranges[key]; if (number != null && (!Number.isInteger(number) || number < min || number > max)) errors[key] = `请填写${min}至${max}的整数`; }
  if (value.birthMonth != null && value.birthYear == null) errors.birthMonth = '填写出生月份时请同时填写出生年';
  if (value.education && !value.educationReferenceDataId) errors.education = '请选择启用的学历项';
  if (value.expectSalaryMinYuan != null && value.expectSalaryMaxYuan != null && value.expectSalaryMinYuan > value.expectSalaryMaxYuan) errors.expectSalaryMaxYuan = '薪资上限不能低于下限';
  return errors;
}
export function intakeResultTarget(value: { candidateId?: string | null; applicationId?: string | null } | null | undefined) {
  if (!value?.candidateId) return null;
  return { path: '/talents', query: { candidateId: value.candidateId, ...(value.applicationId ? { applicationId: value.applicationId } : {}) } };
}
export function safePostingUrl(value: string | null | undefined): string {
  if (!value) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
export function validatePosting(value: PostingFields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.demandId) errors.demandId = '请选择已批准的内部需求';
  if (!value.ownerId) errors.ownerId = '请选择招聘经办负责人';
  if (!value.channel.trim() || value.channel.length > 80) errors.channel = '请填写渠道（最多80字）';
  if (!value.name.trim() || value.name.length > 200) errors.name = '请填写外部职位名称（最多200字）';
  if (!safePostingUrl(value.url) || value.url.length > 2000) errors.url = '请填写无账号凭据的 HTTPS 职位链接';
  if (value.externalId && value.externalId.length > 200) errors.externalId = '外部职位ID最多200字';
  if ((value.verifiedIdentity && !value.evidence?.trim()) || (value.evidence?.length || 0) > 2000) errors.evidence = '核实身份须填写依据（最多2000字）';
  return errors;
}
export function intakeEventLabel(action: string): string {
  return ({ create_intake: '登记收件', update_intake: '保存核对资料', close_intake: '关闭收件', associate_intake: '关联原待收简历', upload_intake_file: '补充简历附件',
    start_intake_parse: '开始解析', finish_intake_parse: '解析完成', fail_intake_parse: '解析未完成', confirm_intake: '确认入库',
    create_posting: '登记外部职位', update_posting: '修改职位归属', remap_posting: '更换职位归属', receive_mail_intake: '收到邮件简历', associate_intake_source: '关联邮件来源' } as Record<string, string>)[action] || '资料更新';
}
export function intakeIssueLabel(issue: string): string {
  return ({ source_unverified: '请选择实际资料来源后再入库。', posting_unverified: '外部职位尚未核实，请核对职位及内部需求。',
    link_only: '只有链接，请补充简历文件或人工核对资料。', notification_only: '仅收到通知，请补充简历材料。',
    body_too_large: '正文过长，请补充简历文件或人工核对资料。', file_too_large: '附件过大，请重新上传10MB以内的简历。',
    unsupported_attachment: '附件无法读取，请补充PDF、Word或图片简历。', missing_material: '缺少简历材料，请补充文件或人工填写。',
  } as Record<string, string>)[issue] || '来源资料待核对，请补充或人工确认。';
}
export function intakeMappingHistory(event: Pick<IntakeEvent, 'metadata' | 'snapshot'>, previous?: Pick<IntakeEvent, 'snapshot'>) {
  const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const mapping = record(event.metadata?.mapping);
  if (!mapping && !event.snapshot) return [];
  const before = mapping ? mapping.before : previous?.snapshot ?? null, after = mapping ? mapping.after : event.snapshot;
  return ([['旧需求', before], ['新需求', after]] as const).map(([label, value]) => {
    const fields = record(value), id = typeof fields?.demandId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(fields.demandId) ? fields.demandId : null;
    return { label, reference: id ? id.length > 16 ? id.slice(0, 8) : id : value === null || fields?.demandId === null ? '未关联' : '未记录',
      target: id ? { path: '/recruitment/demands', query: { demandId: id } } : null,
      postingRevision: typeof fields?.postingRevision === 'number' && Number.isInteger(fields.postingRevision) && fields.postingRevision > 0 ? fields.postingRevision : null };
  });
}
export function intakeError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
  if (response?.status === 403) return '当前无权办理简历收件，请联系管理员核对招聘经办权限。';
  if (response?.status === 409) return '记录已变化，输入已保留。请刷新核对并重新确认，不会自动提交。';
  const message = response?.data?.message;
  return (Array.isArray(message) ? message.join('；') : message) || '操作未完成，请核对后重试。';
}
