ALTER TABLE "assessment_tasks"
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3)
  USING date_trunc('milliseconds', "updated_at");

CREATE OR REPLACE FUNCTION fn_update_assessment_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = GREATEST(
    date_trunc('milliseconds', clock_timestamp()),
    OLD.updated_at + INTERVAL '1 millisecond'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON assessment_tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON assessment_tasks
  FOR EACH ROW EXECUTE FUNCTION fn_update_assessment_task_updated_at();
