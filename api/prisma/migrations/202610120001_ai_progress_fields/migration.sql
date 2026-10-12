ALTER TABLE "indicator_progress_updates"
  ADD COLUMN "actual_value" DECIMAL(10,2),
  ADD COLUMN "target_value_snapshot" DECIMAL(10,2),
  ADD COLUMN "unit_snapshot" VARCHAR(30),
  ADD COLUMN "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ai_draft_id" UUID;

CREATE UNIQUE INDEX "indicator_progress_updates_ai_draft_id_key"
  ON "indicator_progress_updates"("ai_draft_id");
