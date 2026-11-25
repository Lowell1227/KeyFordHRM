ALTER TABLE recruitment_demands
    ADD COLUMN source_kind VARCHAR(20) NOT NULL DEFAULT 'dingtalk',
    ADD COLUMN local_request_id UUID,
    ADD COLUMN local_creation_fingerprint CHAR(64),
    ADD COLUMN requested_headcount INTEGER,
    ADD COLUMN request_reason TEXT,
    ADD COLUMN created_by_id UUID,
    ADD COLUMN submitted_by_id UUID,
    ADD COLUMN approved_by_id UUID,
    ALTER COLUMN organization_key DROP NOT NULL,
    ALTER COLUMN process_code DROP NOT NULL,
    ALTER COLUMN instance_id DROP NOT NULL,
    ALTER COLUMN last_synced_at DROP NOT NULL;

ALTER TABLE recruitment_demands DROP CONSTRAINT recruitment_demands_state_check;
ALTER TABLE recruitment_demands ADD CONSTRAINT recruitment_demands_state_check CHECK (
    (source_kind = 'dingtalk' AND source_state IN ('pending', 'approved', 'rejected', 'withdrawn', 'unknown'))
    OR (source_kind = 'local' AND source_state IN ('draft', 'rejected', 'pending', 'approved', 'withdrawn'))
);
ALTER TABLE recruitment_demands ADD CONSTRAINT recruitment_demands_origin_shape_check CHECK (
    (source_kind = 'dingtalk' AND organization_key IS NOT NULL AND process_code IS NOT NULL AND instance_id IS NOT NULL
      AND last_synced_at IS NOT NULL AND local_request_id IS NULL AND local_creation_fingerprint IS NULL
      AND requested_headcount IS NULL AND request_reason IS NULL AND created_by_id IS NULL AND submitted_by_id IS NULL AND approved_by_id IS NULL)
    OR (source_kind = 'local' AND organization_key IS NULL AND process_code IS NULL AND instance_id IS NULL AND last_synced_at IS NULL
      AND source_created_at IS NULL AND source_updated_at IS NULL AND source_link IS NULL AND main_instance_id IS NULL AND biz_action IS NULL
      AND supersedes_instance_id IS NULL AND superseded_by_instance_id IS NULL AND raw_department IS NULL AND raw_position IS NULL
      AND raw_headcount IS NULL AND sync_issue IS NULL AND local_request_id IS NOT NULL AND local_creation_fingerprint IS NOT NULL
      AND requested_headcount IS NOT NULL AND requested_headcount > 0 AND request_reason IS NOT NULL AND length(btrim(request_reason)) > 0
      AND created_by_id IS NOT NULL AND dept_id IS NOT NULL AND position_id IS NOT NULL
      AND (source_state <> 'pending' OR submitted_by_id IS NOT NULL)
      AND (
        (source_state IN ('draft', 'rejected', 'pending') AND approved_by_id IS NULL AND approved_at IS NULL AND approved_headcount IS NULL AND mapped_fingerprint IS NULL)
        OR (source_state IN ('approved', 'withdrawn') AND (
          (source_state = 'withdrawn' AND approved_by_id IS NULL AND approved_at IS NULL AND approved_headcount IS NULL AND mapped_fingerprint IS NULL)
          OR (approved_by_id IS NOT NULL AND submitted_by_id IS NOT NULL AND approved_by_id <> submitted_by_id
            AND approved_at IS NOT NULL AND approved_headcount IS NOT NULL AND mapped_fingerprint IS NOT NULL
            AND approved_headcount = requested_headcount AND mapped_fingerprint = source_fingerprint)
        ))
      ))
);
CREATE UNIQUE INDEX recruitment_demands_local_request_id_key ON recruitment_demands(local_request_id);
CREATE INDEX recruitment_demands_source_kind_source_state_updated_at_idx ON recruitment_demands(source_kind, source_state, updated_at DESC);

CREATE FUNCTION recruitment_demand_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_kind IS DISTINCT FROM OLD.source_kind THEN
        RAISE EXCEPTION 'Recruitment demand source kind is immutable';
    END IF;
    IF OLD.source_kind = 'local' THEN
        IF (NEW.local_request_id, NEW.local_creation_fingerprint, NEW.created_by_id, NEW.created_at)
           IS DISTINCT FROM (OLD.local_request_id, OLD.local_creation_fingerprint, OLD.created_by_id, OLD.created_at) THEN
            RAISE EXCEPTION 'Local recruitment demand creation intent is immutable';
        END IF;
        IF OLD.source_state NOT IN ('draft', 'rejected') AND (NEW.dept_id, NEW.position_id, NEW.requested_headcount, NEW.request_reason, NEW.source_fingerprint)
           IS DISTINCT FROM (OLD.dept_id, OLD.position_id, OLD.requested_headcount, OLD.request_reason, OLD.source_fingerprint) THEN
            RAISE EXCEPTION 'Submitted recruitment demand business fields are immutable';
        END IF;
        IF OLD.source_state NOT IN ('draft', 'rejected') AND NEW.submitted_by_id IS DISTINCT FROM OLD.submitted_by_id THEN
            RAISE EXCEPTION 'Submitted recruitment demand author is immutable';
        END IF;
        IF OLD.source_state IN ('approved', 'withdrawn') AND (NEW.approved_by_id, NEW.approved_at, NEW.approved_headcount, NEW.mapped_fingerprint)
           IS DISTINCT FROM (OLD.approved_by_id, OLD.approved_at, OLD.approved_headcount, OLD.mapped_fingerprint) THEN
            RAISE EXCEPTION 'Recruitment demand approval evidence is immutable';
        END IF;
        IF (OLD.source_state = 'draft' AND NEW.source_state NOT IN ('draft', 'pending', 'withdrawn'))
          OR (OLD.source_state = 'pending' AND NEW.source_state NOT IN ('pending', 'rejected', 'approved', 'withdrawn'))
          OR (OLD.source_state = 'rejected' AND NEW.source_state NOT IN ('rejected', 'pending', 'withdrawn'))
          OR (OLD.source_state = 'approved' AND NEW.source_state NOT IN ('approved', 'withdrawn'))
          OR (OLD.source_state = 'withdrawn' AND NEW.source_state <> 'withdrawn') THEN
            RAISE EXCEPTION 'Invalid local recruitment demand state transition';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER recruitment_demand_origin_guard BEFORE UPDATE ON recruitment_demands
    FOR EACH ROW EXECUTE FUNCTION recruitment_demand_origin_guard();
