DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "department_change_requests"
    WHERE "department_id" IS NOT NULL AND "status" IN ('pending', 'applying')
    GROUP BY "department_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate open department change requests exist; resolve them before migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "department_change_requests"
    WHERE "department_id" IS NULL AND "action" = 'create' AND "status" IN ('pending', 'applying')
    GROUP BY
      COALESCE("proposed_value"->>'parentId', ''),
      LOWER(BTRIM(COALESCE("proposed_value"->>'name', ''))),
      COALESCE("proposed_value"->>'company', '')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate open department create requests exist; resolve them before migration';
  END IF;
END $$;

ALTER TABLE "employee_contracts"
  ADD COLUMN "images" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX "department_change_requests_one_open_per_department_idx"
  ON "department_change_requests" ("department_id")
  WHERE "department_id" IS NOT NULL AND "status" IN ('pending', 'applying');

CREATE UNIQUE INDEX "department_change_requests_one_open_create_idx"
  ON "department_change_requests" (
    (COALESCE("proposed_value"->>'parentId', '')),
    (LOWER(BTRIM(COALESCE("proposed_value"->>'name', '')))),
    (COALESCE("proposed_value"->>'company', ''))
  )
  WHERE "department_id" IS NULL AND "action" = 'create' AND "status" IN ('pending', 'applying');
