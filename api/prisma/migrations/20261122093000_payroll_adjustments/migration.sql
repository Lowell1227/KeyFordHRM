-- AlterTable
ALTER TABLE "payroll_batches" ADD COLUMN     "additional_months" VARCHAR(7)[] DEFAULT ARRAY[]::VARCHAR(7)[];

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "item_code" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_adjustments_subject_id_employee_id_domain_month_idx" ON "payroll_adjustments"("subject_id", "employee_id", "domain", "month");

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
