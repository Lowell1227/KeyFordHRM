-- CreateEnum
CREATE TYPE "scoring_frequency" AS ENUM ('monthly', 'cycle');

-- CreateEnum
CREATE TYPE "assessment_period_type" AS ENUM ('month', 'cycle');

-- CreateEnum
CREATE TYPE "assessment_period_status" AS ENUM ('unopened', 'self_eval', 'manager_scoring', 'completed', 'no_result');

-- CreateEnum
CREATE TYPE "indicator_version_status" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "participant_disposition" AS ENUM ('active', 'cycle_exempt', 'top_leader_exempt');

-- AddColumn
ALTER TABLE "assessment_cycles"
  ADD COLUMN "workflow_version" INTEGER,
  ADD COLUMN "scoring_frequency" "scoring_frequency" DEFAULT 'cycle',
  ADD COLUMN "company_final_approver_id" UUID;

-- AddColumn
ALTER TABLE "assessment_tasks"
  ADD COLUMN "participant_disposition" "participant_disposition" DEFAULT 'active';

-- Historical rows stay on workflow v1. No historical task/result ownership is rewritten.
UPDATE assessment_cycles
SET workflow_version = 1, scoring_frequency = 'cycle'
WHERE workflow_version IS NULL;

UPDATE assessment_tasks
SET participant_disposition = 'active'
WHERE participant_disposition IS NULL;

ALTER TABLE "assessment_cycles"
  ALTER COLUMN "workflow_version" SET NOT NULL,
  ALTER COLUMN "workflow_version" SET DEFAULT 1,
  ALTER COLUMN "scoring_frequency" SET NOT NULL;

ALTER TABLE "assessment_tasks"
  ALTER COLUMN "participant_disposition" SET NOT NULL;

-- CreateTable
CREATE TABLE "cycle_period_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cycle_id" UUID NOT NULL,
  "period_key" VARCHAR(20) NOT NULL,
  "period_type" "assessment_period_type" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "self_eval_open_at" TIMESTAMPTZ(6) NOT NULL,
  "self_eval_due_at" TIMESTAMPTZ(6) NOT NULL,
  "manager_due_at" TIMESTAMPTZ(6) NOT NULL,
  "is_exception" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cycle_period_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "period_key" VARCHAR(20) NOT NULL,
  "period_type" "assessment_period_type" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "manager_id" UUID,
  "indicator_version_id" UUID,
  "status" "assessment_period_status" NOT NULL DEFAULT 'unopened',
  "opened_at" TIMESTAMPTZ(6),
  "locked_at" TIMESTAMPTZ(6),
  "no_result_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assessment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "indicator_version_status" NOT NULL DEFAULT 'draft',
  "effective_from_period_key" VARCHAR(20) NOT NULL,
  "reason" TEXT,
  "created_by_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "indicator_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_version_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "indicator_version_id" UUID NOT NULL,
  "source_instance_id" UUID,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "scoring_standard" TEXT,
  "target_value" DECIMAL(10,2),
  "target_value_text" VARCHAR(100),
  "unit" VARCHAR(30),
  "weight" DECIMAL(5,4) NOT NULL,
  "indicator_type" "indicator_type" NOT NULL DEFAULT 'kpi',
  "dimension_name" VARCHAR(100),
  "dimension_weight" DECIMAL(5,4) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "indicator_version_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycle_period_schedules_cycle_id_period_key_key"
  ON "cycle_period_schedules"("cycle_id", "period_key");

-- CreateIndex
CREATE INDEX "cycle_period_schedules_cycle_id_sequence_idx"
  ON "cycle_period_schedules"("cycle_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_periods_task_id_period_key_key"
  ON "assessment_periods"("task_id", "period_key");

-- CreateIndex
CREATE INDEX "assessment_periods_manager_id_status_idx"
  ON "assessment_periods"("manager_id", "status");

-- CreateIndex
CREATE INDEX "assessment_periods_status_period_start_idx"
  ON "assessment_periods"("status", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_versions_task_id_version_key"
  ON "indicator_versions"("task_id", "version");

-- CreateIndex
CREATE INDEX "indicator_versions_task_id_status_idx"
  ON "indicator_versions"("task_id", "status");

-- CreateIndex
CREATE INDEX "indicator_version_items_indicator_version_id_sort_order_idx"
  ON "indicator_version_items"("indicator_version_id", "sort_order");

-- AddForeignKey
ALTER TABLE "assessment_cycles"
  ADD CONSTRAINT "assessment_cycles_company_final_approver_id_fkey"
  FOREIGN KEY ("company_final_approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_period_schedules"
  ADD CONSTRAINT "cycle_period_schedules_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_periods"
  ADD CONSTRAINT "assessment_periods_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_periods"
  ADD CONSTRAINT "assessment_periods_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_periods"
  ADD CONSTRAINT "assessment_periods_indicator_version_id_fkey"
  FOREIGN KEY ("indicator_version_id") REFERENCES "indicator_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_versions"
  ADD CONSTRAINT "indicator_versions_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_versions"
  ADD CONSTRAINT "indicator_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_version_items"
  ADD CONSTRAINT "indicator_version_items_indicator_version_id_fkey"
  FOREIGN KEY ("indicator_version_id") REFERENCES "indicator_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "description")
SELECT
  'performance_company_final_approver',
  '{"userId": null}'::jsonb,
  '公司绩效最终审定人。启用新流程前由 HR 管理员配置为李宏的用户 ID'
WHERE NOT EXISTS (
  SELECT 1 FROM "system_configs" WHERE "key" = 'performance_company_final_approver'
);
