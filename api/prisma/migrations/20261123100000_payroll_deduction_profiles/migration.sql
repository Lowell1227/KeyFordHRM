CREATE TABLE "payroll_deduction_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "subject_id" UUID NOT NULL, "employee_id" UUID NOT NULL,
  "domain" VARCHAR(20) NOT NULL DEFAULT 'validation' CHECK ("domain" IN ('validation','formal')),
  "pay_date" DATE NOT NULL, "effective_from" DATE NOT NULL, "effective_to" DATE,
  "version" INTEGER NOT NULL CHECK ("version" > 0), "status" VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','pending','returned','active')),
  "settings" JSONB NOT NULL, "created_by_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "activated_at" TIMESTAMPTZ(6),
  CONSTRAINT "payroll_deduction_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_deduction_profiles_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_deduction_profiles_employee_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_deduction_profiles_payment_date" CHECK ("effective_from" = "pay_date" AND "effective_to" = "pay_date")
);
CREATE UNIQUE INDEX "payroll_deduction_profiles_subject_id_employee_id_domain_pay_d_key" ON "payroll_deduction_profiles"("subject_id","employee_id","domain","pay_date","version");
CREATE INDEX "payroll_deduction_profiles_subject_id_domain_pay_date_status_idx" ON "payroll_deduction_profiles"("subject_id","domain","pay_date","status");
ALTER TABLE "payroll_parameter_releases" ADD COLUMN "deduction_id" UUID;
ALTER TABLE "payroll_parameter_releases" ADD CONSTRAINT "payroll_parameter_releases_deduction_fkey" FOREIGN KEY ("deduction_id") REFERENCES "payroll_deduction_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_parameter_releases" DROP CONSTRAINT "payroll_parameter_releases_kind_check";
ALTER TABLE "payroll_parameter_releases" ADD CONSTRAINT "payroll_parameter_releases_kind_check" CHECK ("kind" IN ('standard','rule','deduction'));
ALTER TABLE "payroll_parameter_releases" DROP CONSTRAINT "payroll_parameter_releases_reference_check";
ALTER TABLE "payroll_parameter_releases" ADD CONSTRAINT "payroll_parameter_releases_reference_check" CHECK (
  ("kind"='standard' AND "standard_id" IS NOT NULL AND "rule_id" IS NULL AND "deduction_id" IS NULL) OR
  ("kind"='rule' AND "rule_id" IS NOT NULL AND "standard_id" IS NULL AND "deduction_id" IS NULL) OR
  ("kind"='deduction' AND "deduction_id" IS NOT NULL AND "standard_id" IS NULL AND "rule_id" IS NULL));
CREATE UNIQUE INDEX "payroll_parameter_releases_deduction_id_attempt_key" ON "payroll_parameter_releases"("deduction_id","attempt");
CREATE UNIQUE INDEX "payroll_parameter_releases_pending_deduction" ON "payroll_parameter_releases"("deduction_id") WHERE "status"='pending';
CREATE UNIQUE INDEX "payroll_parameter_releases_approved_deduction" ON "payroll_parameter_releases"("deduction_id") WHERE "status"='approved';
