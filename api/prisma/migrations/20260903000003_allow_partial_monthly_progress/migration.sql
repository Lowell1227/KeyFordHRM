ALTER TABLE "indicator_progress_updates"
  ALTER COLUMN "progress" DROP NOT NULL,
  ALTER COLUMN "health_status" DROP NOT NULL;
