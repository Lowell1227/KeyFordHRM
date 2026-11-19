ALTER TABLE "talent_resume_tasks" ADD COLUMN "selected_at" TIMESTAMPTZ(6);
UPDATE "talent_resume_tasks" SET "selected_at" = "created_at";
ALTER TABLE "talent_resume_tasks" ALTER COLUMN "selected_at" SET NOT NULL;
CREATE INDEX "talent_resume_tasks_owner_id_context_selected_at_idx" ON "talent_resume_tasks"("owner_id", "context", "selected_at");
