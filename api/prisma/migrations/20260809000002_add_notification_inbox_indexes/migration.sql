DROP INDEX IF EXISTS "notification_logs_user_id_is_read_created_at_idx";

CREATE INDEX "notification_logs_inbox_recent_idx"
ON "notification_logs"("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX "notification_logs_inbox_unread_idx"
ON "notification_logs"("user_id", "is_read", "created_at" DESC, "id" DESC);
