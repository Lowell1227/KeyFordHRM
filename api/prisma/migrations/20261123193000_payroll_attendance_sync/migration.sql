BEGIN;

CREATE TABLE "payroll_attendance_sync_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "subject_id" UUID NOT NULL,
  "month" VARCHAR(7) NOT NULL CHECK ("month" ~ '^[2-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "domain" VARCHAR(20) NOT NULL DEFAULT 'formal' CHECK ("domain" = 'formal'),
  "request_id" UUID NOT NULL, "request_hash" VARCHAR(64) NOT NULL,
  "observation_version" SERIAL NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "created_by_id" UUID NOT NULL, "context_hash" VARCHAR(64), "cells" JSONB NOT NULL DEFAULT '[]',
  "total_cells" INTEGER NOT NULL DEFAULT 0, "cursor" INTEGER NOT NULL DEFAULT 0,
  "pending_cells" INTEGER NOT NULL DEFAULT 0, "snapshot_version" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0, "issues" JSONB NOT NULL DEFAULT '[]',
  "lease_token" UUID, "lease_until" TIMESTAMPTZ(6), "retry_of_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finished_at" TIMESTAMPTZ(6),
  CONSTRAINT "payroll_attendance_sync_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_attendance_sync_jobs_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_attendance_sync_jobs_retry_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "payroll_attendance_sync_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_attendance_sync_jobs_status_check" CHECK ("status" IN ('queued','processing','completed','blocked','failed','cancelled')),
  CONSTRAINT "payroll_attendance_sync_jobs_progress_check" CHECK ("total_cells" >= 0 AND "cursor" BETWEEN 0 AND "total_cells" AND "pending_cells" BETWEEN 0 AND "total_cells" AND "attempts" >= 0 AND "snapshot_version" >= 0),
  CONSTRAINT "payroll_attendance_sync_jobs_lease_check" CHECK (("status" = 'processing') = ("lease_token" IS NOT NULL AND "lease_until" IS NOT NULL)),
  CONSTRAINT "payroll_attendance_sync_jobs_context_check" CHECK ("status" NOT IN ('queued','processing','completed') OR ("context_hash" IS NOT NULL AND "total_cells" > 0))
);
CREATE UNIQUE INDEX "payroll_attendance_sync_jobs_request_id_key" ON "payroll_attendance_sync_jobs"("request_id");
CREATE UNIQUE INDEX "payroll_attendance_sync_jobs_observation_version_key" ON "payroll_attendance_sync_jobs"("observation_version");
CREATE UNIQUE INDEX "payroll_attendance_sync_jobs_active_key" ON "payroll_attendance_sync_jobs"("subject_id","month","domain") WHERE "status" IN ('queued','processing');
CREATE INDEX "payroll_attendance_sync_jobs_subject_month_idx" ON "payroll_attendance_sync_jobs"("subject_id","month","domain","created_at");
CREATE INDEX "payroll_attendance_sync_jobs_dispatch_idx" ON "payroll_attendance_sync_jobs"("status","lease_until","created_at");

CREATE TABLE "payroll_attendance_sync_sources" (
  "subject_id" UUID NOT NULL, "month" VARCHAR(7) NOT NULL CHECK ("month" ~ '^[2-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "domain" VARCHAR(20) NOT NULL DEFAULT 'formal' CHECK ("domain" = 'formal'), "source_id" VARCHAR(80) NOT NULL,
  "employee_id" UUID NOT NULL, "work_date" DATE NOT NULL,
  "source_version" INTEGER NOT NULL CHECK ("source_version" > 0), "fingerprint" VARCHAR(64) NOT NULL,
  "record" JSONB NOT NULL, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_attendance_sync_sources_pkey" PRIMARY KEY ("subject_id","month","domain","source_id"),
  CONSTRAINT "payroll_attendance_sync_sources_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sources_work_date_month_check" CHECK (to_char("work_date", 'YYYY-MM') = "month")
);
CREATE INDEX "payroll_attendance_sync_sources_scope_idx" ON "payroll_attendance_sync_sources"("subject_id","month","domain","employee_id","work_date");

COMMIT;
