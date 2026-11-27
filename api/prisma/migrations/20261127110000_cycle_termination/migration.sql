ALTER TABLE assessment_cycles
  ADD COLUMN terminated_at timestamptz(3),
  ADD COLUMN terminated_by_id uuid,
  ADD COLUMN termination_reason text,
  ADD COLUMN termination_version integer NOT NULL DEFAULT 0;

ALTER TABLE assessment_cycles ADD CONSTRAINT cycle_termination_metadata CHECK (
  (terminated_at IS NULL AND terminated_by_id IS NULL AND termination_reason IS NULL AND termination_version = 0)
  OR (terminated_at IS NOT NULL AND terminated_by_id IS NOT NULL AND termination_reason IS NOT NULL AND length(btrim(termination_reason)) BETWEEN 1 AND 1000 AND termination_version = 1)
);

CREATE FUNCTION cycle_termination_task_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cycle_id = OLD.cycle_id THEN RETURN NEW; END IF;
  SELECT terminated_at INTO ended_at FROM assessment_cycles WHERE id = NEW.cycle_id FOR SHARE;
  IF ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle has been terminated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cycle_termination_task_insert_guard BEFORE INSERT OR UPDATE OF cycle_id ON assessment_tasks
  FOR EACH ROW EXECUTE FUNCTION cycle_termination_task_insert_guard();

CREATE FUNCTION cycle_termination_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended_at timestamptz;
BEGIN
  SELECT c.terminated_at INTO ended_at FROM assessment_cycles c
    JOIN assessment_tasks t ON t.cycle_id=c.id WHERE t.id=NEW.task_id FOR SHARE OF c;
  IF ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle period is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cycle_termination_period_guard BEFORE INSERT OR UPDATE ON assessment_periods
  FOR EACH ROW EXECUTE FUNCTION cycle_termination_period_guard();

CREATE FUNCTION cycle_termination_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terminated_at IS NOT NULL AND
    (NEW.terminated_at, NEW.terminated_by_id, NEW.termination_reason, NEW.termination_version)
    IS DISTINCT FROM (OLD.terminated_at, OLD.terminated_by_id, OLD.termination_reason, OLD.termination_version) THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle termination cannot be overwritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cycle_termination_metadata_guard BEFORE UPDATE ON assessment_cycles
  FOR EACH ROW EXECUTE FUNCTION cycle_termination_metadata_guard();
