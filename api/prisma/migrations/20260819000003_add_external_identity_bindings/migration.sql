CREATE TYPE "external_identity_provider" AS ENUM ('dingtalk');
CREATE TYPE "external_identity_status" AS ENUM ('enabled', 'disabled');

CREATE TABLE "external_identity_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "external_identity_provider" NOT NULL DEFAULT 'dingtalk',
    "user_id" UUID NOT NULL,
    "external_user_id" VARCHAR(128),
    "external_union_id" VARCHAR(128) NOT NULL,
    "status" "external_identity_status" NOT NULL DEFAULT 'enabled',
    "bound_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bound_by_id" UUID,
    "disabled_at" TIMESTAMPTZ(6),
    "disabled_by_id" UUID,
    "disabled_reason" TEXT,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,
    "ended_reason" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identity_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_identity_bindings_user_id_provider_idx"
ON "external_identity_bindings"("user_id", "provider");
CREATE INDEX "external_identity_bindings_provider_external_union_id_idx"
ON "external_identity_bindings"("provider", "external_union_id");
CREATE UNIQUE INDEX "external_identity_bindings_current_user_provider_key"
ON "external_identity_bindings"("user_id", "provider") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "external_identity_bindings_current_union_provider_key"
ON "external_identity_bindings"("provider", "external_union_id") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "external_identity_bindings_current_userid_provider_key"
ON "external_identity_bindings"("provider", "external_user_id")
WHERE "ended_at" IS NULL AND "external_user_id" IS NOT NULL;

ALTER TABLE "external_identity_bindings" ADD CONSTRAINT "external_identity_bindings_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_identity_bindings" ADD CONSTRAINT "external_identity_bindings_bound_by_id_fkey"
FOREIGN KEY ("bound_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_identity_bindings" ADD CONSTRAINT "external_identity_bindings_disabled_by_id_fkey"
FOREIGN KEY ("disabled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_identity_bindings" ADD CONSTRAINT "external_identity_bindings_ended_by_id_fkey"
FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "external_identity_bindings" (
    "user_id", "external_user_id", "external_union_id", "status", "bound_at", "disabled_at", "disabled_reason"
)
SELECT
    "id",
    "dingtalk_id",
    "dingtalk_union_id",
    CASE WHEN "status" = 'resigned' THEN 'disabled'::"external_identity_status" ELSE 'enabled'::"external_identity_status" END,
    "created_at",
    CASE WHEN "status" = 'resigned' THEN CURRENT_TIMESTAMP ELSE NULL END,
    CASE WHEN "status" = 'resigned' THEN '历史离职状态迁移' ELSE NULL END
FROM "users"
WHERE "dingtalk_union_id" IS NOT NULL;
