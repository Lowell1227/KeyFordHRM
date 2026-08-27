\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  yao_count INTEGER;
  yu_count INTEGER;
  fang_count INTEGER;
  yao_is_hr_leader BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO yao_count
  FROM "users"
  WHERE "employee_no" = '312' AND "name" = '姚瑶'
    AND "deleted_at" IS NULL AND "status" <> 'resigned';

  SELECT COUNT(*) INTO yu_count
  FROM "users"
  WHERE "employee_no" = '335' AND "name" = '余焱玲'
    AND "deleted_at" IS NULL AND "status" <> 'resigned';

  SELECT COUNT(*) INTO fang_count
  FROM "users"
  WHERE "employee_no" = '319' AND "name" = '方园'
    AND "deleted_at" IS NULL AND "status" <> 'resigned';

  SELECT EXISTS (
    SELECT 1
    FROM "departments" d
    JOIN "users" u ON u."id" = d."leader_id"
    WHERE u."employee_no" = '312'
      AND u."name" = '姚瑶'
      AND d."name" IN ('人事行政部', '人事组', '人事部')
  ) INTO yao_is_hr_leader;

  IF yao_count <> 1 OR yu_count <> 1 OR fang_count <> 1 OR NOT yao_is_hr_leader THEN
    RAISE EXCEPTION 'Production HR backfill identity check failed (姚瑶 %, 余焱玲 %, 方园 %, HR leader %)',
      yao_count, yu_count, fang_count, yao_is_hr_leader;
  END IF;
END $$;

UPDATE "users"
SET
  "password_hash" = crypt('0000', gen_salt('bf', 10)),
  "must_change_password" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "account_type" = 'employee'
  AND "deleted_at" IS NULL
  AND "status" <> 'resigned';

WITH hr_root AS (
  SELECT d."full_path"
  FROM "users" u
  JOIN "departments" d ON d."id" = u."dept_id"
  WHERE u."employee_no" = '312' AND u."name" = '姚瑶'
)
UPDATE "users" AS u
SET "sys_role" = CASE
  WHEN u."employee_no" = '312' THEN 'hr'::"sys_role"
  ELSE 'hr_user'::"sys_role"
END
FROM "departments" d, hr_root r
WHERE u."dept_id" = d."id"
  AND u."deleted_at" IS NULL
  AND u."status" <> 'resigned'
  AND u."sys_role" <> 'system_admin'
  AND (d."full_path" = r."full_path" OR d."full_path" LIKE r."full_path" || ' / %');

UPDATE "users"
SET "hr_capabilities" = ARRAY['employee_archive_edit', 'organization_edit']::VARCHAR(60)[]
WHERE "employee_no" = '335' AND "name" = '余焱玲'
  AND "deleted_at" IS NULL AND "status" <> 'resigned';

UPDATE "users"
SET "hr_capabilities" = ARRAY['cycle_plan_edit']::VARCHAR(60)[]
WHERE "employee_no" = '319' AND "name" = '方园'
  AND "deleted_at" IS NULL AND "status" <> 'resigned';
