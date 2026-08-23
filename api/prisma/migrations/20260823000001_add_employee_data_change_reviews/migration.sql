ALTER TABLE "employee_contracts"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "ended_at" TIMESTAMPTZ(6);

-- Preserve every historical row, but allow only the newest duplicate business key
-- to remain active before the concurrency guard is installed.
WITH ranked_contracts AS (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY "user_id", "contract_type", "sequence"
               ORDER BY "updated_at" DESC, "id" DESC
           ) AS row_number
    FROM "employee_contracts"
)
UPDATE "employee_contracts" AS contract
SET "is_active" = false,
    "ended_at" = CURRENT_TIMESTAMP
FROM ranked_contracts
WHERE contract."id" = ranked_contracts."id"
  AND ranked_contracts.row_number > 1;

CREATE UNIQUE INDEX "employee_contracts_active_business_key_key"
ON "employee_contracts"("user_id", "contract_type", "sequence")
WHERE "is_active" = true;

CREATE INDEX "employee_contracts_user_id_is_active_expires_at_idx"
ON "employee_contracts"("user_id", "is_active", "expires_at");

CREATE TABLE "employee_data_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "employee_no" VARCHAR(30),
    "employee_name" VARCHAR(50) NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_batch_id" UUID,
    "source_row_number" INTEGER,
    "base_value" JSONB NOT NULL DEFAULT '{}',
    "proposed_value" JSONB NOT NULL,
    "profile_review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "performance_review_status" VARCHAR(20) NOT NULL DEFAULT 'not_required',
    "validation_errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "profile_reviewed_by_id" UUID,
    "profile_reviewed_at" TIMESTAMPTZ(6),
    "performance_reviewed_by_id" UUID,
    "performance_reviewed_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_data_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_data_change_requests_source_batch_id_source_row_number_key"
ON "employee_data_change_requests"("source_batch_id", "source_row_number");

CREATE INDEX "employee_data_change_requests_profile_review_status_created_at_idx"
ON "employee_data_change_requests"("profile_review_status", "created_at" DESC);

CREATE INDEX "employee_data_change_requests_performance_review_status_created_at_idx"
ON "employee_data_change_requests"("performance_review_status", "created_at" DESC);

CREATE INDEX "employee_data_change_requests_user_id_created_at_idx"
ON "employee_data_change_requests"("user_id", "created_at" DESC);

ALTER TABLE "employee_data_change_requests"
ADD CONSTRAINT "employee_data_change_requests_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_data_change_requests"
ADD CONSTRAINT "employee_data_change_requests_source_batch_id_fkey"
FOREIGN KEY ("source_batch_id") REFERENCES "employee_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_data_change_requests"
ADD CONSTRAINT "employee_data_change_requests_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_data_change_requests"
ADD CONSTRAINT "employee_data_change_requests_profile_reviewed_by_id_fkey"
FOREIGN KEY ("profile_reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_data_change_requests"
ADD CONSTRAINT "employee_data_change_requests_performance_reviewed_by_id_fkey"
FOREIGN KEY ("performance_reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
