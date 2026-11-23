CREATE TABLE "employee_archive_issue_exemptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "issue_id" VARCHAR(100) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "is_exempt" BOOLEAN NOT NULL DEFAULT true,
  "message" VARCHAR(300) NOT NULL,
  "current_value" TEXT,
  "field" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_archive_issue_exemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archive_issue_exemption_valid_version" CHECK ("version" > 0),
  CONSTRAINT "employee_archive_issue_exemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_archive_issue_exemptions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "archive_issue_exemption_fact_key" ON "employee_archive_issue_exemptions"("user_id", "issue_id", "fingerprint");
CREATE INDEX "employee_archive_issue_exemptions_user_id_is_exempt_idx" ON "employee_archive_issue_exemptions"("user_id", "is_exempt");
