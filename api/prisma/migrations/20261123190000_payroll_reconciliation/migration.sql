ALTER TABLE "payroll_batches"
  DROP CONSTRAINT IF EXISTS "payroll_batches_purpose_check";

ALTER TABLE "payroll_batches"
  ADD CONSTRAINT "payroll_batches_purpose_check"
  CHECK ("purpose" IN ('trial', 'validation', 'formal', 'reconciliation'));
