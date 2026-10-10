ALTER TABLE "assessment_periods"
ADD COLUMN "employee_attachments" JSONB NOT NULL DEFAULT '[]';
