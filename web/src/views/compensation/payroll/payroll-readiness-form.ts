import type { PayrollBatch } from '@/types/payroll.types';
import { completeNetVersion, currentVersion, needsUpdate } from './payroll-state';

export function readinessBatchEligible(batch: PayrollBatch): boolean {
  const version = currentVersion(batch);
  return batch.purpose === 'reconciliation' && batch.status === 'calculated' && !needsUpdate(batch)
    && !!version && !version.issues.length && completeNetVersion(batch);
}

export function readinessDraftErrors(draft: { batchId: string; firstMonth: string; reference: string }, batches: PayrollBatch[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const batch = batches.find(row => row.id === draft.batchId);
  if (!batch || !readinessBatchEligible(batch)) errors.batchId = '请选择完整的税后实发对账版本';
  if (!/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(draft.firstMonth)) errors.firstMonth = '请选择首个正式工资月';
  else if (batch && draft.firstMonth < batch.month) errors.firstMonth = '首个正式工资月不能早于对账月';
  if (!draft.reference.trim() || draft.reference.trim().length > 200) errors.reference = '请填写核对依据，不超过200字';
  return errors;
}
