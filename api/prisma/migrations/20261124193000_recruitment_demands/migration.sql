CREATE TABLE "recruitment_demands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_key" VARCHAR(200) NOT NULL,
    "process_code" VARCHAR(200) NOT NULL,
    "instance_id" VARCHAR(200) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "source_state" VARCHAR(20) NOT NULL,
    "raw_department" TEXT,
    "raw_position" TEXT,
    "raw_headcount" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "source_created_at" TIMESTAMPTZ(6),
    "source_updated_at" TIMESTAMPTZ(6),
    "source_link" TEXT,
    "main_instance_id" VARCHAR(200),
    "biz_action" VARCHAR(50),
    "supersedes_instance_id" VARCHAR(200),
    "superseded_by_instance_id" VARCHAR(200),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "dept_id" UUID,
    "position_id" UUID,
    "approved_headcount" INTEGER,
    "mapped_fingerprint" CHAR(64),
    "sync_issue" VARCHAR(40),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recruitment_demands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recruitment_demands_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "recruitment_demands_headcount_check" CHECK ("approved_headcount" IS NULL OR "approved_headcount" > 0),
    CONSTRAINT "recruitment_demands_state_check" CHECK ("source_state" IN ('pending', 'approved', 'rejected', 'withdrawn', 'unknown'))
);

CREATE TABLE "recruitment_demand_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "demand_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recruitment_demand_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recruitment_demands_organization_key_instance_id_key" ON "recruitment_demands"("organization_key", "instance_id");
CREATE INDEX "recruitment_demands_source_state_updated_at_idx" ON "recruitment_demands"("source_state", "updated_at" DESC);
CREATE INDEX "recruitment_demands_organization_key_supersedes_instance_id_idx" ON "recruitment_demands"("organization_key", "supersedes_instance_id");
CREATE UNIQUE INDEX "recruitment_demand_events_demand_id_revision_key" ON "recruitment_demand_events"("demand_id", "revision");

ALTER TABLE "recruitment_demands" ADD CONSTRAINT "recruitment_demands_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruitment_demands" ADD CONSTRAINT "recruitment_demands_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruitment_demand_events" ADD CONSTRAINT "recruitment_demand_events_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "recruitment_demands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing applications remain unlinked; submitting again is an explicit new decision.
ALTER TABLE "talent_applications" ADD COLUMN "recruitment_demand_id" UUID,
    ADD COLUMN "recruitment_demand_revision" INTEGER,
    ADD COLUMN "recruitment_demand_snapshot" JSONB;
CREATE INDEX "talent_applications_recruitment_demand_id_idx" ON "talent_applications"("recruitment_demand_id");
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_recruitment_demand_id_fkey" FOREIGN KEY ("recruitment_demand_id") REFERENCES "recruitment_demands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION recruitment_demand_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Recruitment demand events are append-only';
END;
$$;
CREATE TRIGGER recruitment_demand_events_append_only BEFORE UPDATE OR DELETE ON "recruitment_demand_events"
    FOR EACH ROW EXECUTE FUNCTION recruitment_demand_events_append_only();

CREATE TABLE "recruitment_demand_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "organization_key" VARCHAR(200) NOT NULL,
    "process_code" VARCHAR(200) NOT NULL,
    "from" VARCHAR(40) NOT NULL,
    "to" VARCHAR(40) NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'listing',
    "list_sealed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "recruitment_demand_sync_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recruitment_demand_sync_runs_state_check" CHECK ("state" IN ('listing', 'listing_failed', 'ready', 'complete'))
);
CREATE UNIQUE INDEX "recruitment_demand_sync_runs_request_id_key" ON "recruitment_demand_sync_runs"("request_id");
CREATE INDEX "recruitment_demand_sync_runs_actor_id_created_at_idx" ON "recruitment_demand_sync_runs"("actor_id", "created_at" DESC);

CREATE TABLE "recruitment_demand_sync_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "instance_id" VARCHAR(200) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    CONSTRAINT "recruitment_demand_sync_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recruitment_demand_sync_items_state_check" CHECK ("state" IN ('pending', 'succeeded', 'failed')),
    CONSTRAINT "recruitment_demand_sync_items_progress_check" CHECK ("ordinal" >= 0 AND "attempts" >= 0)
);
CREATE UNIQUE INDEX "recruitment_demand_sync_items_run_id_instance_id_key" ON "recruitment_demand_sync_items"("run_id", "instance_id");
CREATE UNIQUE INDEX "recruitment_demand_sync_items_run_id_ordinal_key" ON "recruitment_demand_sync_items"("run_id", "ordinal");
CREATE INDEX "recruitment_demand_sync_items_run_id_state_ordinal_idx" ON "recruitment_demand_sync_items"("run_id", "state", "ordinal");
ALTER TABLE "recruitment_demand_sync_items" ADD CONSTRAINT "recruitment_demand_sync_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "recruitment_demand_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION recruitment_demand_sync_intent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.id, NEW.request_id, NEW.actor_id, NEW.organization_key, NEW.process_code, NEW."from", NEW."to")
       IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.actor_id, OLD.organization_key, OLD.process_code, OLD."from", OLD."to")
       OR (OLD.list_sealed_at IS NOT NULL AND NEW.list_sealed_at IS DISTINCT FROM OLD.list_sealed_at) THEN
        RAISE EXCEPTION 'Recruitment demand sync intent is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER recruitment_demand_sync_intent_immutable BEFORE UPDATE ON "recruitment_demand_sync_runs"
    FOR EACH ROW EXECUTE FUNCTION recruitment_demand_sync_intent_immutable();

CREATE FUNCTION recruitment_demand_sync_manifest_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Recruitment demand sync manifest is immutable';
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.run_id, NEW.instance_id, NEW.ordinal) IS DISTINCT FROM (OLD.id, OLD.run_id, OLD.instance_id, OLD.ordinal) THEN
            RAISE EXCEPTION 'Recruitment demand sync manifest is immutable';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM recruitment_demand_sync_runs WHERE id = NEW.run_id AND list_sealed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Recruitment demand sync manifest is sealed';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER recruitment_demand_sync_manifest_immutable BEFORE INSERT OR UPDATE OR DELETE ON "recruitment_demand_sync_items"
    FOR EACH ROW EXECUTE FUNCTION recruitment_demand_sync_manifest_immutable();
