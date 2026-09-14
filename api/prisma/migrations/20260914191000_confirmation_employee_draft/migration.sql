ALTER TABLE "confirmation_applications"
  ADD COLUMN "workflow_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submission_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "manager_recommendation" BOOLEAN,
  ADD COLUMN "vote_recorded_at" TIMESTAMPTZ(6),
  ADD COLUMN "meeting_date" DATE,
  ADD COLUMN "vote_recorded_by_id" UUID,
  ADD COLUMN "proposed_regular_date" DATE,
  ADD COLUMN "return_reason" TEXT,
  ADD COLUMN "returned_at" TIMESTAMPTZ(6),
  ADD COLUMN "returned_by_id" UUID,
  ALTER COLUMN "manager_id" DROP NOT NULL,
  ALTER COLUMN "hr_id" DROP NOT NULL,
  ALTER COLUMN "company_approver_id" DROP NOT NULL;

ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_vote_recorded_by_id_fkey" FOREIGN KEY ("vote_recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "confirmation_applications" ADD CONSTRAINT "confirmation_applications_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "confirmation_one_ongoing_application_per_employee"
  ON "confirmation_applications" ("employee_id")
  WHERE "workflow_version" = 2
    AND "status" IN ('draft', 'submitted', 'manager_approved', 'hr_approved');

CREATE TABLE "confirmation_meeting_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "object_key" VARCHAR(600) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "size" INTEGER NOT NULL,
  "mime_type" VARCHAR(150) NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "submission_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "confirmation_meeting_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "confirmation_meeting_attachments_object_key_key" ON "confirmation_meeting_attachments"("object_key");
CREATE INDEX "confirmation_meeting_attachments_application_id_created_at_idx" ON "confirmation_meeting_attachments"("application_id", "created_at");
ALTER TABLE "confirmation_meeting_attachments" ADD CONSTRAINT "confirmation_meeting_attachments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "confirmation_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "confirmation_meeting_attachments" ADD CONSTRAINT "confirmation_meeting_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
