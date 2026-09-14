ALTER TABLE "improvement_plans"
  DROP CONSTRAINT IF EXISTS "chk_improvement_plan_final_score";

ALTER TABLE "improvement_plans"
  ADD CONSTRAINT "chk_improvement_plan_final_score"
  CHECK (
    "final_score" IS NULL
    OR ("workflow_version" = 1 AND "final_score" BETWEEN 1 AND 10)
    OR ("workflow_version" = 2 AND "final_score" BETWEEN 0 AND 100)
  );
