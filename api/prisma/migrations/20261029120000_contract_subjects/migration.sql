CREATE TABLE "contract_subjects" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(150) NOT NULL,
 "is_active" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "contract_subjects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_subjects_name_key" ON "contract_subjects"("name");
ALTER TABLE "employment_records" ADD COLUMN "contract_subject_id" UUID;
ALTER TABLE "employee_contracts" ADD COLUMN "contract_subject_id" UUID;
CREATE INDEX "employment_records_contract_subject_id_idx" ON "employment_records"("contract_subject_id");
CREATE INDEX "employee_contracts_contract_subject_id_idx" ON "employee_contracts"("contract_subject_id");
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_contract_subject_id_fkey" FOREIGN KEY ("contract_subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_contract_subject_id_fkey" FOREIGN KEY ("contract_subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
