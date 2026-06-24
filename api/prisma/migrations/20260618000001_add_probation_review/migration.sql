-- CreateEnum
CREATE TYPE "probation_review_status" AS ENUM ('pending', 'indicator_setting', 'self_eval', 'manager_scoring', 'closed');

-- CreateEnum
CREATE TYPE "probation_indicator_type" AS ENUM ('work_objective', 'values');

-- CreateTable
CREATE TABLE "probation_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "hr_id" UUID NOT NULL,
    "status" "probation_review_status" NOT NULL DEFAULT 'pending',
    "planned_regular_date" DATE,
    "strengths" TEXT,
    "improvements" TEXT,
    "employee_signed_at" TIMESTAMPTZ(6),
    "manager_signed_at" TIMESTAMPTZ(6),
    "hr_signed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probation_review_indicators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "probation_review_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "probation_indicator_type" NOT NULL,
    "weight" DECIMAL(5,4) NOT NULL,
    "description" TEXT,
    "target_value" VARCHAR(500),
    "self_score" DECIMAL(6,2),
    "self_comment" TEXT,
    "manager_score" DECIMAL(6,2),
    "manager_comment" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probation_review_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "probation_reviews_employee_id_idx" ON "probation_reviews"("employee_id");

-- CreateIndex
CREATE INDEX "probation_reviews_manager_id_idx" ON "probation_reviews"("manager_id");

-- CreateIndex
CREATE INDEX "probation_reviews_hr_id_idx" ON "probation_reviews"("hr_id");

-- CreateIndex
CREATE INDEX "probation_reviews_status_idx" ON "probation_reviews"("status");

-- CreateIndex
CREATE INDEX "probation_reviews_created_by_idx" ON "probation_reviews"("created_by");

-- CreateIndex
CREATE INDEX "probation_review_indicators_probation_review_id_idx" ON "probation_review_indicators"("probation_review_id");

-- AddForeignKey
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_hr_id_fkey" FOREIGN KEY ("hr_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probation_review_indicators" ADD CONSTRAINT "probation_review_indicators_probation_review_id_fkey" FOREIGN KEY ("probation_review_id") REFERENCES "probation_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint
ALTER TABLE "probation_review_indicators"
  ADD CONSTRAINT "chk_probation_indicator_weight"
  CHECK ("weight" >= 0 AND "weight" <= 1);

-- UpdatedAtTrigger
CREATE TRIGGER trg_probation_reviews_updated_at
  BEFORE UPDATE ON "probation_reviews"
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- UpdatedAtTrigger
CREATE TRIGGER trg_probation_review_indicators_updated_at
  BEFORE UPDATE ON "probation_review_indicators"
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
