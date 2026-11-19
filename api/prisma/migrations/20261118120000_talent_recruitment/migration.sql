ALTER TABLE "talent_candidates"
  ADD COLUMN "owner_id" UUID,
  ADD COLUMN "education_reference_data_id" UUID;
ALTER TABLE "talent_candidates" ALTER COLUMN "education" TYPE VARCHAR(100);
ALTER TABLE "talent_candidates" ADD CONSTRAINT "talent_candidates_education_reference_data_id_fkey"
  FOREIGN KEY ("education_reference_data_id") REFERENCES "personnel_reference_data"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "talent_candidates_owner_id_updated_at_idx" ON "talent_candidates"("owner_id", "updated_at" DESC);
ALTER TABLE "talent_shares" ADD COLUMN "request_id" UUID;
CREATE UNIQUE INDEX "talent_shares_request_id_key" ON "talent_shares"("request_id");

CREATE TABLE "talent_applications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "candidate_id" UUID NOT NULL,
  "position_name" VARCHAR(100) NOT NULL,
  "recruitment_batch" VARCHAR(100),
  "dept_id" UUID,
  "department_name_snapshot" VARCHAR(100),
  "owner_id" UUID NOT NULL,
  "stage" VARCHAR(30) NOT NULL DEFAULT 'screening',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "expected_entry_date" DATE,
  "hiring_reason" TEXT,
  "hiring_requested_by_id" UUID,
  "hiring_requested_at" TIMESTAMPTZ(6),
  "hiring_reviewed_by_id" UUID,
  "hiring_reviewed_at" TIMESTAMPTZ(6),
  "review_return_stage" VARCHAR(30),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "talent_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "talent_applications_stage_check" CHECK ("stage" IN ('screening','interviewing','hiring_review','offered','accepted','declined','rejected','reserve','withdrawn','onboarding','hired')),
  CONSTRAINT "talent_applications_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "talent_applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "talent_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "talent_applications_candidate_id_updated_at_idx" ON "talent_applications"("candidate_id", "updated_at" DESC);
CREATE INDEX "talent_applications_owner_id_stage_idx" ON "talent_applications"("owner_id", "stage");

CREATE TABLE "talent_application_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(50) NOT NULL,
  "from_stage" VARCHAR(30),
  "to_stage" VARCHAR(30) NOT NULL,
  "version" INTEGER NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "talent_application_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "talent_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "talent_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "talent_application_events_application_id_created_at_idx" ON "talent_application_events"("application_id", "created_at");

ALTER TABLE "talent_interviews" ADD COLUMN "application_id" UUID;
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interviews_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "talent_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "talent_interviews_application_id_starts_at_idx" ON "talent_interviews"("application_id", "starts_at");

CREATE TABLE "talent_interview_feedback" (
  "interview_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "outcome" VARCHAR(20),
  "summary" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "submitted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "talent_interview_feedback_pkey" PRIMARY KEY ("interview_id", "user_id"),
  CONSTRAINT "talent_interview_feedback_status_check" CHECK ("status" IN ('draft','submitted')),
  CONSTRAINT "talent_interview_feedback_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('pass','reject','pending')),
  CONSTRAINT "talent_interview_feedback_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "talent_interview_feedback_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "talent_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "employee_data_change_requests" ADD COLUMN "talent_application_id" UUID;
CREATE TABLE "talent_interview_feedback_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "interview_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "outcome" VARCHAR(20),
  "summary" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "talent_interview_feedback_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "talent_interview_feedback_events_interview_id_fkey"
    FOREIGN KEY ("interview_id") REFERENCES "talent_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "talent_interview_feedback_events_interview_id_user_id_creat_idx"
  ON "talent_interview_feedback_events"("interview_id", "user_id", "created_at");
ALTER TABLE "employee_data_change_requests" ADD CONSTRAINT "employee_data_change_requests_talent_application_id_fkey"
  FOREIGN KEY ("talent_application_id") REFERENCES "talent_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "employee_data_change_requests_talent_application_id_onboard_idx"
  ON "employee_data_change_requests"("talent_application_id", "onboarding_status");
