ALTER TABLE "indicator_progress_updates"
  ADD COLUMN "period_id" UUID,
  ADD COLUMN "period_review_revision_id" UUID;

CREATE UNIQUE INDEX "indicator_progress_updates_indicator_instance_id_period_review_revision_id_key"
  ON "indicator_progress_updates"("indicator_instance_id", "period_review_revision_id");

CREATE INDEX "indicator_progress_updates_period_id_created_at_idx"
  ON "indicator_progress_updates"("period_id", "created_at" DESC);

ALTER TABLE "indicator_progress_updates"
  ADD CONSTRAINT "indicator_progress_updates_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "assessment_periods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "indicator_progress_updates"
  ADD CONSTRAINT "indicator_progress_updates_period_review_revision_id_fkey"
  FOREIGN KEY ("period_review_revision_id") REFERENCES "assessment_period_review_revisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
