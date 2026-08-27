ALTER TYPE "sys_role" ADD VALUE IF NOT EXISTS 'hr_user' AFTER 'hr';

ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hr_capabilities" VARCHAR(60)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(60)[];

ALTER TABLE "assessment_cycles"
  ADD COLUMN "reviewer_id" UUID,
  ADD COLUMN "review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "review_comment" TEXT,
  ADD COLUMN "monthly_follow_up_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "assessment_tasks" ALTER COLUMN "snapshot_id" DROP NOT NULL;

-- Preserve already-created cycles: the new approval gate only applies to plans
-- created or edited after this release.
UPDATE "assessment_cycles"
SET
  "reviewer_id" = COALESCE("hr_owner_id", "created_by"),
  "review_status" = 'approved',
  "reviewed_at" = CURRENT_TIMESTAMP;

CREATE INDEX "assessment_cycles_reviewer_id_review_status_idx"
  ON "assessment_cycles"("reviewer_id", "review_status");

ALTER TABLE "assessment_cycles"
  ADD CONSTRAINT "assessment_cycles_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
