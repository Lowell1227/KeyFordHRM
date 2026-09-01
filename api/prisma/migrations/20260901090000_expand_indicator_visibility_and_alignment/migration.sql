CREATE TABLE "indicator_visibility_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "indicator_instance_id" UUID NOT NULL,
  "scope" "indicator_visibility_scope" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "indicator_visibility_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "indicator_instance_alignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "child_indicator_id" UUID NOT NULL,
  "parent_indicator_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "indicator_instance_alignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "indicator_instance_alignments_no_self_link" CHECK ("child_indicator_id" <> "parent_indicator_id")
);

CREATE UNIQUE INDEX "indicator_visibility_rules_indicator_instance_id_scope_key"
  ON "indicator_visibility_rules"("indicator_instance_id", "scope");

CREATE INDEX "indicator_visibility_rules_scope_indicator_instance_id_idx"
  ON "indicator_visibility_rules"("scope", "indicator_instance_id");

CREATE UNIQUE INDEX "indicator_instance_alignments_child_indicator_id_parent_indicator_id_key"
  ON "indicator_instance_alignments"("child_indicator_id", "parent_indicator_id");

CREATE INDEX "indicator_instance_alignments_parent_indicator_id_idx"
  ON "indicator_instance_alignments"("parent_indicator_id");

ALTER TABLE "indicator_visibility_rules"
  ADD CONSTRAINT "indicator_visibility_rules_indicator_instance_id_fkey"
  FOREIGN KEY ("indicator_instance_id") REFERENCES "indicator_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_instance_alignments"
  ADD CONSTRAINT "indicator_instance_alignments_child_indicator_id_fkey"
  FOREIGN KEY ("child_indicator_id") REFERENCES "indicator_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "indicator_instance_alignments"
  ADD CONSTRAINT "indicator_instance_alignments_parent_indicator_id_fkey"
  FOREIGN KEY ("parent_indicator_id") REFERENCES "indicator_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "indicator_visibility_rules" ("indicator_instance_id", "scope")
SELECT "id", "visibility_scope"
FROM "indicator_instances"
ON CONFLICT ("indicator_instance_id", "scope") DO NOTHING;
