-- Historical explanations remain unchanged; reasons are recorded only for new reserve events.
ALTER TABLE "talent_application_events"
  ADD COLUMN "reserve_reasons" VARCHAR(40)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(40)[];
