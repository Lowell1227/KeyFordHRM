-- 系统权限只保留三类：system_admin、hr、employee（前端显示为“标准用户”）。
-- 旧 manager/dept_head/vp/chairman 仅是历史兼容值，业务权限已由实时关系和任务快照计算。
-- 先记录审计，再归一化账号字段；岗位、组织关系和历史任务责任人均不改动。
INSERT INTO "audit_logs" (
  "user_id",
  "action",
  "entity_type",
  "entity_id",
  "old_value",
  "new_value"
)
SELECT
  NULL,
  'system_permission_normalized',
  'user',
  "id",
  jsonb_build_object('sysRole', "sys_role"::text),
  jsonb_build_object('sysRole', 'employee')
FROM "users"
WHERE "sys_role" IN ('manager', 'dept_head', 'vp', 'chairman');

UPDATE "users"
SET "sys_role" = 'employee'::"sys_role"
WHERE "sys_role" IN ('manager', 'dept_head', 'vp', 'chairman');
