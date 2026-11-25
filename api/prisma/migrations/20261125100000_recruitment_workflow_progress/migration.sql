ALTER TABLE "talent_applications"
  ADD COLUMN "intent_demand_id" UUID,
  ADD COLUMN "source_channel" VARCHAR(20);

ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_intent_demand_id_fkey"
  FOREIGN KEY ("intent_demand_id") REFERENCES "recruitment_demands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "talent_applications_intent_demand_id_stage_idx" ON "talent_applications"("intent_demand_id", "stage");
CREATE INDEX "talent_applications_source_channel_created_at_idx" ON "talent_applications"("source_channel", "created_at");

ALTER TABLE "recruitment_demands"
  ADD COLUMN "tracking_state" VARCHAR(20) NOT NULL DEFAULT 'recruiting',
  ADD COLUMN "tracking_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "tracking_changed_by_id" UUID,
  ADD COLUMN "tracking_reason" VARCHAR(2000);

ALTER TABLE "recruitment_demands" ADD CONSTRAINT "recruitment_demands_tracking_state_check"
  CHECK ("tracking_state" IN ('recruiting', 'filled', 'paused', 'cancelled'));
