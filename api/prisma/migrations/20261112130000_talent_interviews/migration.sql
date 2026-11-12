CREATE TABLE "talent_interviews" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" UUID NOT NULL REFERENCES "talent_candidates"("id") ON DELETE RESTRICT,
  "candidate_name_snapshot" VARCHAR(50) NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "invitation_text" TEXT NOT NULL,
  "meeting_url" VARCHAR(1000),
  "note" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK ("status" IN ('scheduled', 'completed', 'cancelled')),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "sync_status" VARCHAR(20) NOT NULL DEFAULT 'unconfigured' CHECK ("sync_status" IN ('pending', 'unconfigured', 'processing', 'synced', 'failed', 'uncertain')),
  "calendar_synced_version" INTEGER NOT NULL DEFAULT 0,
  "calendar_event_id" VARCHAR(255),
  "external_calendar_id" VARCHAR(255),
  "calendar_organizer_union_id" VARCHAR(255),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("ends_at" > "starts_at")
);
CREATE INDEX "talent_interviews_candidate_id_status_starts_at_idx" ON "talent_interviews"("candidate_id", "status", "starts_at");

CREATE TABLE "talent_interview_participants" (
  "interview_id" UUID NOT NULL REFERENCES "talent_interviews"("id") ON DELETE RESTRICT,
  "user_id" UUID NOT NULL,
  "user_name_snapshot" VARCHAR(50) NOT NULL,
  PRIMARY KEY ("interview_id", "user_id")
);
CREATE INDEX "talent_interview_participants_user_id_interview_id_idx" ON "talent_interview_participants"("user_id", "interview_id");

CREATE TABLE "talent_interview_syncs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "interview_id" UUID NOT NULL REFERENCES "talent_interviews"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "operation" VARCHAR(20) NOT NULL CHECK ("operation" IN ('upsert', 'cancel')),
  "status" VARCHAR(20) NOT NULL DEFAULT 'unconfigured' CHECK ("status" IN ('pending', 'unconfigured', 'processing', 'synced', 'failed', 'uncertain', 'superseded')),
  "participant_ids" UUID[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "calendar_event_id" VARCHAR(255),
  "external_calendar_id" VARCHAR(255),
  "calendar_organizer_union_id" VARCHAR(255),
  "error_code" VARCHAR(100),
  "claim_token" UUID,
  "claimed_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "talent_interview_syncs_interview_id_version_key" ON "talent_interview_syncs"("interview_id", "version");
CREATE INDEX "talent_interview_syncs_status_next_attempt_at_idx" ON "talent_interview_syncs"("status", "next_attempt_at");
