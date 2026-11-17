ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'goal_hr_review';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'goal_vp_review';
ALTER TABLE "improvement_plans" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "indicator_instances" ADD COLUMN "retired_at" TIMESTAMPTZ(6);

CREATE TABLE "goal_change_grants" (
  "task_id" UUID PRIMARY KEY REFERENCES "assessment_tasks"("id") ON DELETE RESTRICT,
  "granted_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "state" VARCHAR(20) NOT NULL DEFAULT 'open' CHECK ("state" IN ('open','consumed','revoked')),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "goal_change_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL REFERENCES "assessment_tasks"("id") ON DELETE RESTRICT,
  "creator_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "before_goals" JSONB NOT NULL,
  "goals" JSONB NOT NULL,
  "baseline_version_id" UUID REFERENCES "indicator_versions"("id") ON DELETE RESTRICT,
  "effective_version_id" UUID REFERENCES "indicator_versions"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goal_change_request_status" CHECK ("status" IN ('draft','revision','indicator_reviewing','indicator_dept_reviewing','indicator_confirming','indicator_approving','active','revoked'))
);
CREATE INDEX "goal_change_requests_task_id_created_at_idx" ON "goal_change_requests"("task_id","created_at");
CREATE INDEX "goal_change_requests_status_idx" ON "goal_change_requests"("status");
CREATE UNIQUE INDEX "goal_change_one_ongoing_per_task" ON "goal_change_requests"("task_id") WHERE "status" NOT IN ('active','revoked');
