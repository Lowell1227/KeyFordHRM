BEGIN;

ALTER TABLE "recruitment_demands" ADD COLUMN "approval_mode" VARCHAR(20);
ALTER TABLE "recruitment_demands" ADD CONSTRAINT "recruitment_demands_approval_mode_check"
  CHECK ("approval_mode" IS NULL OR "approval_mode" IN ('independent', 'self_created'));

ALTER TABLE "talent_follow_ups"
  ADD COLUMN "record_type" VARCHAR(20) NOT NULL DEFAULT 'communication',
  ADD COLUMN "source_intake_id" UUID,
  ADD COLUMN "source_follow_up_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "talent_follow_ups_source_intake_id_key" ON "talent_follow_ups"("source_intake_id");
ALTER TABLE "talent_follow_ups" ADD CONSTRAINT "talent_follow_ups_record_type_check" CHECK (
  ("record_type" = 'communication' AND "source_intake_id" IS NULL AND "source_follow_up_at" IS NULL) OR
  ("record_type" = 'plan' AND "source_intake_id" IS NOT NULL AND "source_follow_up_at" IS NOT NULL)
);

COMMIT;
