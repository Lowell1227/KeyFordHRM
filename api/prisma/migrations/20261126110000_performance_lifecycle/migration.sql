-- Additive lifecycle metadata only. No historical status rewrite or cleanup.
ALTER TABLE "assessment_tasks"
  ADD COLUMN "lifecycle_status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminated_at" TIMESTAMPTZ(3),
  ADD COLUMN "terminated_by_id" UUID,
  ADD COLUMN "termination_reason" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_by_id" UUID,
  ADD COLUMN "deletion_reason" TEXT,
  ADD CONSTRAINT "assessment_tasks_lifecycle_check" CHECK (
    lifecycle_version >= 0 AND lifecycle_status IN ('active', 'terminated', 'deleted')
    AND (lifecycle_status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL AND length(btrim(termination_reason)) > 0))
    AND (lifecycle_status <> 'deleted' OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL AND length(btrim(deletion_reason)) > 0))
  );
CREATE INDEX "assessment_tasks_lifecycle_status_idx" ON "assessment_tasks"("lifecycle_status");
ALTER TABLE "goal_change_requests"
  ADD COLUMN "lifecycle_status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminated_at" TIMESTAMPTZ(3),
  ADD COLUMN "terminated_by_id" UUID,
  ADD COLUMN "termination_reason" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_by_id" UUID,
  ADD COLUMN "deletion_reason" TEXT,
  ADD CONSTRAINT "goal_change_requests_lifecycle_check" CHECK (
    lifecycle_version >= 0 AND lifecycle_status IN ('active', 'terminated', 'deleted')
    AND (lifecycle_status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL AND length(btrim(termination_reason)) > 0))
    AND (lifecycle_status <> 'deleted' OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL AND length(btrim(deletion_reason)) > 0))
  );
CREATE INDEX "goal_change_requests_lifecycle_status_idx" ON "goal_change_requests"("lifecycle_status");
ALTER TABLE "improvement_plans"
  ADD COLUMN "lifecycle_status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminated_at" TIMESTAMPTZ(3),
  ADD COLUMN "terminated_by_id" UUID,
  ADD COLUMN "termination_reason" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_by_id" UUID,
  ADD COLUMN "deletion_reason" TEXT,
  ADD CONSTRAINT "improvement_plans_lifecycle_check" CHECK (
    lifecycle_version >= 0 AND lifecycle_status IN ('active', 'terminated', 'deleted')
    AND (lifecycle_status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL AND length(btrim(termination_reason)) > 0))
    AND (lifecycle_status <> 'deleted' OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL AND length(btrim(deletion_reason)) > 0))
  );
CREATE INDEX "improvement_plans_lifecycle_status_idx" ON "improvement_plans"("lifecycle_status");
ALTER TABLE "confirmation_applications"
  ADD COLUMN "lifecycle_status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminated_at" TIMESTAMPTZ(3),
  ADD COLUMN "terminated_by_id" UUID,
  ADD COLUMN "termination_reason" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_by_id" UUID,
  ADD COLUMN "deletion_reason" TEXT,
  ADD CONSTRAINT "confirmation_applications_lifecycle_check" CHECK (
    lifecycle_version >= 0 AND lifecycle_status IN ('active', 'terminated', 'deleted')
    AND (lifecycle_status <> 'terminated' OR (terminated_at IS NOT NULL AND termination_reason IS NOT NULL AND length(btrim(termination_reason)) > 0))
    AND (lifecycle_status <> 'deleted' OR (deleted_at IS NOT NULL AND deletion_reason IS NOT NULL AND length(btrim(deletion_reason)) > 0))
  );
CREATE INDEX "confirmation_applications_lifecycle_status_idx" ON "confirmation_applications"("lifecycle_status");
ALTER TABLE "assessment_tasks" ADD COLUMN "employment_record_id" UUID,
  ADD CONSTRAINT "assessment_tasks_employment_record_id_fkey" FOREIGN KEY ("employment_record_id") REFERENCES "employment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "assessment_tasks_employment_record_id_idx" ON "assessment_tasks"("employment_record_id");
