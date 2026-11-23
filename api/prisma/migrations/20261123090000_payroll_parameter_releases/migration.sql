CREATE TABLE "payroll_parameter_releases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_id" UUID NOT NULL,
  "domain" VARCHAR(20) NOT NULL CHECK ("domain" IN ('validation', 'formal')),
  "kind" VARCHAR(20) NOT NULL CHECK ("kind" IN ('standard', 'rule')),
  "standard_id" UUID,
  "rule_id" UUID,
  "attempt" INTEGER NOT NULL CHECK ("attempt" > 0),
  "parameter_version" INTEGER NOT NULL CHECK ("parameter_version" > 0),
  "previous_parameter_id" UUID,
  "previous_hash" VARCHAR(64),
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'returned', 'withdrawn')),
  "submitted_by_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" VARCHAR(64) NOT NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  "note" VARCHAR(500) NOT NULL DEFAULT '',
  CONSTRAINT "payroll_parameter_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_parameter_releases_reference_check" CHECK (
    ("kind" = 'standard' AND "standard_id" IS NOT NULL AND "rule_id" IS NULL)
    OR ("kind" = 'rule' AND "rule_id" IS NOT NULL AND "standard_id" IS NULL)),
  CONSTRAINT "payroll_parameter_releases_no_self_review" CHECK ("submitted_by_id" <> "reviewer_id"),
  CONSTRAINT "payroll_parameter_releases_subject_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_parameter_releases_standard_fkey" FOREIGN KEY ("standard_id") REFERENCES "payroll_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_parameter_releases_rule_fkey" FOREIGN KEY ("rule_id") REFERENCES "payroll_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_parameter_releases_submitter_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_parameter_releases_reviewer_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payroll_parameter_releases_standard_id_attempt_key" ON "payroll_parameter_releases"("standard_id", "attempt");
CREATE UNIQUE INDEX "payroll_parameter_releases_rule_id_attempt_key" ON "payroll_parameter_releases"("rule_id", "attempt");
CREATE INDEX "payroll_parameter_releases_reviewer_id_subject_id_status_idx" ON "payroll_parameter_releases"("reviewer_id", "subject_id", "status");
CREATE INDEX "payroll_parameter_releases_submitted_by_id_subject_id_status_idx" ON "payroll_parameter_releases"("submitted_by_id", "subject_id", "status");
CREATE UNIQUE INDEX "payroll_parameter_releases_pending_standard" ON "payroll_parameter_releases"("standard_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "payroll_parameter_releases_pending_rule" ON "payroll_parameter_releases"("rule_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "payroll_parameter_releases_approved_standard" ON "payroll_parameter_releases"("standard_id") WHERE "status" = 'approved';
CREATE UNIQUE INDEX "payroll_parameter_releases_approved_rule" ON "payroll_parameter_releases"("rule_id") WHERE "status" = 'approved';
CREATE UNIQUE INDEX "payroll_parameter_releases_no_branch" ON "payroll_parameter_releases"("subject_id", "domain", "kind", "previous_parameter_id") WHERE "status" = 'approved' AND "previous_parameter_id" IS NOT NULL;
