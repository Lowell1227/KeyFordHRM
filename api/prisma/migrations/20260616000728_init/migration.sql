CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'rehire', 'external');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'probation', 'resigned');

-- CreateEnum
CREATE TYPE "company_code" AS ENUM ('fuede', 'fuede_sports', 'beijing_fuede', 'fansibao');

-- CreateEnum
CREATE TYPE "sys_role" AS ENUM ('system_admin', 'hr', 'chairman', 'vp', 'dept_head', 'manager', 'employee');

-- CreateEnum
CREATE TYPE "cycle_status" AS ENUM ('draft', 'indicator_setting', 'self_eval', 'manager_score', 'hr_calibration', 'approval', 'published', 'appeal', 'closed');

-- CreateEnum
CREATE TYPE "cycle_type" AS ENUM ('quarterly', 'monthly', 'annual', 'probation', 'custom');

-- CreateEnum
CREATE TYPE "indicator_type" AS ENUM ('kpi', 'attitude', 'bonus', 'penalty', 'veto');

-- CreateEnum
CREATE TYPE "dimension_type" AS ENUM ('kpi', 'attitude', 'bonus', 'penalty');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('pending', 'indicator_setting', 'indicator_confirming', 'self_eval', 'manager_scoring', 'dept_review', 'hr_calibration', 'approval', 'published', 'confirmed', 'appealing', 'closed', 'exempted');

-- CreateEnum
CREATE TYPE "perf_grade" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "flow_node_type" AS ENUM ('indicator_setting', 'indicator_confirm', 'self_eval', 'manager_score', 'dept_review', 'hr_calibration', 'approval', 'publish', 'employee_confirm', 'appeal');

-- CreateEnum
CREATE TYPE "flow_action" AS ENUM ('submit', 'approve', 'reject', 'transfer', 'comment');

-- CreateEnum
CREATE TYPE "appeal_status" AS ENUM ('pending', 'dept_processing', 'hr_processing', 'resolved');

