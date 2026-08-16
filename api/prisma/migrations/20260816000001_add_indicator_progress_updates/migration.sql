CREATE TYPE "indicator_progress_health" AS ENUM (
  'on_track',
  'at_risk',
  'blocked',
  'completed'
);

CREATE TABLE "indicator_progress_updates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "indicator_instance_id" UUID NOT NULL,
  "progress" SMALLINT NOT NULL,
  "health_status" "indicator_progress_health" NOT NULL,
  "content" TEXT NOT NULL,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "indicator_progress_updates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "indicator_progress_updates_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "indicator_progress_updates_indicator_instance_id_fkey"
    FOREIGN KEY ("indicator_instance_id") REFERENCES "indicator_instances"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "indicator_progress_updates_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "indicator_progress_updates_indicator_instance_id_created_at_idx"
  ON "indicator_progress_updates"("indicator_instance_id", "created_at" DESC);

CREATE INDEX "indicator_progress_updates_created_by_idx"
  ON "indicator_progress_updates"("created_by");
