CREATE TABLE "employee_import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mode" VARCHAR(20) NOT NULL,
    "original_file_name" VARCHAR(255) NOT NULL,
    "file_hash" VARCHAR(128) NOT NULL,
    "template_version" VARCHAR(40) NOT NULL DEFAULT 'roster-2026-08',
    "parser_version" VARCHAR(40) NOT NULL DEFAULT '1',
    "status" VARCHAR(30) NOT NULL DEFAULT 'uploaded',
    "operator_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error_summary" JSONB,
    "retained_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_import_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_import_batches_mode_chk" CHECK ("mode" IN ('full', 'incremental'))
);

CREATE TABLE "employee_import_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "normalized_value" JSONB NOT NULL,
    "matched_user_id" UUID,
    "diffs" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "action" VARCHAR(30) NOT NULL,
    "manual_mapping" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_import_batches_operator_id_created_at_idx"
ON "employee_import_batches"("operator_id", "created_at" DESC);
CREATE INDEX "employee_import_batches_status_created_at_idx"
ON "employee_import_batches"("status", "created_at" DESC);
CREATE INDEX "employee_import_rows_batch_id_row_number_idx"
ON "employee_import_rows"("batch_id", "row_number");
CREATE INDEX "employee_import_rows_matched_user_id_idx"
ON "employee_import_rows"("matched_user_id");

ALTER TABLE "employee_import_batches" ADD CONSTRAINT "employee_import_batches_operator_id_fkey"
FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_import_batches" ADD CONSTRAINT "employee_import_batches_confirmed_by_id_fkey"
FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_import_rows" ADD CONSTRAINT "employee_import_rows_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "employee_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_import_rows" ADD CONSTRAINT "employee_import_rows_matched_user_id_fkey"
FOREIGN KEY ("matched_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
