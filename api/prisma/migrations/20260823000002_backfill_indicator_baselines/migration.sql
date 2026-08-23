-- 已确认目标在旧版本中没有正式指标基线事件。
-- 当前业务规则禁止确认后直接修改指标，因此可用现有结构字段幂等回填 V1。
INSERT INTO "audit_logs" (
  "user_id",
  "action",
  "entity_type",
  "entity_id",
  "old_value",
  "new_value",
  "created_at"
)
SELECT
  task."employee_id",
  'indicator_baseline_confirmed',
  'indicator_instance',
  indicator."id",
  NULL,
  jsonb_build_object(
    'version', 1,
    'taskId', indicator."task_id",
    'templateIndicatorId', indicator."template_indicator_id",
    'name', indicator."name",
    'description', indicator."description",
    'scoringStandard', indicator."scoring_standard",
    'dataSource', indicator."data_source",
    'dataCaliber', indicator."data_caliber",
    'targetValue', indicator."target_value",
    'targetValueText', indicator."target_value_text",
    'unit', indicator."unit",
    'weight', indicator."weight",
    'indicatorType', indicator."indicator_type"::text,
    'dimensionName', indicator."dimension_name",
    'dimensionWeight', indicator."dimension_weight",
    'visibilityScope', indicator."visibility_scope"::text,
    'visibleDepartmentIds', COALESCE((
      SELECT jsonb_agg(visible_department."department_id" ORDER BY visible_department."department_id")
      FROM "indicator_visibility_departments" AS visible_department
      WHERE visible_department."indicator_instance_id" = indicator."id"
    ), '[]'::jsonb),
    'visibleUserIds', COALESCE((
      SELECT jsonb_agg(visible_user."user_id" ORDER BY visible_user."user_id")
      FROM "indicator_visibility_users" AS visible_user
      WHERE visible_user."indicator_instance_id" = indicator."id"
    ), '[]'::jsonb),
    'alignedObjectiveIds', COALESCE((
      SELECT jsonb_agg(alignment."objective_id" ORDER BY alignment."objective_id")
      FROM "indicator_objective_alignments" AS alignment
      WHERE alignment."indicator_instance_id" = indicator."id"
    ), '[]'::jsonb),
    'sortOrder', indicator."sort_order"
  ),
  task."indicator_confirmed_at"
FROM "indicator_instances" AS indicator
JOIN "assessment_tasks" AS task ON task."id" = indicator."task_id"
WHERE task."indicator_confirmed_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "audit_logs" AS existing
    WHERE existing."entity_type" = 'indicator_instance'
      AND existing."entity_id" = indicator."id"
      AND existing."action" = 'indicator_baseline_confirmed'
  );

-- 数据库兜底：同一指标只能形成一个正式 V1 基线，防止并发确认重复留痕。
CREATE UNIQUE INDEX "audit_logs_indicator_baseline_unique_idx"
  ON "audit_logs" ("entity_id", "action")
  WHERE "entity_type" = 'indicator_instance'
    AND "action" = 'indicator_baseline_confirmed';
