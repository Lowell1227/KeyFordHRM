ALTER TABLE "payroll_versions" ADD COLUMN "pay_date" DATE, ADD COLUMN "net_snapshot" JSONB;
ALTER TABLE "payroll_versions" ADD CONSTRAINT "payroll_versions_net_date_check" CHECK (("pay_date" IS NULL) = ("net_snapshot" IS NULL));
CREATE TABLE "payroll_net_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "version_id" UUID NOT NULL, "subject_id" UUID NOT NULL, "employee_id" UUID NOT NULL,
  "domain" VARCHAR(20) NOT NULL CHECK ("domain" IN ('validation','formal')), "pay_date" DATE NOT NULL,
  "gross" DECIMAL(18,2) NOT NULL, "social_insurance" DECIMAL(18,2) NOT NULL, "housing_fund" DECIMAL(18,2) NOT NULL,
  "income_tax" DECIMAL(18,2) NOT NULL, "net" DECIMAL(18,2) NOT NULL,
  "snapshot" JSONB NOT NULL, "request_id" UUID NOT NULL, "request_hash" VARCHAR(64) NOT NULL,
  "reference" VARCHAR(200) NOT NULL CHECK (length(trim("reference")) > 0), "confirmed_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_net_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_net_payments_version_fkey" FOREIGN KEY ("version_id") REFERENCES "payroll_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_net_payments_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_net_payments_employee_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_net_payments_amount_check" CHECK ("gross" >= 0 AND "social_insurance" >= 0 AND "housing_fund" >= 0 AND "income_tax" >= 0 AND "net" >= 0 AND "net" = "gross" - "social_insurance" - "housing_fund" - "income_tax")
);
CREATE UNIQUE INDEX "payroll_net_payments_request_id_key" ON "payroll_net_payments"("request_id");
CREATE UNIQUE INDEX "payroll_net_payments_version_id_employee_id_key" ON "payroll_net_payments"("version_id","employee_id");
CREATE INDEX "payroll_net_payments_subject_id_employee_id_domain_pay_date_idx" ON "payroll_net_payments"("subject_id","employee_id","domain","pay_date");
CREATE TABLE "payroll_net_reservations" (
  "subject_id" UUID NOT NULL, "employee_id" UUID NOT NULL, "domain" VARCHAR(20) NOT NULL CHECK ("domain" IN ('validation','formal')),
  "tax_year" INTEGER NOT NULL CHECK ("tax_year" BETWEEN 2000 AND 9999), "version_id" UUID NOT NULL,
  CONSTRAINT "payroll_net_reservations_pkey" PRIMARY KEY ("subject_id","employee_id","domain","tax_year"),
  CONSTRAINT "payroll_net_reservations_version_fkey" FOREIGN KEY ("version_id") REFERENCES "payroll_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payroll_net_reservations_version_id_idx" ON "payroll_net_reservations"("version_id");
