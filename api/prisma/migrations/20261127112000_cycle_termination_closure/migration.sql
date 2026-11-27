-- Original protected-result closure records its timestamp as well as its stage.
CREATE OR REPLACE FUNCTION cycle_termination_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terminated_at IS NOT NULL AND
    (to_jsonb(NEW) - ARRAY['status', 'published_at', 'deadline_appeal', 'closed_at', 'updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'published_at', 'deadline_appeal', 'closed_at', 'updated_at']) THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: cycle configuration is read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
