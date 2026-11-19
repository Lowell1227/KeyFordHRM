CREATE TABLE "talent_resume_tasks" (
  "id" UUID PRIMARY KEY,
  "owner_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "context" VARCHAR(100) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('processing', 'succeeded', 'failed', 'timed_out')),
  "stage" VARCHAR(16) NOT NULL CHECK ("stage" IN ('recognizing', 'extracting')),
  "metadata_encrypted" BYTEA NOT NULL,
  "file_encrypted" BYTEA NOT NULL CHECK (octet_length("file_encrypted") <= 10485789),
  "result_encrypted" BYTEA,
  "message" VARCHAR(200),
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "deadline_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "resume_task_time_bounds" CHECK ("created_at" < "deadline_at" AND "deadline_at" < "expires_at")
);
CREATE INDEX "talent_resume_tasks_owner_id_context_created_at_idx" ON "talent_resume_tasks"("owner_id", "context", "created_at");
CREATE INDEX "talent_resume_tasks_expires_at_idx" ON "talent_resume_tasks"("expires_at");
CREATE INDEX "talent_resume_tasks_status_deadline_at_idx" ON "talent_resume_tasks"("status", "deadline_at");
