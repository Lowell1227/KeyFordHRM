-- CreateEnum
CREATE TYPE "confirmation_status" AS ENUM ('draft', 'submitted', 'manager_approved', 'hr_approved', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "vote_result" AS ENUM ('pass', 'extend', 'fail');

-- AddColumn
ALTER TABLE "users" ADD COLUMN "planned_regular_date" DATE;
ALTER TABLE "users" ADD COLUMN "actual_regular_date" DATE;

-- CreateTable
CREATE TABLE "confirmation_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "probation_review_id" UUID,
    "manager_id" UUID NOT NULL,
    "hr_id" UUID NOT NULL,
    "company_approver_id" UUID NOT NULL,
    "status" "confirmation_status" NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "salary" DECIMAL(12, 2),
    "vote_result" "vote_result",
    "vote_participants" JSONB NOT NULL DEFAULT '[]',
    "vote_comment" TEXT,
    "vote_meeting_time" TIMESTAMPTZ(6),
    "manager_comment" TEXT,
    "manager_approved_at" TIMESTAMPTZ(6),
    "hr_comment" TEXT,
    "hr_approved_at" TIMESTAMPTZ(6),
    "company_comment" TEXT,
    "company_approved_at" TIMESTAMPTZ(6),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "actual_regular_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmation_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "confirmation_applications_employee_id_idx" ON "confirmation_applications"("employee_id");

-- CreateIndex
CREATE INDEX "confirmation_applications_manager_id_idx" ON "confirmation_applications"("manager_id");

-- CreateIndex
CREATE INDEX "confirmation_applications_hr_id_idx" ON "confirmation_applications"("hr_id");

-- CreateIndex
CREATE INDEX "confirmation_applications_company_approver_id_idx" ON "confirmation_applications"("company_approver_id");

-- CreateIndex
CREATE INDEX "confirmation_applications_status_idx" ON "confirmation_applications"("status");

-- CreateIndex
CREATE INDEX "confirmation_applications_probation_review_id_idx" ON "confirmation_applications"("probation_review_id");

-- CreateIndex
CREATE INDEX "confirmation_applications_created_by_idx" ON "confirmation_applications"("created_by");

-- CreateIndex
CREATE INDEX "confirmation_applications_rejected_by_id_idx" ON "confirmation_applications"("rejected_by_id");

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_hr_id_fkey" FOREIGN KEY ("hr_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_company_approver_id_fkey" FOREIGN KEY ("company_approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_probation_review_id_fkey" FOREIGN KEY ("probation_review_id") REFERENCES "probation_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- UpdatedAtTrigger
CREATE TRIGGER trg_confirmation_applications_updated_at
  BEFORE UPDATE ON "confirmation_applications"
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
