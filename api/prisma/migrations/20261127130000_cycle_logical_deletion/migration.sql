ALTER TABLE assessment_cycles
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN deleted_by_id uuid,
  ADD COLUMN deletion_reason text,
  ADD COLUMN deletion_version integer NOT NULL DEFAULT 0;

ALTER TABLE assessment_cycles ADD CONSTRAINT cycle_deletion_metadata CHECK (
  (deleted_at IS NULL AND deleted_by_id IS NULL AND deletion_reason IS NULL AND deletion_version = 0)
  OR (deleted_at IS NOT NULL AND deleted_by_id IS NOT NULL AND length(btrim(deletion_reason)) BETWEEN 1 AND 1000
      AND deletion_reason IS NOT NULL AND deletion_version = 1 AND (terminated_at IS NOT NULL OR status = 'draft'))
);

CREATE OR REPLACE FUNCTION cycle_termination_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle physical deletion is forbidden' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: deleted cycle is read-only' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['deleted_at','deleted_by_id','deletion_reason','deletion_version','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['deleted_at','deleted_by_id','deletion_reason','deletion_version','updated_at'])
      OR EXISTS (SELECT 1 FROM assessment_tasks WHERE cycle_id=OLD.id AND lifecycle_status <> 'deleted')
      OR EXISTS (SELECT 1 FROM goal_change_requests g JOIN assessment_tasks t ON t.id=g.task_id
                 WHERE t.cycle_id=OLD.id AND g.lifecycle_status <> 'deleted') THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle deletion must retain facts and finish all children' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.terminated_at IS NOT NULL AND
    (to_jsonb(NEW) - ARRAY['status','published_at','deadline_appeal','closed_at','updated_at','deleted_at','deleted_by_id','deletion_reason','deletion_version'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','published_at','deadline_appeal','closed_at','updated_at','deleted_at','deleted_by_id','deletion_reason','deletion_version']) THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle configuration is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cycle_physical_delete_guard BEFORE DELETE ON assessment_cycles
  FOR EACH ROW EXECUTE FUNCTION cycle_termination_metadata_guard();

CREATE OR REPLACE FUNCTION cycle_termination_task_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz; removed_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cycle_id = OLD.cycle_id THEN RETURN NEW; END IF;
  SELECT terminated_at, deleted_at INTO ended_at, removed_at FROM assessment_cycles WHERE id=NEW.cycle_id FOR KEY SHARE;
  IF ended_at IS NOT NULL OR removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle has ended' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cycle_termination_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz; removed_at timestamptz;
BEGIN
  SELECT c.terminated_at, c.deleted_at INTO ended_at, removed_at FROM assessment_cycles c
    JOIN assessment_tasks t ON t.cycle_id=c.id WHERE t.id=NEW.task_id FOR KEY SHARE OF c;
  IF ended_at IS NOT NULL OR removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle period is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
