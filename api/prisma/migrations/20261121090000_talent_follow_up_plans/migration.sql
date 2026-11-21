BEGIN;

ALTER TABLE talent_follow_ups
  ADD COLUMN plan_status VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN plan_closed_at TIMESTAMPTZ(6),
  ADD COLUMN plan_closed_by_id UUID;

-- Carry forward exactly the date displayed by the previous list and export.
WITH dated AS (
  SELECT id, row_number() OVER (
    PARTITION BY candidate_id ORDER BY occurred_at DESC, created_at DESC, id DESC
  ) AS position
  FROM talent_follow_ups
  WHERE next_follow_up_at IS NOT NULL
)
UPDATE talent_follow_ups AS f
SET plan_status = CASE WHEN dated.position = 1 THEN 'pending' ELSE 'superseded' END
FROM dated WHERE dated.id = f.id;

ALTER TABLE talent_follow_ups ADD CONSTRAINT talent_follow_ups_plan_date_check CHECK (
  (next_follow_up_at IS NULL AND plan_status = 'none') OR
  (next_follow_up_at IS NOT NULL AND plan_status IN ('pending','completed','cancelled','superseded'))
);
CREATE UNIQUE INDEX talent_follow_ups_one_pending_idx ON talent_follow_ups(candidate_id)
  WHERE plan_status = 'pending';

COMMIT;
