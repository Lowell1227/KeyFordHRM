BEGIN;

-- CHECK accepts UNKNOWN: mode branches must be boolean even for legacy NULL modes.
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
          AND (((approval_mode IS NULL OR approval_mode IS NOT DISTINCT FROM 'independent') AND approved_by_id <> submitted_by_id)
            OR (approval_mode IS NOT DISTINCT FROM 'self_created' AND created_by_id = submitted_by_id AND submitted_by_id = approved_by_id))
          AND approved_at IS NOT NULL AND approved_headcount IS NOT NULL AND mapped_fingerprint IS NOT NULL
          AND approved_headcount = requested_headcount AND mapped_fingerprint = source_fingerprint)
      ))
    ))
);

COMMIT;
