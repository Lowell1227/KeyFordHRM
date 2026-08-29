CREATE TYPE "assessment_period_revision_stage" AS ENUM ('employee', 'manager');

ALTER TABLE "assessment_periods"
  ADD COLUMN "self_eval_open_at" TIMESTAMPTZ(6),
  ADD COLUMN "self_eval_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "manager_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "employee_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "manager_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "self_score_total" DECIMAL(8,2),
  ADD COLUMN "manager_score_total" DECIMAL(8,2),
  ADD COLUMN "draft_version" INTEGER NOT NULL DEFAULT 0;

UPDATE "assessment_periods" ap
SET "self_eval_open_at" = cps."self_eval_open_at",
    "self_eval_due_at" = cps."self_eval_due_at",
    "manager_due_at" = cps."manager_due_at"
FROM "assessment_tasks" task
JOIN "cycle_period_schedules" cps
  ON cps."cycle_id" = task."cycle_id"
WHERE ap."task_id" = task."id"
  AND ap."period_key" = cps."period_key";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "assessment_periods"
    WHERE "self_eval_open_at" IS NULL
       OR "self_eval_due_at" IS NULL
       OR "manager_due_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'assessment period timing backfill incomplete';
  END IF;
END $$;

ALTER TABLE "assessment_periods"
  ALTER COLUMN "self_eval_open_at" SET NOT NULL,
  ALTER COLUMN "self_eval_due_at" SET NOT NULL,
  ALTER COLUMN "manager_due_at" SET NOT NULL;

CREATE TABLE "assessment_period_indicator_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period_id" UUID NOT NULL,
  "indicator_version_item_id" UUID NOT NULL,
  "progress" SMALLINT,
  "health_status" "indicator_progress_health",
  "actual_value_text" VARCHAR(200),
  "employee_comment" TEXT,
  "problem_reason" TEXT,
  "next_month_plan" TEXT,
  "support_needed" TEXT,
  "employee_attachments" JSONB NOT NULL DEFAULT '[]',
  "self_score" DECIMAL(6,2),
  "manager_score" DECIMAL(6,2),
  "manager_comment" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_period_indicator_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assessment_period_review_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period_id" UUID NOT NULL,
  "stage" "assessment_period_revision_stage" NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "idempotency_key" VARCHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_period_review_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_period_indicator_reviews_period_id_indicator_version_item_id_key"
  ON "assessment_period_indicator_reviews"("period_id", "indicator_version_item_id");
CREATE INDEX "assessment_period_indicator_reviews_period_id_idx"
  ON "assessment_period_indicator_reviews"("period_id");
CREATE UNIQUE INDEX "assessment_period_review_revisions_idempotency_key_key"
  ON "assessment_period_review_revisions"("idempotency_key");
CREATE UNIQUE INDEX "assessment_period_review_revisions_period_id_stage_revision_key"
  ON "assessment_period_review_revisions"("period_id", "stage", "revision");
CREATE INDEX "assessment_period_review_revisions_period_id_stage_idx"
  ON "assessment_period_review_revisions"("period_id", "stage");

ALTER TABLE "assessment_period_indicator_reviews"
  ADD CONSTRAINT "assessment_period_indicator_reviews_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "assessment_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_period_indicator_reviews"
  ADD CONSTRAINT "assessment_period_indicator_reviews_indicator_version_item_id_fkey"
  FOREIGN KEY ("indicator_version_item_id") REFERENCES "indicator_version_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_period_review_revisions"
  ADD CONSTRAINT "assessment_period_review_revisions_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "assessment_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_period_review_revisions"
  ADD CONSTRAINT "assessment_period_review_revisions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
