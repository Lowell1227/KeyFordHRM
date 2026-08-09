ALTER TABLE "notification_logs"
ADD COLUMN "is_read" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "read_at" TIMESTAMPTZ(6);

UPDATE "notification_logs"
SET
  "is_read" = true,
  "read_at" = COALESCE("sent_at", "created_at");

CREATE INDEX "notification_logs_user_id_is_read_created_at_idx"
ON "notification_logs"("user_id", "is_read", "created_at");
