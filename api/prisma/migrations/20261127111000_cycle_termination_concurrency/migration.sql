-- KEY SHARE fences explicit termination's FOR UPDATE without conflicting with
-- normal submissions aggregating the cycle under NO KEY UPDATE.
CREATE OR REPLACE FUNCTION cycle_termination_task_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cycle_id = OLD.cycle_id THEN RETURN NEW; END IF;
  SELECT terminated_at INTO ended_at FROM assessment_cycles WHERE id = NEW.cycle_id FOR KEY SHARE;
  IF ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle has been terminated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cycle_termination_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz;
BEGIN
  SELECT c.terminated_at INTO ended_at FROM assessment_cycles c
    JOIN assessment_tasks t ON t.cycle_id=c.id WHERE t.id=NEW.task_id FOR KEY SHARE OF c;
  IF ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle period is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cycle_termination_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terminated_at IS NOT NULL AND
    (to_jsonb(NEW) - ARRAY['status', 'published_at', 'updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'published_at', 'updated_at']) THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle configuration is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
