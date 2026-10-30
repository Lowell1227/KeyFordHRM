CREATE TYPE "personnel_reference_data_kind" AS ENUM ('work_location', 'job_family');

CREATE TABLE "personnel_reference_data" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "personnel_reference_data_kind" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "personnel_reference_data_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "personnel_reference_data_name_check" CHECK (length(btrim("name")) > 0 AND "name" = btrim("name"))
);

CREATE UNIQUE INDEX "personnel_reference_data_kind_name_key" ON "personnel_reference_data"("kind", "name");

CREATE TRIGGER "trg_personnel_reference_data_updated_at"
BEFORE UPDATE ON "personnel_reference_data"
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
