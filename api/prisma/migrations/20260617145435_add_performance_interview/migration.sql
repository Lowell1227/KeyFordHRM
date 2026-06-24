-- CreateEnum
CREATE TYPE "interview_method" AS ENUM ('one_on_one', 'phone', 'performance_meeting');

-- CreateEnum
CREATE TYPE "interview_status" AS ENUM ('pending', 'filled', 'employee_signed', 'closed');

-- DropIndex
DROP INDEX "idx_users_name_trgm";

-- CreateTable
CREATE TABLE "performance_interviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "interviewer_id" UUID NOT NULL,
    "status" "interview_status" NOT NULL DEFAULT 'pending',
    "interview_time" TIMESTAMPTZ(6),
    "location" VARCHAR(200),
    "interview_method" "interview_method",
    "score_informed" BOOLEAN NOT NULL DEFAULT false,
    "achievements" TEXT,
    "weaknesses" TEXT,
    "next_goals" TEXT,
    "remediation" TEXT,
    "support_needed" TEXT,
    "other_matters" TEXT,
    "manager_signed_at" TIMESTAMPTZ(6),
    "employee_signed_at" TIMESTAMPTZ(6),
    "deadline" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_interviews_task_id_key" ON "performance_interviews"("task_id");

-- CreateIndex
CREATE INDEX "performance_interviews_cycle_id_idx" ON "performance_interviews"("cycle_id");

-- CreateIndex
CREATE INDEX "performance_interviews_employee_id_idx" ON "performance_interviews"("employee_id");

-- CreateIndex
CREATE INDEX "performance_interviews_interviewer_id_idx" ON "performance_interviews"("interviewer_id");

-- CreateIndex
CREATE INDEX "performance_interviews_status_idx" ON "performance_interviews"("status");

-- CreateIndex
CREATE INDEX "performance_interviews_deadline_idx" ON "performance_interviews"("deadline");

-- AddForeignKey
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- updated_at 触发器（与项目约定一致，由数据库维护）
CREATE TRIGGER trg_performance_interviews_updated_at
  BEFORE UPDATE ON "performance_interviews" FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
