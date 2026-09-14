ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'goal_dept_review';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'goal_employee_confirm';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'goal_revision';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'self_eval';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'manager_review';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'dept_review';
ALTER TYPE "improvement_plan_status" ADD VALUE IF NOT EXISTS 'vp_review';

DROP INDEX IF EXISTS "improvement_plans_employee_id_cycle_id_key";
ALTER TABLE "improvement_plans"
  ALTER COLUMN "cycle_id" DROP NOT NULL,
  ALTER COLUMN "task_id" DROP NOT NULL,
  ALTER COLUMN "final_score" TYPE DOUBLE PRECISION USING "final_score"::DOUBLE PRECISION,
  ADD COLUMN "workflow_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "goals" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "self_evaluation" JSONB,
  ADD COLUMN "manager_evaluation" JSONB,
  ADD COLUMN "department_evaluation" JSONB,
  ADD COLUMN "started_at" TIMESTAMPTZ(6),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);
