-- A dedicated plan token protects draft edits, business review, and launch from stale writes.
-- Existing cycles start at version 1; only business-plan edits increment this value.
ALTER TABLE "assessment_cycles"
  ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1;
