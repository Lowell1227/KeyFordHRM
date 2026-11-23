export function openingCorrectionErrors(form: { amount: string; reference: string; reason: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(form.amount)) errors.amount = '请填写明确的金额，最多两位小数';
  if (!form.reference.trim() || form.reference.trim().length > 200) errors.reference = '请填写不超过200字的更正确认凭证';
  if (!form.reason.trim() || form.reason.trim().length > 500) errors.reason = '请填写不超过500字的更正原因';
  return errors;
}
export function openingAuditChanges(before: { amount: string | null; reference: string | null }, after: { amount: string | null; reference: string | null }) {
  return [{ label: '历史已付金额', before: before.amount ?? '待确认', after: after.amount ?? '待确认' },
    { label: '确认凭证', before: before.reference || '待确认', after: after.reference || '待确认' }];
}
