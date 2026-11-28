BEGIN;

-- Preserve both source shapes; only explicitly evidenced self-created approval is new.
ALTER TABLE recruitment_demands DROP CONSTRAINT recruitment_demands_origin_shape_check;
ALTER TABLE recruitment_demands ADD CONSTRAINT recruitment_demands_origin_shape_check CHECK (
  (source_kind = 'dingtalk' AND organization_key IS NOT NULL AND process_code IS NOT NULL AND instance_id IS NOT NULL
    AND last_synced_at IS NOT NULL AND local_request_id IS NULL AND local_creation_fingerprint IS NULL
    AND requested_headcount IS NULL AND request_reason IS NULL AND created_by_id IS NULL AND submitted_by_id IS NULL
    AND approved_by_id IS NULL AND approval_mode IS NULL)
  OR (source_kind = 'local' AND organization_key IS NULL AND process_code IS NULL AND instance_id IS NULL AND last_synced_at IS NULL
    AND source_created_at IS NULL AND source_updated_at IS NULL AND source_link IS NULL AND main_instance_id IS NULL AND biz_action IS NULL
    AND supersedes_instance_id IS NULL AND superseded_by_instance_id IS NULL AND raw_department IS NULL AND raw_position IS NULL
    AND raw_headcount IS NULL AND sync_issue IS NULL AND local_request_id IS NOT NULL AND local_creation_fingerprint IS NOT NULL
    AND requested_headcount IS NOT NULL AND requested_headcount > 0 AND request_reason IS NOT NULL AND length(btrim(request_reason)) > 0
    AND created_by_id IS NOT NULL AND dept_id IS NOT NULL AND position_id IS NOT NULL
    AND (source_state <> 'pending' OR submitted_by_id IS NOT NULL)
    AND (
      (source_state IN ('draft', 'rejected', 'pending') AND approved_by_id IS NULL AND approved_at IS NULL
        AND approved_headcount IS NULL AND mapped_fingerprint IS NULL AND approval_mode IS NULL)
      OR (source_state IN ('approved', 'withdrawn') AND (
        (source_state = 'withdrawn' AND approved_by_id IS NULL AND approved_at IS NULL AND approved_headcount IS NULL
          AND mapped_fingerprint IS NULL AND approval_mode IS NULL)
        OR (approved_by_id IS NOT NULL AND submitted_by_id IS NOT NULL
          AND (((approval_mode IS NULL OR approval_mode = 'independent') AND approved_by_id <> submitted_by_id)
            OR (approval_mode = 'self_created' AND created_by_id = submitted_by_id AND submitted_by_id = approved_by_id))
          AND approved_at IS NOT NULL AND approved_headcount IS NOT NULL AND mapped_fingerprint IS NOT NULL
          AND approved_headcount = requested_headcount AND mapped_fingerprint = source_fingerprint)
      ))
    ))
);

CREATE OR REPLACE FUNCTION recruitment_demand_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD.source_state IN ('approved', 'withdrawn') AND (NEW.approved_by_id, NEW.approved_at, NEW.approved_headcount, NEW.mapped_fingerprint, NEW.approval_mode)
       IS DISTINCT FROM (OLD.approved_by_id, OLD.approved_at, OLD.approved_headcount, OLD.mapped_fingerprint, OLD.approval_mode) THEN
      RAISE EXCEPTION 'Recruitment demand approval evidence is immutable';
    END IF;
    IF (OLD.source_state = 'draft' AND NEW.source_state NOT IN ('draft', 'pending', 'approved', 'withdrawn'))
      OR (OLD.source_state = 'pending' AND NEW.source_state NOT IN ('pending', 'rejected', 'approved', 'withdrawn'))
      OR (OLD.source_state = 'rejected' AND NEW.source_state NOT IN ('rejected', 'pending', 'approved', 'withdrawn'))
      OR (OLD.source_state = 'approved' AND NEW.source_state NOT IN ('approved', 'withdrawn'))
      OR (OLD.source_state = 'withdrawn' AND NEW.source_state <> 'withdrawn') THEN
      RAISE EXCEPTION 'Invalid local recruitment demand state transition';
    END IF;
    IF OLD.source_state IN ('draft', 'rejected') AND NEW.source_state = 'approved'
       AND (NEW.approval_mode IS DISTINCT FROM 'self_created' OR NEW.created_by_id IS DISTINCT FROM NEW.submitted_by_id
         OR NEW.submitted_by_id IS DISTINCT FROM NEW.approved_by_id) THEN
      RAISE EXCEPTION 'Combined approval requires an explicit self-created approval';
    END IF;
    IF NEW.source_state = 'approved' AND OLD.source_state <> 'approved' AND NEW.approval_mode = 'self_created' THEN
      PERFORM id FROM users WHERE id = NEW.approved_by_id AND status IN ('active', 'probation')
        AND archived_at IS NULL AND deleted_at IS NULL AND NOT is_assessor_only
        AND 'recruitment_demand_review' = ANY(hr_capabilities)
        AND (OLD.source_state = 'pending' OR sys_role IN ('hr', 'system_admin')
          OR 'recruitment_edit' = ANY(hr_capabilities)
          OR (sys_role = 'hr_user' AND 'employee_archive_edit' = ANY(hr_capabilities))) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Self-created approval requires current reviewer and action permissions'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION recruitment_demand_self_approval_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approval_mode = 'self_created' THEN
    RAISE EXCEPTION 'Self-created demand approval must start from a saved draft or pending request';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recruitment_demand_self_approval_insert_guard BEFORE INSERT ON recruitment_demands
  FOR EACH ROW EXECUTE FUNCTION recruitment_demand_self_approval_insert_guard();

-- record() appends the approval event in the same transaction, after updating the demand.
CREATE FUNCTION recruitment_demand_self_approval_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_kind = 'local' AND NEW.source_state = 'approved' AND OLD.source_state <> 'approved'
     AND NEW.approval_mode = 'self_created' THEN
    IF NOT EXISTS (
      SELECT 1 FROM recruitment_demand_events e WHERE e.demand_id = NEW.id AND e.revision = NEW.revision
        AND e.actor_id = NEW.approved_by_id
        AND e.action = CASE WHEN OLD.source_state IN ('draft', 'rejected') THEN 'local_submit_approve' ELSE 'local_approve' END
        AND e.snapshot->>'id' = NEW.id::text AND e.snapshot->>'revision' = NEW.revision::text
        AND e.snapshot->>'sourceKind' = 'local' AND e.snapshot->>'sourceState' = 'approved'
        AND e.snapshot->>'approvalMode' = 'self_created'
        AND e.snapshot->>'createdById' = NEW.created_by_id::text
        AND e.snapshot->>'submittedById' = NEW.submitted_by_id::text
        AND e.snapshot->>'approvedById' = NEW.approved_by_id::text
        AND e.snapshot->>'deptId' = NEW.dept_id::text AND e.snapshot->>'positionId' = NEW.position_id::text
        AND e.snapshot->>'requestedHeadcount' = NEW.requested_headcount::text
        AND e.snapshot->>'approvedHeadcount' = NEW.approved_headcount::text
        AND e.snapshot->>'sourceFingerprint' = NEW.source_fingerprint::text
        AND e.snapshot->>'mappedFingerprint' = NEW.mapped_fingerprint::text
        AND e.snapshot->>'approvedAt' = to_char(NEW.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) THEN RAISE EXCEPTION 'Self-created demand approval requires its matching immutable approval event'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER recruitment_demand_self_approval_evidence_guard
  AFTER UPDATE ON recruitment_demands DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION recruitment_demand_self_approval_evidence_guard();

COMMIT;
