CREATE TABLE "positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "job_family" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "positions_code_key" ON "positions"("code");
CREATE INDEX "positions_name_is_active_idx" ON "positions"("name", "is_active");
CREATE INDEX "positions_job_family_is_active_idx" ON "positions"("job_family", "is_active");

ALTER TABLE "users" ADD COLUMN "position_id" UUID;
ALTER TABLE "employment_records" ADD COLUMN "position_id" UUID;

WITH legacy_names AS (
    SELECT DISTINCT BTRIM("position") AS "name"
    FROM "users"
    WHERE "position" IS NOT NULL AND BTRIM("position") <> ''
    UNION
    SELECT DISTINCT BTRIM("position") AS "name"
    FROM "employment_records"
    WHERE "position" IS NOT NULL AND BTRIM("position") <> ''
)
INSERT INTO "positions" ("code", "name")
SELECT 'LEGACY-' || UPPER(SUBSTRING(MD5("name") FROM 1 FOR 10)), "name"
FROM legacy_names
ON CONFLICT ("code") DO NOTHING;

UPDATE "users" AS u
SET "position_id" = p."id"
FROM "positions" AS p
WHERE u."position" IS NOT NULL AND BTRIM(u."position") = p."name";

UPDATE "employment_records" AS e
SET "position_id" = p."id"
FROM "positions" AS p
WHERE e."position" IS NOT NULL AND BTRIM(e."position") = p."name";

CREATE INDEX "users_position_id_idx" ON "users"("position_id");
CREATE INDEX "employment_records_position_id_effective_from_idx" ON "employment_records"("position_id", "effective_from");

ALTER TABLE "users"
ADD CONSTRAINT "users_position_id_fkey"
FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employment_records"
ADD CONSTRAINT "employment_records_position_id_fkey"
FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "position_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID,
    "position_name" VARCHAR(100) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "base_value" JSONB NOT NULL DEFAULT '{}',
    "proposed_value" JSONB NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "position_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "position_change_requests_status_created_at_idx"
ON "position_change_requests"("status", "created_at" DESC);
CREATE INDEX "position_change_requests_position_id_created_at_idx"
ON "position_change_requests"("position_id", "created_at" DESC);
CREATE INDEX "position_change_requests_created_by_id_created_at_idx"
ON "position_change_requests"("created_by_id", "created_at" DESC);

ALTER TABLE "position_change_requests"
ADD CONSTRAINT "position_change_requests_position_id_fkey"
FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "position_change_requests"
ADD CONSTRAINT "position_change_requests_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "position_change_requests"
ADD CONSTRAINT "position_change_requests_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
