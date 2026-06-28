ALTER TABLE "indicators"
  ADD COLUMN IF NOT EXISTS "target_value_text" VARCHAR(100);

ALTER TABLE "template_indicators"
  ADD COLUMN IF NOT EXISTS "target_value_text" VARCHAR(100);

ALTER TABLE "indicator_instances"
  ADD COLUMN IF NOT EXISTS "target_value_text" VARCHAR(100);
