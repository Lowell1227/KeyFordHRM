-- Preserve legacy records and signatures; new HR records do not require a task or cycle.
ALTER TABLE "performance_interviews"
  ALTER COLUMN "task_id" DROP NOT NULL,
  ALTER COLUMN "cycle_id" DROP NOT NULL,
  ADD COLUMN "recorded_by_id" UUID;

ALTER TABLE "performance_interviews" DROP CONSTRAINT "performance_interviews_task_id_fkey";
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "assessment_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_interviews" ADD CONSTRAINT "performance_interviews_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
