ALTER TABLE "users"
ADD COLUMN "archived_at" TIMESTAMPTZ(6);

ALTER TABLE "employee_data_change_requests"
ADD COLUMN "record_status" VARCHAR(20) NOT NULL DEFAULT 'submitted',
ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "users_archived_at_idx"
ON "users"("archived_at");

CREATE INDEX "employee_data_change_requests_record_status_created_at_idx"
ON "employee_data_change_requests"("record_status", "created_at" DESC);
