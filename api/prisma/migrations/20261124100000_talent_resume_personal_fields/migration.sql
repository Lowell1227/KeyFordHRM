ALTER TABLE "talent_candidates"
  ADD COLUMN "birth_month" INTEGER,
  ADD COLUMN "reported_age" INTEGER,
  ADD COLUMN "reported_age_recorded_at" TIMESTAMPTZ(6);

ALTER TABLE "talent_candidates"
  ADD CONSTRAINT "talent_candidates_birth_month_check"
    CHECK ("birth_month" IS NULL OR ("birth_year" IS NOT NULL AND "birth_month" BETWEEN 1 AND 12)),
  ADD CONSTRAINT "talent_candidates_reported_age_check"
    CHECK ("reported_age" IS NULL OR "reported_age" BETWEEN 0 AND 150),
  ADD CONSTRAINT "talent_candidates_reported_age_recorded_at_check"
    CHECK (("reported_age" IS NULL) = ("reported_age_recorded_at" IS NULL));
