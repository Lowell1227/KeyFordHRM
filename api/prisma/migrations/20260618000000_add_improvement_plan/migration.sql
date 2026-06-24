-- CreateEnum
CREATE TYPE "improvement_plan_status" AS ENUM ('draft', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "improvement_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "creator_id" UUID,
    "improvement_need" TEXT,
    "importance" TEXT,
    "improvement_goal" TEXT,
    "target_date" DATE,
    "measures" JSONB NOT NULL DEFAULT '[]',
    "final_score" INTEGER,
    "status" "improvement_plan_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "improvement_plans_task_id_key" ON "improvement_plans"("task_id");

-- CreateIndex
CREATE INDEX "improvement_plans_employee_id_idx" ON "improvement_plans"("employee_id");

-- CreateIndex
CREATE INDEX "improvement_plans_cycle_id_idx" ON "improvement_plans"("cycle_id");

-- CreateIndex
CREATE INDEX "improvement_plans_status_idx" ON "improvement_plans"("status");

-- CreateIndex
CREATE INDEX "improvement_plans_creator_id_idx" ON "improvement_plans"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_plans_employee_id_cycle_id_key" ON "improvement_plans"("employee_id", "cycle_id");

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint
ALTER TABLE "improvement_plans"
  ADD CONSTRAINT "chk_improvement_plan_final_score"
  CHECK ("final_score" IS NULL OR ("final_score" >= 1 AND "final_score" <= 10));

-- UpdatedAtTrigger
CREATE TRIGGER trg_improvement_plans_updated_at
  BEFORE UPDATE ON "improvement_plans"
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

