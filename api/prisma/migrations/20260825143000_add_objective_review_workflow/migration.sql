CREATE TYPE "objective_review_status" AS ENUM (
  'draft',
  'pending',
  'approved',
  'changes_requested',
  'not_required'
);

ALTER TABLE "objectives"
ADD COLUMN "review_status" "objective_review_status" NOT NULL DEFAULT 'not_required',
ADD COLUMN "reviewed_by_id" UUID,
ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN "review_comment" TEXT;

UPDATE "objectives"
SET "review_status" = CASE
  WHEN "status" = 'draft' THEN 'draft'::"objective_review_status"
  ELSE 'not_required'::"objective_review_status"
END;

UPDATE "objectives" AS objective
SET "review_status" = 'pending'::"objective_review_status"
FROM "users" AS owner
WHERE objective."owner_id" = owner."id"
  AND objective."status" = 'active'
  AND owner."direct_manager_id" IS NOT NULL;

ALTER TABLE "objectives"
ADD CONSTRAINT "objectives_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "objectives_review_status_idx" ON "objectives"("review_status");
CREATE INDEX "objectives_reviewed_by_id_idx" ON "objectives"("reviewed_by_id");
