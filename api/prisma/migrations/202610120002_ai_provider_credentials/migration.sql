CREATE TABLE "ai_provider_credentials" (
    "provider" VARCHAR(20) NOT NULL,
    "encrypted_key" BYTEA NOT NULL,
    "model_id" VARCHAR(128) NOT NULL,
    "region" VARCHAR(32),
    "workspace_id" VARCHAR(63),
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "tested_version" INTEGER,
    "tested_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("provider"),
    CONSTRAINT "ai_provider_credentials_provider_check" CHECK ("provider" IN ('kimi', 'deepseek', 'qwen')),
    CONSTRAINT "ai_provider_credentials_version_check" CHECK ("config_version" > 0 AND ("tested_version" IS NULL OR "tested_version" = "config_version"))
);
