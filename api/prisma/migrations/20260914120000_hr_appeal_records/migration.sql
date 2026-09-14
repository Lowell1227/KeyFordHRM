CREATE TABLE "hr_appeal_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "cycle_id" UUID,
  "received_at" DATE NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "content" TEXT NOT NULL,
  "handling_note" TEXT,
  "conclusion" TEXT,
  "recorded_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_appeal_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_appeal_records_employee_id_idx" ON "hr_appeal_records"("employee_id");
CREATE INDEX "hr_appeal_records_cycle_id_idx" ON "hr_appeal_records"("cycle_id");
CREATE INDEX "hr_appeal_records_received_at_idx" ON "hr_appeal_records"("received_at");

ALTER TABLE "hr_appeal_records" ADD CONSTRAINT "hr_appeal_records_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_appeal_records" ADD CONSTRAINT "hr_appeal_records_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_appeal_records" ADD CONSTRAINT "hr_appeal_records_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
