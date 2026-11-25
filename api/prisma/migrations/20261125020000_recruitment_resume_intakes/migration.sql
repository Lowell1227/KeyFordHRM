CREATE TABLE recruitment_postings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 1,
 request_id uuid NOT NULL UNIQUE, creation_fingerprint varchar(64) NOT NULL,
 demand_id uuid NOT NULL REFERENCES recruitment_demands(id), channel varchar(80) NOT NULL,
 name varchar(200) NOT NULL, url varchar(2000) NOT NULL, external_id varchar(200),
 verified_identity boolean NOT NULL DEFAULT false, evidence varchar(2000), active boolean NOT NULL DEFAULT true,
 owner_id uuid NOT NULL REFERENCES users(id), created_by_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT recruitment_posting_verified CHECK (NOT verified_identity OR (evidence IS NOT NULL AND length(trim(evidence)) > 0)),
 CONSTRAINT recruitment_posting_revision CHECK (revision > 0)
);
CREATE INDEX recruitment_postings_demand_id_updated_at_idx ON recruitment_postings(demand_id,updated_at);
CREATE UNIQUE INDEX recruitment_posting_active_url ON recruitment_postings(channel,url) WHERE active AND verified_identity;
CREATE UNIQUE INDEX recruitment_posting_active_external_id ON recruitment_postings(channel,external_id) WHERE active AND verified_identity AND external_id IS NOT NULL;
CREATE TABLE recruitment_posting_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), posting_id uuid NOT NULL REFERENCES recruitment_postings(id),
 revision integer NOT NULL, action varchar(40) NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 reason varchar(2000), snapshot jsonb NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(posting_id,revision)
);
CREATE TABLE recruitment_intakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 1,
 state varchar(30) NOT NULL DEFAULT 'awaiting_resume', transport varchar(10) NOT NULL DEFAULT 'manual',
 request_id uuid UNIQUE, creation_fingerprint varchar(64), owner_id uuid NOT NULL REFERENCES users(id),
 created_by_id uuid NOT NULL REFERENCES users(id), source_channel varchar(20),
 posting_id uuid REFERENCES recruitment_postings(id), demand_id uuid REFERENCES recruitment_demands(id), posting_snapshot jsonb,
 position_name varchar(100), source_notes varchar(2000), next_follow_up_at timestamptz(6),
 candidate_draft jsonb, application_draft jsonb, parse_status varchar(16) NOT NULL DEFAULT 'idle', parse_token uuid,
 parse_deadline_at timestamptz(6), parse_result jsonb, parse_message varchar(200), issues varchar(80)[] NOT NULL DEFAULT '{}',
 mailbox_key varchar(200), message_id varchar(500), source_part_id varchar(220), received_at timestamptz(6),
 subject varchar(500), body_text text, associated_to_id uuid REFERENCES recruitment_intakes(id), close_reason varchar(2000),
 confirm_request_id uuid UNIQUE, confirm_fingerprint varchar(64), confirmed_by_id uuid REFERENCES users(id),
 candidate_id uuid REFERENCES talent_candidates(id), application_id uuid REFERENCES talent_applications(id),
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(mailbox_key,message_id,source_part_id),
 CONSTRAINT recruitment_intake_state CHECK(state IN ('awaiting_resume','pending_review','needs_material','completed','closed')),
 CONSTRAINT recruitment_intake_transport CHECK(transport IN ('manual','email')),
 CONSTRAINT recruitment_intake_parse CHECK(parse_status IN ('idle','processing','succeeded','failed')),
 CONSTRAINT recruitment_intake_revision CHECK(revision > 0),
 CONSTRAINT recruitment_intake_origin CHECK ((transport='manual' AND mailbox_key IS NULL AND message_id IS NULL AND source_part_id IS NULL)
  OR (transport='email' AND mailbox_key IS NOT NULL AND message_id IS NOT NULL AND source_part_id IS NOT NULL AND received_at IS NOT NULL)),
 CONSTRAINT recruitment_intake_completed CHECK(state<>'completed' OR (candidate_id IS NOT NULL AND confirm_request_id IS NOT NULL AND confirm_fingerprint IS NOT NULL AND confirmed_by_id IS NOT NULL)),
 CONSTRAINT recruitment_intake_closed CHECK(state<>'closed' OR (close_reason IS NOT NULL AND length(trim(close_reason))>0)),
 CONSTRAINT recruitment_intake_association CHECK(associated_to_id IS NULL OR (associated_to_id<>id AND state='closed'))
);
CREATE INDEX recruitment_intakes_state_updated_at_idx ON recruitment_intakes(state,updated_at);
CREATE INDEX recruitment_intakes_demand_id_updated_at_idx ON recruitment_intakes(demand_id,updated_at);
CREATE INDEX recruitment_intakes_associated_to_id_idx ON recruitment_intakes(associated_to_id);
CREATE TABLE recruitment_intake_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intake_id uuid NOT NULL REFERENCES recruitment_intakes(id),
 object_key varchar(500) NOT NULL UNIQUE, file_name varchar(255) NOT NULL, mime_type varchar(100) NOT NULL,
 file_size integer NOT NULL, fingerprint varchar(64) NOT NULL, uploaded_by_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(intake_id,fingerprint),
 CONSTRAINT recruitment_intake_private_file CHECK (object_key LIKE 'recruitment-intake/%' AND file_size>0 AND file_size<=10485760)
);
CREATE TABLE recruitment_intake_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intake_id uuid NOT NULL REFERENCES recruitment_intakes(id),
 revision integer NOT NULL, action varchar(40) NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 reason varchar(2000), metadata jsonb NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(intake_id,revision)
);
CREATE TABLE recruitment_mailbox_states (
 id varchar(20) PRIMARY KEY, mailbox_key varchar(200), authorized_from timestamptz(6), cursor varchar(1000),
 lease_token uuid, lease_until timestamptz(6), last_synced_at timestamptz(6)
);
CREATE FUNCTION protect_recruitment_source_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recruitment source events are immutable'; END $$;
CREATE TRIGGER recruitment_posting_events_immutable BEFORE UPDATE OR DELETE ON recruitment_posting_events FOR EACH ROW EXECUTE FUNCTION protect_recruitment_source_events();
CREATE TRIGGER recruitment_intake_events_immutable BEFORE UPDATE OR DELETE ON recruitment_intake_events FOR EACH ROW EXECUTE FUNCTION protect_recruitment_source_events();
CREATE FUNCTION protect_recruitment_intake_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.transport,NEW.mailbox_key,NEW.message_id,NEW.source_part_id,NEW.received_at,NEW.subject,NEW.body_text,NEW.request_id,NEW.creation_fingerprint,NEW.created_by_id)
  IS DISTINCT FROM ROW(OLD.transport,OLD.mailbox_key,OLD.message_id,OLD.source_part_id,OLD.received_at,OLD.subject,OLD.body_text,OLD.request_id,OLD.creation_fingerprint,OLD.created_by_id)
 THEN RAISE EXCEPTION 'Recruitment intake provenance is immutable'; END IF;
 IF OLD.state IN ('completed','closed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed recruitment intake is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recruitment_intake_origin_immutable BEFORE UPDATE ON recruitment_intakes FOR EACH ROW EXECUTE FUNCTION protect_recruitment_intake_origin();
