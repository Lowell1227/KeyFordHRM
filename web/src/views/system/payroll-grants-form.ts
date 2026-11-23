export function grantDraftErrors(draft: { subjectId: string; userId: string; capabilities: string[]; reason: string }, allowed: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.subjectId) errors.subjectId = '请选择公司主体';
  if (!draft.userId) errors.userId = '请选择人员';
  if (!draft.capabilities.length || new Set(draft.capabilities).size !== draft.capabilities.length
    || draft.capabilities.some(value => !allowed.includes(value))) errors.capabilities = '请选择有效且不重复的操作权限';
  if (!draft.reason.trim() || draft.reason.length > 500) errors.reason = '请填写授权依据，不超过500字';
  return errors;
}
