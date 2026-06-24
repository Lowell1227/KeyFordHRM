-- =============================================================================
-- 迁移：三方在线签字（A3）
-- =============================================================================

-- CreateEnum
CREATE TYPE "signature_business_type" AS ENUM ('assessment_task', 'probation_task', 'interview');

-- CreateEnum
CREATE TYPE "signature_role" AS ENUM ('assessor', 'hr', 'assessee');

-- CreateEnum
CREATE TYPE "signature_method" AS ENUM ('online_confirm', 'handwritten_image');

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_type" "signature_business_type" NOT NULL,
    "business_record_id" UUID NOT NULL,
    "role" "signature_role" NOT NULL,
    "signer_id" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "signature_method" NOT NULL DEFAULT 'online_confirm',
    "idempotency_key" VARCHAR(64),
    "image_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signatures_business_type_business_record_id_role_key" ON "signatures"("business_type", "business_record_id", "role");

-- CreateIndex
CREATE INDEX "signatures_business_type_business_record_id_idx" ON "signatures"("business_type", "business_record_id");

-- CreateIndex
CREATE INDEX "signatures_signer_id_idx" ON "signatures"("signer_id");

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