-- CreateEnum
CREATE TYPE "appeal_result" AS ENUM ('maintained', 'modified');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dingtalk_dept_id" VARCHAR(64),
    "name" VARCHAR(100) NOT NULL,
    "full_path" VARCHAR(500),
    "parent_id" UUID,
    "leader_id" UUID,
    "approver_id" UUID,
    "company" "company_code" NOT NULL DEFAULT 'fuede',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dingtalk_id" VARCHAR(64),
    "dingtalk_union_id" VARCHAR(64),
    "name" VARCHAR(50) NOT NULL,
    "employee_no" VARCHAR(30),
    "phone" VARCHAR(20),
    "email" VARCHAR(100),
    "avatar_url" VARCHAR(500),
    "password_hash" VARCHAR(100),
    "dept_id" UUID,
    "position" VARCHAR(100),
    "entry_date" DATE,
    "leave_date" DATE,
    "employment_type" "employment_type" NOT NULL DEFAULT 'full_time',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "direct_manager_id" UUID,
    "dingtalk_manager_id" VARCHAR(64),
    "sys_role" "sys_role" NOT NULL DEFAULT 'employee',
    "is_assessor_only" BOOLEAN NOT NULL DEFAULT false,
    "can_view_all" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50),
    "category" VARCHAR(100),
    "type" "indicator_type" NOT NULL DEFAULT 'kpi',
    "description" TEXT,
    "scoring_standard" TEXT,
    "target_value" DECIMAL(10,2),
    "unit" VARCHAR(30),
    "group_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "applicable_depts" UUID[] DEFAULT ARRAY[]::UUID[],
    "applicable_users" UUID[] DEFAULT ARRAY[]::UUID[],
    "max_score" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_dimensions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "weight" DECIMAL(5,4) NOT NULL,
    "type" "dimension_type" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_indicators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dimension_id" UUID NOT NULL,
    "indicator_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "scoring_standard" TEXT,
    "target_value" DECIMAL(10,2),
    "unit" VARCHAR(30),
    "weight" DECIMAL(5,4) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "type" "cycle_type" NOT NULL DEFAULT 'quarterly',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "deadline_indicator_setting" DATE,
    "deadline_indicator_confirm" DATE,
    "deadline_self_eval" DATE,
    "deadline_manager_score" DATE,
    "deadline_hr_calibration" DATE,
    "deadline_approval" DATE,
    "deadline_publish" DATE,
    "deadline_appeal" DATE,
    "status" "cycle_status" NOT NULL DEFAULT 'draft',
    "publish_visible_fields" JSONB NOT NULL DEFAULT '{"total_score":true,"grade":true,"indicator_scores":true,"manager_comment":true,"coefficient":false}',
    "grade_a_max_ratio" DECIMAL(4,3) NOT NULL DEFAULT 0.20,
    "grade_b_max_ratio" DECIMAL(4,3) NOT NULL DEFAULT 0.40,
    "grade_c_max_ratio" DECIMAL(4,3) NOT NULL DEFAULT 0.30,
    "grade_d_max_ratio" DECIMAL(4,3) NOT NULL DEFAULT 0.10,
    "created_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_template_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_template_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "dept_id" UUID,
    "manager_id" UUID,
    "dept_head_id" UUID,
    "approver_id" UUID,
    "status" "task_status" NOT NULL DEFAULT 'pending',
    "is_exempt" BOOLEAN NOT NULL DEFAULT false,
    "exempt_reason" TEXT,
    "indicator_set_at" TIMESTAMPTZ(6),
    "indicator_confirmed_at" TIMESTAMPTZ(6),
    "self_eval_submitted_at" TIMESTAMPTZ(6),
    "manager_scored_at" TIMESTAMPTZ(6),
    "dept_reviewed_at" TIMESTAMPTZ(6),
    "hr_calibrated_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "employee_confirmed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "template_indicator_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "scoring_standard" TEXT,
    "target_value" DECIMAL(10,2),
    "unit" VARCHAR(30),
    "weight" DECIMAL(5,4) NOT NULL,
    "indicator_type" "indicator_type" NOT NULL DEFAULT 'kpi',
    "dimension_name" VARCHAR(100),
    "dimension_weight" DECIMAL(5,4) NOT NULL,
    "actual_value" DECIMAL(10,2),
    "actual_note" TEXT,
    "self_score" DECIMAL(6,2),
    "self_comment" TEXT,
    "manager_score" DECIMAL(6,2),
    "manager_comment" TEXT,
    "extra_scores" JSONB NOT NULL DEFAULT '[]',
    "final_score" DECIMAL(6,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_eval_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "achievements" TEXT,
    "improvements" TEXT,
    "suggestions" TEXT,
    "next_goals" TEXT,
    "support_needed" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_eval_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_eval_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "strengths" TEXT,
    "improvements" TEXT,
    "development_plan" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_eval_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "calculated_score" DECIMAL(6,2),
    "raw_grade" "perf_grade",
    "calibrated_grade" "perf_grade",
    "calibration_note" TEXT,
    "is_veto" BOOLEAN NOT NULL DEFAULT false,
    "veto_reason" TEXT,
    "veto_operator_id" UUID,
    "coefficient" DECIMAL(5,4),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "hr_calibrator_id" UUID,
    "hr_calibrated_at" TIMESTAMPTZ(6),
    "approver_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "employee_confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "node_type" "flow_node_type" NOT NULL,
    "actor_id" UUID,
    "action" "flow_action" NOT NULL,
    "comment" TEXT,
    "extra_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "appellant_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "appeal_status" NOT NULL DEFAULT 'pending',
    "dept_resolution" TEXT,
    "dept_resolved_at" TIMESTAMPTZ(6),
    "dept_resolver_id" UUID,
    "hr_resolution" TEXT,
    "hr_resolved_at" TIMESTAMPTZ(6),
    "hr_resolver_id" UUID,
    "final_result" "appeal_result",
    "appeal_deadline" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_archives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_name" VARCHAR(50) NOT NULL,
    "dept_name" VARCHAR(100),
    "grade" "perf_grade" NOT NULL,
    "total_score" DECIMAL(6,2) NOT NULL,
    "coefficient" DECIMAL(5,4),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "sender_id" UUID,
    "task_id" UUID,
    "cycle_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'dingtalk',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "extra_data" JSONB,
    "sent_at" TIMESTAMPTZ(6),
    "error_msg" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_dingtalk_dept_id_key" ON "departments"("dingtalk_dept_id");

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");

-- CreateIndex
CREATE INDEX "departments_approver_id_idx" ON "departments"("approver_id");

-- CreateIndex
CREATE INDEX "departments_leader_id_idx" ON "departments"("leader_id");

-- CreateIndex
CREATE INDEX "departments_company_idx" ON "departments"("company");

-- CreateIndex
CREATE UNIQUE INDEX "users_dingtalk_id_key" ON "users"("dingtalk_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_dingtalk_union_id_key" ON "users"("dingtalk_union_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_no_key" ON "users"("employee_no");

-- CreateIndex
CREATE INDEX "users_dept_id_idx" ON "users"("dept_id");

-- CreateIndex
CREATE INDEX "users_direct_manager_id_idx" ON "users"("direct_manager_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_dingtalk_id_idx" ON "users"("dingtalk_id");

-- CreateIndex
CREATE UNIQUE INDEX "indicators_code_key" ON "indicators"("code");

-- CreateIndex
CREATE INDEX "assessment_cycles_status_idx" ON "assessment_cycles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_template_snapshots_cycle_id_template_id_key" ON "assessment_template_snapshots"("cycle_id", "template_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_cycle_id_idx" ON "assessment_tasks"("cycle_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_employee_id_idx" ON "assessment_tasks"("employee_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_manager_id_idx" ON "assessment_tasks"("manager_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_dept_head_id_idx" ON "assessment_tasks"("dept_head_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_approver_id_idx" ON "assessment_tasks"("approver_id");

-- CreateIndex
CREATE INDEX "assessment_tasks_status_idx" ON "assessment_tasks"("status");

-- CreateIndex
CREATE INDEX "assessment_tasks_cycle_id_status_idx" ON "assessment_tasks"("cycle_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_tasks_cycle_id_employee_id_key" ON "assessment_tasks"("cycle_id", "employee_id");

-- CreateIndex
CREATE INDEX "indicator_instances_task_id_idx" ON "indicator_instances"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "self_eval_summaries_task_id_key" ON "self_eval_summaries"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "manager_eval_summaries_task_id_key" ON "manager_eval_summaries"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_results_task_id_key" ON "grade_results"("task_id");

-- CreateIndex
CREATE INDEX "grade_results_task_id_idx" ON "grade_results"("task_id");

-- CreateIndex
CREATE INDEX "flow_records_task_id_idx" ON "flow_records"("task_id");

-- CreateIndex
CREATE INDEX "flow_records_cycle_id_idx" ON "flow_records"("cycle_id");

-- CreateIndex
CREATE INDEX "flow_records_actor_id_idx" ON "flow_records"("actor_id");

-- CreateIndex
CREATE INDEX "appeals_task_id_idx" ON "appeals"("task_id");

-- CreateIndex
CREATE INDEX "appeals_status_idx" ON "appeals"("status");

-- CreateIndex
CREATE INDEX "appeals_appellant_id_idx" ON "appeals"("appellant_id");

-- CreateIndex
CREATE INDEX "performance_archives_employee_id_idx" ON "performance_archives"("employee_id");

-- CreateIndex
CREATE INDEX "performance_archives_cycle_id_idx" ON "performance_archives"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_archives_employee_id_cycle_id_key" ON "performance_archives"("employee_id", "cycle_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_user_id_idx" ON "notification_logs"("user_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_idx" ON "notification_logs"("status");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_direct_manager_id_fkey" FOREIGN KEY ("direct_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_dimensions" ADD CONSTRAINT "template_dimensions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_indicators" ADD CONSTRAINT "template_indicators_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "template_dimensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_indicators" ADD CONSTRAINT "template_indicators_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_template_snapshots" ADD CONSTRAINT "assessment_template_snapshots_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_template_snapshots" ADD CONSTRAINT "assessment_template_snapshots_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "assessment_template_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_dept_head_id_fkey" FOREIGN KEY ("dept_head_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_tasks" ADD CONSTRAINT "assessment_tasks_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_instances" ADD CONSTRAINT "indicator_instances_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_instances" ADD CONSTRAINT "indicator_instances_template_indicator_id_fkey" FOREIGN KEY ("template_indicator_id") REFERENCES "template_indicators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_eval_summaries" ADD CONSTRAINT "self_eval_summaries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_eval_summaries" ADD CONSTRAINT "manager_eval_summaries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_results" ADD CONSTRAINT "grade_results_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_results" ADD CONSTRAINT "grade_results_veto_operator_id_fkey" FOREIGN KEY ("veto_operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_results" ADD CONSTRAINT "grade_results_hr_calibrator_id_fkey" FOREIGN KEY ("hr_calibrator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_results" ADD CONSTRAINT "grade_results_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_records" ADD CONSTRAINT "flow_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_records" ADD CONSTRAINT "flow_records_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_records" ADD CONSTRAINT "flow_records_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_appellant_id_fkey" FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_dept_resolver_id_fkey" FOREIGN KEY ("dept_resolver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_hr_resolver_id_fkey" FOREIGN KEY ("hr_resolver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_archives" ADD CONSTRAINT "performance_archives_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_archives" ADD CONSTRAINT "performance_archives_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 手写 SQL 补充（评审决策 #2）
-- 来源：api/prisma/migrations/MANUAL_SUPPLEMENTS.sql
-- =============================================================================

-- =============================================================================
-- 手写 SQL 补充（评审决策 #2）
--
-- Prisma schema 无法表达以下数据库对象，需手动补进迁移：
--   - CHECK 约束（一票否决、weight 范围、周期日期）
--   - updated_at 自动更新触发器
--   - 部分索引 / gin_trgm 模糊搜索索引 / 函数索引
--
-- 用法（在已生成初始迁移后执行其一）：
--   方式A：把本文件内容追加到 prisma/migrations/<timestamp>_init/migration.sql 末尾，
--          再执行 npx prisma migrate dev（推荐，保证 schema 漂移检测一致）。
--   方式B：生成一个空迁移并粘贴本文件：
--          npx prisma migrate dev --create-only --name supplements
--
-- 注意：未补充原 DDL 的 chk_grade_ratio（四个等级上限之和=1.00）——
--       该约束语义错误（上限之和无需等于 100%），已在评审中移除。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK 约束
-- ---------------------------------------------------------------------------

-- 一票否决：is_veto=true 时 calibrated_grade 必须为 'D'
ALTER TABLE grade_results
  ADD CONSTRAINT chk_veto_grade
  CHECK (NOT (is_veto = true AND calibrated_grade IS DISTINCT FROM 'D'));

-- 维度权重范围 (0, 1]
ALTER TABLE template_dimensions
  ADD CONSTRAINT chk_dimension_weight CHECK (weight > 0 AND weight <= 1);

-- 考评表指标权重范围 (0, 1]
ALTER TABLE template_indicators
  ADD CONSTRAINT chk_ti_weight CHECK (weight > 0 AND weight <= 1);

-- 周期起止日期
ALTER TABLE assessment_cycles
  ADD CONSTRAINT chk_cycle_dates CHECK (end_date > start_date);

-- ---------------------------------------------------------------------------
-- 2. updated_at 自动更新触发器
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_indicators_updated_at
  BEFORE UPDATE ON indicators FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON assessment_templates FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON assessment_cycles FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON assessment_tasks FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_ii_updated_at
  BEFORE UPDATE ON indicator_instances FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_self_eval_updated_at
  BEFORE UPDATE ON self_eval_summaries FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_manager_eval_updated_at
  BEFORE UPDATE ON manager_eval_summaries FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_grade_results_updated_at
  BEFORE UPDATE ON grade_results FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_appeals_updated_at
  BEFORE UPDATE ON appeals FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 部分索引 / 模糊搜索 / 函数索引（Prisma 无法表达）
-- ---------------------------------------------------------------------------

-- 用户软删除过滤的部分索引（覆盖 schema 中的普通索引，更高效）
CREATE INDEX idx_users_dept_active    ON users(dept_id)           WHERE deleted_at IS NULL;
CREATE INDEX idx_users_manager_active ON users(direct_manager_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status_active  ON users(status)            WHERE deleted_at IS NULL;

-- 姓名模糊搜索（pg_trgm）
CREATE INDEX idx_users_name_trgm ON users USING gin(name gin_trgm_ops);

-- 已公示等级分布查询
CREATE INDEX idx_gr_calibrated_grade ON grade_results(calibrated_grade) WHERE is_published = true;

-- 待发送通知
CREATE INDEX idx_notif_pending ON notification_logs(status) WHERE status = 'pending';

-- 催办频率限制（D19：每人每自然日最多 1 次）：sender_id + 中国日期(created_at)，type='task_reminder'
-- 注意：timestamptz::date 非 IMMUTABLE，无法直接用于函数索引；
--       此处用固定 Asia/Shanghai 时区的 IMMUTABLE 包装函数。
CREATE OR REPLACE FUNCTION fn_date_in_china(t timestamptz)
RETURNS date AS $$
  SELECT (t AT TIME ZONE 'Asia/Shanghai')::date;
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX idx_notif_sender_date
  ON notification_logs(sender_id, fn_date_in_china(created_at))
  WHERE type = 'task_reminder';
