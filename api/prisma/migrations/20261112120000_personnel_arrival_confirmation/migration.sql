ALTER TABLE "employee_data_change_requests"
  ADD COLUMN "requires_arrival_confirmation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "arrival_date" DATE,
  ADD COLUMN "arrival_confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "arrival_confirmed_by_id" UUID,
  ADD COLUMN "talent_candidate_id" UUID;

ALTER TABLE "employee_data_change_requests"
  ADD CONSTRAINT "employee_data_change_requests_talent_candidate_id_fkey"
    FOREIGN KEY ("talent_candidate_id") REFERENCES "talent_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_arrival_confirmation_complete"
    CHECK (("arrival_confirmed_at" IS NULL AND "arrival_date" IS NULL AND "arrival_confirmed_by_id" IS NULL)
      OR ("arrival_confirmed_at" IS NOT NULL AND "arrival_date" IS NOT NULL AND "arrival_confirmed_by_id" IS NOT NULL));

CREATE INDEX "employee_data_change_requests_talent_candidate_id_onboarding_status_idx"
  ON "employee_data_change_requests"("talent_candidate_id", "onboarding_status");
