ALTER TYPE "cycle_status" ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'indicator_setting';
ALTER TYPE "cycle_status" ADD VALUE IF NOT EXISTS 'launch_blocked' BEFORE 'indicator_setting';
ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'goal_confirmed' BEFORE 'self_eval';

ALTER TABLE "assessment_cycles"
  ADD COLUMN "goal_setting_open_at" TIMESTAMPTZ(6),
  ADD COLUMN "self_eval_open_at" TIMESTAMPTZ(6),
  ADD COLUMN "hr_owner_id" UUID,
  ADD COLUMN "participant_dept_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "participant_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "explicit_exempt_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "scheduled_at" TIMESTAMPTZ(6),
  ADD COLUMN "scheduled_by_id" UUID,
  ADD COLUMN "launch_plan" JSONB,
  ADD COLUMN "launch_plan_hash" VARCHAR(64),
  ADD COLUMN "opened_at" TIMESTAMPTZ(6),
  ADD COLUMN "opened_by_id" UUID,
  ADD COLUMN "open_source" VARCHAR(20),
  ADD COLUMN "launch_blocked_at" TIMESTAMPTZ(6),
  ADD COLUMN "launch_blocked_reason" TEXT;

ALTER TABLE "assessment_cycles"
  ADD CONSTRAINT "assessment_cycles_hr_owner_id_fkey"
  FOREIGN KEY ("hr_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "assessment_cycles" AS cycle
SET "hr_owner_id" = cycle."created_by"
FROM "users" AS owner
WHERE cycle."created_by" = owner."id"
  AND owner."sys_role" = 'hr'
  AND owner."deleted_at" IS NULL
  AND owner."status" <> 'resigned';

CREATE INDEX "assessment_cycles_hr_owner_id_idx"
  ON "assessment_cycles"("hr_owner_id");

CREATE INDEX "assessment_cycles_status_goal_setting_open_at_idx"
  ON "assessment_cycles"("status", "goal_setting_open_at");

CREATE INDEX "assessment_cycles_status_self_eval_open_at_idx"
  ON "assessment_cycles"("status", "self_eval_open_at");
