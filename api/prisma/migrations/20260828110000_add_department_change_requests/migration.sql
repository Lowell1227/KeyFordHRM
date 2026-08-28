CREATE TABLE "department_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "department_id" UUID,
    "department_name" VARCHAR(100) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "base_value" JSONB NOT NULL DEFAULT '{}',
    "proposed_value" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "department_change_requests_status_created_at_idx"
ON "department_change_requests"("status", "created_at" DESC);

CREATE INDEX "department_change_requests_department_id_created_at_idx"
ON "department_change_requests"("department_id", "created_at" DESC);

CREATE INDEX "department_change_requests_created_by_id_created_at_idx"
ON "department_change_requests"("created_by_id", "created_at" DESC);

ALTER TABLE "department_change_requests"
ADD CONSTRAINT "department_change_requests_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "department_change_requests"
ADD CONSTRAINT "department_change_requests_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "department_change_requests"
ADD CONSTRAINT "department_change_requests_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
