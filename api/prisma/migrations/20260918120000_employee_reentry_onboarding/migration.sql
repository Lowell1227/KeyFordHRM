ALTER TYPE "user_status" ADD VALUE IF NOT EXISTS 'pending_entry';
CREATE TYPE "onboarding_intake_type" AS ENUM ('new_hire', 'reentry');
CREATE TYPE "onboarding_status" AS ENUM ('draft', 'submitted', 'pending_entry', 'effective', 'cancelled');
CREATE TYPE "employee_number_status" AS ENUM ('reserved', 'current', 'historical', 'released');

ALTER TABLE "employment_records"
  ADD COLUMN "employee_no" VARCHAR(30),
  ADD COLUMN "source_request_id" UUID;

ALTER TABLE "employee_data_change_requests"
  ADD COLUMN "source_system" VARCHAR(40),
  ADD COLUMN "source_reference" VARCHAR(100),
  ADD COLUMN "intake_type" "onboarding_intake_type",
  ADD COLUMN "onboarding_status" "onboarding_status",
  ADD COLUMN "request_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_by_id" UUID,
  ADD COLUMN "cancelled_reason" TEXT;

CREATE TABLE "employee_number_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "employee_no" VARCHAR(30) NOT NULL,
  "status" "employee_number_status" NOT NULL,
  "effective_from" DATE,
  "effective_to" DATE,
  "source_request_id" UUID,
  "released_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_number_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_number_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_number_assignments_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "employee_data_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "employee_number_assignments_user_id_employee_no_key" UNIQUE ("user_id", "employee_no")
);

CREATE UNIQUE INDEX "employee_change_source_key"
  ON "employee_data_change_requests"("source_system", "source_reference");
CREATE UNIQUE INDEX "employee_number_assignments_occupied_no_key"
  ON "employee_number_assignments"("employee_no")
  WHERE "status" IN ('reserved', 'current', 'historical');
CREATE UNIQUE INDEX "employee_number_assignments_source_request_key"
  ON "employee_number_assignments"("source_request_id")
  WHERE "source_request_id" IS NOT NULL;
CREATE UNIQUE INDEX "employee_change_one_open_onboarding_per_user"
  ON "employee_data_change_requests"("user_id")
  WHERE "user_id" IS NOT NULL
    AND "intake_type" IN ('new_hire', 'reentry')
    AND "onboarding_status" IN ('draft', 'submitted', 'pending_entry');
CREATE UNIQUE INDEX "employment_records_source_request_id_key"
  ON "employment_records"("source_request_id")
  WHERE "source_request_id" IS NOT NULL;
CREATE INDEX "employee_number_assignments_employee_no_status_idx" ON "employee_number_assignments"("employee_no", "status");
CREATE INDEX "employee_number_assignments_user_id_status_idx" ON "employee_number_assignments"("user_id", "status");
CREATE INDEX "employee_change_intake_status_created_idx" ON "employee_data_change_requests"("intake_type", "onboarding_status", "created_at" DESC);

CREATE SEQUENCE "employee_number_seq" AS BIGINT MINVALUE 1;

ALTER TABLE "employment_records"
  ADD CONSTRAINT "employment_records_source_request_id_fkey"
  FOREIGN KEY ("source_request_id") REFERENCES "employee_data_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_data_change_requests"
  ADD CONSTRAINT "employee_data_change_requests_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ranked_employment AS (
  SELECT er."id", er."user_id",
    ROW_NUMBER() OVER (PARTITION BY er."user_id" ORDER BY er."effective_from" DESC, er."created_at" DESC) AS rn
  FROM "employment_records" er
)
UPDATE "employment_records" er
SET "employee_no" = u."employee_no"
FROM ranked_employment ranked
JOIN "users" u ON u."id" = ranked."user_id"
WHERE er."id" = ranked."id" AND ranked.rn = 1
  AND er."employee_no" IS NULL AND u."employee_no" IS NOT NULL;

INSERT INTO "employee_number_assignments" ("user_id", "employee_no", "status", "effective_from", "effective_to")
SELECT u."id", u."employee_no",
  CASE WHEN u."status" IN ('active', 'probation') AND EXISTS (
    SELECT 1 FROM "employment_records" current_er
    WHERE current_er."user_id" = u."id"
      AND current_er."effective_from" <= CURRENT_DATE
      AND (current_er."effective_to" IS NULL OR current_er."effective_to" >= CURRENT_DATE)
      AND current_er."employee_status" <> 'resigned'
  ) THEN 'current'::"employee_number_status" ELSE 'historical'::"employee_number_status" END,
  latest."effective_from", latest."effective_to"
FROM "users" u
LEFT JOIN LATERAL (
  SELECT er."effective_from", er."effective_to" FROM "employment_records" er
  WHERE er."user_id" = u."id"
  ORDER BY er."effective_from" DESC, er."created_at" DESC LIMIT 1
) latest ON TRUE
WHERE u."employee_no" IS NOT NULL
ON CONFLICT ("user_id", "employee_no") DO NOTHING;

DO $$
DECLARE max_numeric_no BIGINT;
BEGIN
  SELECT COALESCE(MAX("employee_no"::BIGINT), 0) INTO max_numeric_no
  FROM "employee_number_assignments"
  WHERE "employee_no" ~ '^[0-9]+$' AND "status" IN ('current', 'historical');
  IF max_numeric_no = 0 THEN
    PERFORM setval('employee_number_seq', 1, false);
  ELSE
    PERFORM setval('employee_number_seq', max_numeric_no, true);
  END IF;
END $$;
