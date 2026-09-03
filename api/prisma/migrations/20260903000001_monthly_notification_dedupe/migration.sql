ALTER TABLE "notification_logs"
ADD COLUMN "dedupe_key" VARCHAR(160);

CREATE UNIQUE INDEX "notification_logs_dedupe_key_key"
ON "notification_logs"("dedupe_key");
