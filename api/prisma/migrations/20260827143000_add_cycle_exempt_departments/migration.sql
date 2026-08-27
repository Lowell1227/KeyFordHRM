ALTER TABLE "assessment_cycles"
ADD COLUMN "explicit_exempt_dept_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
