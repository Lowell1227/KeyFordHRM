ALTER TABLE "employee_profiles"
ADD COLUMN "birth_date" DATE,
ADD COLUMN "ethnicity" VARCHAR(50),
ADD COLUMN "education" VARCHAR(50),
ADD COLUMN "professional_title" VARCHAR(100),
ADD COLUMN "school" VARCHAR(200),
ADD COLUMN "graduation_date" DATE,
ADD COLUMN "major" VARCHAR(150),
ADD COLUMN "marital_status" VARCHAR(30),
ADD COLUMN "children_status" VARCHAR(30),
ADD COLUMN "children_count" INTEGER,
ADD COLUMN "political_status" VARCHAR(50),
ADD COLUMN "native_place" VARCHAR(150),
ADD COLUMN "household_type" VARCHAR(100),
ADD COLUMN "id_address" TEXT,
ADD COLUMN "id_number_encrypted" BYTEA,
ADD COLUMN "id_number_fingerprint" VARCHAR(128),
ADD COLUMN "current_address" TEXT,
ADD COLUMN "emergency_contact_name" VARCHAR(100),
ADD COLUMN "emergency_contact_relation" VARCHAR(50),
ADD COLUMN "emergency_contact_phone" VARCHAR(30),
ADD COLUMN "social_security_status" VARCHAR(100),
ADD COLUMN "social_security_start_date" DATE,
ADD COLUMN "housing_fund_status" VARCHAR(100),
ADD COLUMN "housing_fund_start_date" DATE,
ADD COLUMN "bank_name" VARCHAR(100),
ADD COLUMN "bank_branch" VARCHAR(200),
ADD COLUMN "bank_account_encrypted" BYTEA,
ADD COLUMN "bank_account_fingerprint" VARCHAR(128);

CREATE TABLE "employee_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "contract_type" VARCHAR(30) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "name" VARCHAR(150),
    "signing_company" VARCHAR(150),
    "signed_at" DATE,
    "effective_from" DATE,
    "expires_at" DATE,
    "term_type" VARCHAR(100),
    "original_company" VARCHAR(150),
    "new_company" VARCHAR(150),
    "confidentiality_agreement" VARCHAR(50),
    "non_compete_agreement" VARCHAR(50),
    "portrait_agreement" VARCHAR(50),
    "attachment_ref" VARCHAR(500),
    "source_batch_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_contracts_user_id_expires_at_idx" ON "employee_contracts"("user_id", "expires_at");
CREATE INDEX "employee_contracts_source_batch_id_idx" ON "employee_contracts"("source_batch_id");
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_source_batch_id_fkey"
FOREIGN KEY ("source_batch_id") REFERENCES "employee_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
