WITH repair_candidates AS MATERIALIZED (
  SELECT
    period."id",
    period."task_id",
    period."period_key",
    period."status"::text AS "old_status"
  FROM "assessment_periods" AS period
  INNER JOIN "assessment_tasks" AS task ON task."id" = period."task_id"
  INNER JOIN "assessment_cycles" AS cycle ON cycle."id" = task."cycle_id"
  LEFT JOIN "grade_results" AS grade_result ON grade_result."task_id" = task."id"
  WHERE cycle."workflow_version" = 2
    AND cycle."scoring_frequency" = 'monthly'
    AND cycle."opened_at" IS NOT NULL
    AND cycle."published_at" IS NULL
    AND cycle."closed_at" IS NULL
    AND task."status" = 'manager_scoring'
    AND task."published_at" IS NULL
    AND task."closed_at" IS NULL
    AND COALESCE(grade_result."is_published", FALSE) = FALSE
    AND grade_result."published_at" IS NULL
    AND period."period_type" = 'month'
    AND period."status" = 'manager_scoring'
    AND period."employee_submitted_at" IS NULL
    AND period."manager_submitted_at" IS NULL
    AND period."locked_at" IS NULL
), repaired AS (
  UPDATE "assessment_periods" AS period
  SET
    "status" = 'self_eval',
    "updated_at" = CURRENT_TIMESTAMP
  FROM repair_candidates AS candidate
  WHERE period."id" = candidate."id"
  RETURNING period."id", period."task_id", period."period_key"
), audited AS (
  INSERT INTO "audit_logs" (
    "id",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "old_value",
    "new_value",
    "created_at"
  )
  SELECT
    gen_random_uuid(),
    NULL,
    'monthly_period_state_repaired',
    'assessment_period',
    repaired."id",
    jsonb_build_object(
      'status', candidate."old_status",
      'periodKey', repaired."period_key"
    ),
    jsonb_build_object(
      'status', 'self_eval',
      'reason', 'restore_unsubmitted_month_after_legacy_deadline_advance',
      'migration', '20260903000002_restore_unsubmitted_months',
      'actor', 'system_migration'
    ),
    CURRENT_TIMESTAMP
  FROM repaired
  INNER JOIN repair_candidates AS candidate ON candidate."id" = repaired."id"
  RETURNING "entity_id"
)
UPDATE "assessment_tasks" AS task
SET
  "status" = 'self_eval',
  "updated_at" = CURRENT_TIMESTAMP
WHERE task."id" IN (SELECT DISTINCT "task_id" FROM repaired)
  AND task."status" = 'manager_scoring'
  AND task."published_at" IS NULL;
