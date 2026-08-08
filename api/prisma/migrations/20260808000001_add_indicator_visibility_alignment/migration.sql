CREATE TYPE "indicator_visibility_scope" AS ENUM (
  'company',
  'department',
  'department_tree',
  'direct_reports',
  'all_reports',
  'supervisors',
  'custom'
);

ALTER TABLE "indicator_instances"
  ADD COLUMN "visibility_scope" "indicator_visibility_scope" NOT NULL DEFAULT 'supervisors';

CREATE TABLE "indicator_visibility_departments" (
  "indicator_instance_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,

  CONSTRAINT "indicator_visibility_departments_pkey" PRIMARY KEY ("indicator_instance_id", "department_id")
);

CREATE TABLE "indicator_visibility_users" (
  "indicator_instance_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,

  CONSTRAINT "indicator_visibility_users_pkey" PRIMARY KEY ("indicator_instance_id", "user_id")
);

CREATE TABLE "indicator_objective_alignments" (
  "indicator_instance_id" UUID NOT NULL,
  "objective_id" UUID NOT NULL,

  CONSTRAINT "indicator_objective_alignments_pkey" PRIMARY KEY ("indicator_instance_id", "objective_id")
);

CREATE INDEX "indicator_visibility_departments_department_id_idx"
  ON "indicator_visibility_departments"("department_id");

CREATE INDEX "indicator_visibility_users_user_id_idx"
  ON "indicator_visibility_users"("user_id");

CREATE INDEX "indicator_objective_alignments_objective_id_idx"
  ON "indicator_objective_alignments"("objective_id");

ALTER TABLE "indicator_visibility_departments"
  ADD CONSTRAINT "indicator_visibility_departments_indicator_instance_id_fkey"
  FOREIGN KEY ("indicator_instance_id") REFERENCES "indicator_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_visibility_departments"
  ADD CONSTRAINT "indicator_visibility_departments_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_visibility_users"
  ADD CONSTRAINT "indicator_visibility_users_indicator_instance_id_fkey"
  FOREIGN KEY ("indicator_instance_id") REFERENCES "indicator_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_visibility_users"
  ADD CONSTRAINT "indicator_visibility_users_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_objective_alignments"
  ADD CONSTRAINT "indicator_objective_alignments_indicator_instance_id_fkey"
  FOREIGN KEY ("indicator_instance_id") REFERENCES "indicator_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_objective_alignments"
  ADD CONSTRAINT "indicator_objective_alignments_objective_id_fkey"
  FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "flow_action" ADD VALUE IF NOT EXISTS 'withdraw';