ALTER TABLE "improvement_plans" ADD COLUMN "employment_record_id" UUID,
  ADD CONSTRAINT "improvement_plans_employment_record_id_fkey" FOREIGN KEY ("employment_record_id") REFERENCES "employment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "improvement_plans_employment_record_id_idx" ON "improvement_plans"("employment_record_id");

-- Preserved business states must not reserve an actionable slot after termination.
DROP INDEX "goal_change_one_ongoing_per_task";
CREATE UNIQUE INDEX "goal_change_one_ongoing_per_task" ON "goal_change_requests"("task_id")
  WHERE "lifecycle_status" = 'active' AND "status" NOT IN ('active','revoked');
DROP INDEX "confirmation_one_ongoing_application_per_employee";
CREATE UNIQUE INDEX "confirmation_one_ongoing_application_per_employee" ON "confirmation_applications"("employee_id")
  WHERE "lifecycle_status" = 'active' AND "workflow_version" = 2
    AND "status" IN ('draft','submitted','manager_approved','hr_approved');

-- Same-row locks make legacy/out-of-band writers fail closed too. At repeatable-read
-- or serializable isolation PostgreSQL aborts rather than accepting a stale lock snapshot.
CREATE FUNCTION performance_lifecycle_payload(row_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT row_data - ARRAY['lifecycle_status','lifecycle_version','terminated_at','terminated_by_id',
    'termination_reason','deleted_at','deleted_by_id','deletion_reason','updated_at'];
$$;

CREATE FUNCTION performance_lifecycle_business_ended(table_name text, row_data jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE table_name
    WHEN 'assessment_tasks' THEN row_data->>'status' IN ('confirmed','appealing','published','closed','exempted')
      OR row_data->>'approved_at' IS NOT NULL OR row_data->>'employee_confirmed_at' IS NOT NULL
      OR row_data->>'published_at' IS NOT NULL OR row_data->>'closed_at' IS NOT NULL OR (row_data->>'is_exempt')::boolean
    WHEN 'goal_change_requests' THEN row_data->>'status' IN ('active','revoked') OR row_data->>'effective_version_id' IS NOT NULL
    WHEN 'improvement_plans' THEN row_data->>'status' = 'completed'
    WHEN 'confirmation_applications' THEN row_data->>'status' IN ('approved','rejected') OR row_data->>'actual_regular_date' IS NOT NULL
    ELSE false END;
$$;

CREATE FUNCTION performance_lifecycle_archive_ready(table_name text, row_data jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT row_data->>'lifecycle_status' = 'terminated' OR CASE table_name
    WHEN 'assessment_tasks' THEN row_data->>'status' IN ('closed','exempted') OR (row_data->>'is_exempt')::boolean
      OR (row_data->>'status' IN ('published','confirmed') AND row_data->>'published_at' IS NOT NULL AND row_data->>'employee_confirmed_at' IS NOT NULL)
    WHEN 'goal_change_requests' THEN row_data->>'status' IN ('active','revoked') OR row_data->>'effective_version_id' IS NOT NULL
    WHEN 'improvement_plans' THEN row_data->>'status' = 'completed'
    WHEN 'confirmation_applications' THEN row_data->>'status' IN ('approved','rejected')
    ELSE false END;
$$;

CREATE FUNCTION performance_lifecycle_root_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE employee_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.lifecycle_status <> 'active' OR performance_lifecycle_business_ended(TG_TABLE_NAME,to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: history cannot be physically deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'active' THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: records must start active' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME <> 'goal_change_requests' THEN
      SELECT status::text INTO employee_status FROM users WHERE id = NEW.employee_id FOR SHARE;
      IF employee_status NOT IN ('active','probation') THEN
        RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: employee employment has ended' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    IF TG_TABLE_NAME = 'assessment_tasks' AND NEW.lifecycle_status = 'terminated' AND EXISTS (
      SELECT 1 FROM grade_results WHERE task_id = OLD.id
        AND (approved_at IS NOT NULL OR employee_confirmed_at IS NOT NULL OR published_at IS NOT NULL OR is_published)
    ) THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: result facts cannot be terminated' USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle_status = 'terminated' AND performance_lifecycle_business_ended(TG_TABLE_NAME,to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: effective facts cannot be terminated' USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle_status = 'deleted' AND OLD.lifecycle_status = 'active'
       AND NOT performance_lifecycle_archive_ready(TG_TABLE_NAME,to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: unfinished record must first terminate' USING ERRCODE = '23514';
    END IF;
    IF OLD.lifecycle_status = 'deleted' OR NEW.lifecycle_status = 'active'
       OR NEW.lifecycle_version <> OLD.lifecycle_version + 1
       OR performance_lifecycle_payload(to_jsonb(NEW)) IS DISTINCT FROM performance_lifecycle_payload(to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_CONFLICT: invalid lifecycle transition' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: record is read-only' USING ERRCODE = '23514';
  END IF;
  IF NEW.lifecycle_status = OLD.lifecycle_status AND NEW.updated_at = OLD.updated_at
     AND performance_lifecycle_payload(to_jsonb(NEW)) IS DISTINCT FROM performance_lifecycle_payload(to_jsonb(OLD)) THEN
    NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 millisecond')::timestamptz(3);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "assessment_tasks_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_tasks" FOR EACH ROW EXECUTE FUNCTION performance_lifecycle_root_guard();
CREATE TRIGGER "goal_change_requests_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "goal_change_requests" FOR EACH ROW EXECUTE FUNCTION performance_lifecycle_root_guard();
CREATE TRIGGER "improvement_plans_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "improvement_plans" FOR EACH ROW EXECUTE FUNCTION performance_lifecycle_root_guard();
CREATE TRIGGER "confirmation_applications_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "confirmation_applications" FOR EACH ROW EXECUTE FUNCTION performance_lifecycle_root_guard();

CREATE FUNCTION performance_task_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  record_data jsonb;
  parent_task uuid;
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'goal_change_requests' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
         AND performance_lifecycle_payload(to_jsonb(NEW)) = performance_lifecycle_payload(to_jsonb(OLD)) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  FOR record_data IN
    SELECT value FROM jsonb_array_elements(
      CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
           WHEN TG_OP = 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
           ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END)
  LOOP
    parent_task := NULL;
    IF TG_ARGV[0] = 'task' THEN parent_task := (record_data->>'task_id')::uuid;
    ELSIF TG_ARGV[0] = 'period' THEN
      SELECT task_id INTO parent_task FROM assessment_periods WHERE id = (record_data->>'period_id')::uuid;
    ELSIF TG_ARGV[0] = 'version' THEN
      SELECT task_id INTO parent_task FROM indicator_versions WHERE id = (record_data->>'indicator_version_id')::uuid;
    ELSIF TG_ARGV[0] = 'instance' THEN
      SELECT task_id INTO parent_task FROM indicator_instances WHERE id = (record_data->>'indicator_instance_id')::uuid;
    ELSIF TG_ARGV[0] = 'alignment' THEN
      FOR parent_task IN SELECT DISTINCT task_id FROM indicator_instances
        WHERE id IN ((record_data->>'child_indicator_id')::uuid,(record_data->>'parent_indicator_id')::uuid) ORDER BY task_id
      LOOP
        SELECT lifecycle_status INTO parent_status FROM assessment_tasks WHERE id = parent_task FOR UPDATE;
        IF parent_status IS DISTINCT FROM 'active' THEN
          RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: aligned task is read-only' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      parent_task := NULL;
    END IF;
    IF parent_task IS NOT NULL THEN
      SELECT lifecycle_status INTO parent_status FROM assessment_tasks WHERE id = parent_task FOR UPDATE;
      IF parent_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: task is read-only' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "assessment_periods_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_periods" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "indicator_versions_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_versions" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "indicator_instances_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_instances" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "self_eval_summaries_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "self_eval_summaries" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "manager_eval_summaries_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "manager_eval_summaries" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "grade_results_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "grade_results" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "flow_records_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "flow_records" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "appeals_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "appeals" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "goal_change_requests_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "goal_change_requests" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "goal_change_grants_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "goal_change_grants" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "performance_interviews_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "performance_interviews" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('task');
CREATE TRIGGER "assessment_period_indicator_reviews_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_period_indicator_reviews" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('period');
CREATE TRIGGER "assessment_period_review_revisions_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_period_review_revisions" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('period');
CREATE TRIGGER "indicator_version_items_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_version_items" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('version');
CREATE TRIGGER "indicator_progress_updates_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_progress_updates" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('instance');
CREATE TRIGGER "indicator_visibility_departments_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_visibility_departments" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('instance');
CREATE TRIGGER "indicator_visibility_users_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_visibility_users" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('instance');
CREATE TRIGGER "indicator_visibility_rules_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_visibility_rules" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('instance');
CREATE TRIGGER "indicator_objective_alignments_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_objective_alignments" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('instance');
CREATE TRIGGER "indicator_instance_alignments_task_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "indicator_instance_alignments" FOR EACH ROW EXECUTE FUNCTION performance_task_write_guard('alignment');

CREATE FUNCTION performance_confirmation_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.application_id ELSE NEW.application_id END;
  SELECT lifecycle_status INTO parent_status FROM confirmation_applications WHERE id = parent_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: confirmation is read-only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER confirmation_attachment_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON confirmation_meeting_attachments
  FOR EACH ROW EXECUTE FUNCTION performance_confirmation_attachment_guard();

CREATE FUNCTION performance_notification_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF NEW.task_id IS NOT NULL THEN
    SELECT lifecycle_status INTO parent_status FROM assessment_tasks WHERE id = NEW.task_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: notification task ended' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.type LIKE 'confirmation_%' AND NEW.extra_data->>'applicationId' IS NOT NULL THEN
    SELECT lifecycle_status INTO parent_status FROM confirmation_applications WHERE id = (NEW.extra_data->>'applicationId')::uuid FOR UPDATE;
  ELSIF NEW.type = 'improvement_plan' AND NEW.extra_data->>'improvementPlanId' IS NOT NULL THEN
    SELECT lifecycle_status INTO parent_status FROM improvement_plans WHERE id = (NEW.extra_data->>'improvementPlanId')::uuid FOR UPDATE;
  ELSIF NEW.type = 'goal_change' AND NEW.extra_data->>'goalChangeId' IS NOT NULL THEN
    SELECT lifecycle_status INTO parent_status FROM goal_change_requests WHERE id = (NEW.extra_data->>'goalChangeId')::uuid FOR UPDATE;
  ELSE RETURN NEW;
  END IF;
  IF parent_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: notification record ended' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER performance_notification_lifecycle_guard BEFORE INSERT ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION performance_notification_insert_guard();

CREATE FUNCTION performance_signature_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_data jsonb; parent_status text;
BEGIN
  FOR record_data IN SELECT value FROM jsonb_array_elements(
    CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
         WHEN TG_OP = 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
         ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END)
  LOOP
    IF record_data->>'business_type' = 'assessment_task' THEN
      SELECT lifecycle_status INTO parent_status FROM assessment_tasks WHERE id = (record_data->>'business_record_id')::uuid FOR UPDATE;
      IF parent_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'PERFORMANCE_LIFECYCLE_ENDED: task signature is read-only' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER performance_signature_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON signatures
  FOR EACH ROW EXECUTE FUNCTION performance_signature_write_guard();
