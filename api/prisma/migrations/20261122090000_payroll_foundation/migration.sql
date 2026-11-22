-- CreateTable
CREATE TABLE "payroll_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "capabilities" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "revoked_at" TIMESTAMPTZ(6),
    "granted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL DEFAULT 'validation',
    "version" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "config" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_standards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL DEFAULT 'validation',
    "version" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "fixed_monthly" DECIMAL(16,4),
    "performance_base" DECIMAL(16,4),
    "performance_mode" VARCHAR(20),
    "evidence" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_attendance_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL DEFAULT 'validation',
    "month" VARCHAR(7) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "source_key" VARCHAR(100) NOT NULL,
    "source_hash" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "review" JSONB NOT NULL DEFAULT '[]',
    "sealed_hash" VARCHAR(64),
    "created_by_id" UUID NOT NULL,
    "sealed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_attendance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "pay_month" VARCHAR(7) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL DEFAULT 'trial',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "correction_of_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'calculated',
    "source_hash" VARCHAR(64) NOT NULL,
    "sources" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "approval_path" UUID[],
    "reviewer_count" INTEGER NOT NULL,
    "approval_step" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,2),
    "calculated_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attribution_month" VARCHAR(7) NOT NULL,
    "item_code" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ready',
    "entitlement" DECIMAL(16,2),
    "paid_before" DECIMAL(16,2),
    "amount" DECIMAL(16,2),
    "evidence" JSONB NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_reservations" (
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "attribution_month" VARCHAR(7) NOT NULL,
    "item_code" VARCHAR(30) NOT NULL,
    "line_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_reservations_pkey" PRIMARY KEY ("subject_id","employee_id","domain","attribution_month","item_code")
);

-- CreateTable
CREATE TABLE "payroll_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "confirmed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_opening_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "attribution_month" VARCHAR(7) NOT NULL,
    "item_code" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(16,2),
    "reference" VARCHAR(200),
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_export_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_export_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "batch_id" UUID,
    "version" INTEGER,
    "action" VARCHAR(40) NOT NULL,
    "actor_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_grants_user_id_subject_id_key" ON "payroll_grants"("user_id", "subject_id");

-- CreateIndex
CREATE INDEX "payroll_policies_subject_id_domain_status_effective_from_idx" ON "payroll_policies"("subject_id", "domain", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_policies_subject_id_domain_version_key" ON "payroll_policies"("subject_id", "domain", "version");

-- CreateIndex
CREATE INDEX "payroll_standards_subject_id_employee_id_domain_status_effe_idx" ON "payroll_standards"("subject_id", "employee_id", "domain", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_standards_subject_id_employee_id_domain_version_key" ON "payroll_standards"("subject_id", "employee_id", "domain", "version");

-- CreateIndex
CREATE INDEX "payroll_attendance_snapshots_subject_id_domain_month_status_idx" ON "payroll_attendance_snapshots"("subject_id", "domain", "month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_attendance_snapshots_subject_id_domain_month_versio_key" ON "payroll_attendance_snapshots"("subject_id", "domain", "month", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_attendance_snapshots_subject_id_domain_month_source_key" ON "payroll_attendance_snapshots"("subject_id", "domain", "month", "source_key");

-- CreateIndex
CREATE INDEX "payroll_batches_subject_id_month_purpose_status_idx" ON "payroll_batches"("subject_id", "month", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_versions_batch_id_version_key" ON "payroll_versions"("batch_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_version_id_employee_id_attribution_month_item_key" ON "payroll_lines"("version_id", "employee_id", "attribution_month", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_reservations_line_id_key" ON "payroll_reservations"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_decisions_version_id_step_key" ON "payroll_decisions"("version_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settlements_request_id_key" ON "payroll_settlements"("request_id");

-- CreateIndex
CREATE INDEX "payroll_settlements_line_id_idx" ON "payroll_settlements"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_opening_balances_subject_id_employee_id_domain_attr_key" ON "payroll_opening_balances"("subject_id", "employee_id", "domain", "attribution_month", "item_code");

-- CreateIndex
CREATE INDEX "payroll_export_records_version_id_idx" ON "payroll_export_records"("version_id");

-- CreateIndex
CREATE INDEX "payroll_events_subject_id_batch_id_created_at_idx" ON "payroll_events"("subject_id", "batch_id", "created_at");

-- AddForeignKey
ALTER TABLE "payroll_grants" ADD CONSTRAINT "payroll_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_grants" ADD CONSTRAINT "payroll_grants_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_policies" ADD CONSTRAINT "payroll_policies_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_standards" ADD CONSTRAINT "payroll_standards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_standards" ADD CONSTRAINT "payroll_standards_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_attendance_snapshots" ADD CONSTRAINT "payroll_attendance_snapshots_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_versions" ADD CONSTRAINT "payroll_versions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "payroll_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_reservations" ADD CONSTRAINT "payroll_reservations_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_reservations" ADD CONSTRAINT "payroll_reservations_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_decisions" ADD CONSTRAINT "payroll_decisions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "payroll_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "payroll_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_export_records" ADD CONSTRAINT "payroll_export_records_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "payroll_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_events" ADD CONSTRAINT "payroll_events_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "contract_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
