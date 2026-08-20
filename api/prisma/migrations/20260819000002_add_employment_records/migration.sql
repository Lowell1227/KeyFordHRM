CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "employment_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "company" "company_code" NOT NULL,
    "dept_id" UUID,
    "position" VARCHAR(100),
    "job_grade" VARCHAR(30),
    "job_family" VARCHAR(100),
    "direct_manager_id" UUID,
    "work_location" VARCHAR(100),
    "employment_type" "employment_type" NOT NULL DEFAULT 'full_time',
    "employee_status" "user_status" NOT NULL DEFAULT 'active',
    "entry_date" DATE,
    "planned_regular_date" DATE,
    "actual_regular_date" DATE,
    "leave_date" DATE,
    "probation_months" INTEGER,
    "change_type" VARCHAR(40) NOT NULL,
    "reason" TEXT,
    "source_type" VARCHAR(30),
    "source_batch_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employment_records_valid_range_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);

CREATE INDEX "employment_records_user_id_effective_from_idx" ON "employment_records"("user_id", "effective_from");
CREATE INDEX "employment_records_dept_id_effective_from_idx" ON "employment_records"("dept_id", "effective_from");
CREATE INDEX "employment_records_direct_manager_id_effective_from_idx" ON "employment_records"("direct_manager_id", "effective_from");

ALTER TABLE "employment_records"
ADD CONSTRAINT "employment_records_no_overlap_excl"
EXCLUDE USING GIST (
    "user_id" WITH =,
    daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
);

ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_dept_id_fkey"
FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_direct_manager_id_fkey"
FOREIGN KEY ("direct_manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "employment_records" (
    "user_id", "effective_from", "effective_to", "company", "dept_id", "position",
    "direct_manager_id", "employment_type", "employee_status", "entry_date",
    "planned_regular_date", "actual_regular_date", "leave_date", "change_type",
    "reason", "source_type"
)
SELECT
    u."id",
    COALESCE(u."entry_date", u."created_at"::date),
    u."leave_date",
    COALESCE(d."company", 'fuede'::"company_code"),
    u."dept_id",
    u."position",
    u."direct_manager_id",
    u."employment_type",
    u."status",
    u."entry_date",
    u."planned_regular_date",
    u."actual_regular_date",
    u."leave_date",
    'legacy_migration',
    '从 User 当前字段迁移生成首条任职记录',
    'migration'
FROM "users" u
LEFT JOIN "departments" d ON d."id" = u."dept_id"
WHERE u."deleted_at" IS NULL;
