-- 人才库（MVP，2026-11-08）
-- 四张独立表：候选人 / 简历文件 / 跟进记录 / 转发授权。
-- 候选人不是员工：不建指向 users 的外键，不产生工号，不触发绩效链路。
-- CHECK 约束与部分唯一索引为手写补充（Prisma schema 无法表达 partial unique）。

-- CreateTable
CREATE TABLE "talent_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(100),
    "gender" VARCHAR(10) NOT NULL DEFAULT 'unknown',
    "birth_year" INTEGER,
    "current_company" VARCHAR(150),
    "current_position" VARCHAR(100),
    "years_of_experience" INTEGER,
    "education" VARCHAR(20),
    "school" VARCHAR(200),
    "major" VARCHAR(150),
    "expect_city" VARCHAR(100),
    "expect_salary_min" INTEGER,
    "expect_salary_max" INTEGER,
    "source_channel" VARCHAR(20) NOT NULL,
    "applied_position" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "tags" VARCHAR(20)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(20)[],
    "note" TEXT,
    "last_follow_up_at" DATE,
    "converted_user_id" UUID,
    "converted_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "talent_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_talent_status" CHECK ("status" IN ('new','contacted','interviewing','hired','rejected','reserve')),
    CONSTRAINT "chk_talent_tags" CHECK (cardinality("tags") <= 5),
    CONSTRAINT "chk_talent_salary" CHECK ("expect_salary_min" IS NULL OR "expect_salary_max" IS NULL OR "expect_salary_min" <= "expect_salary_max")
);

-- 手机号唯一：仅软删范围内（deleted_at IS NULL）唯一，软删后可重录
CREATE UNIQUE INDEX "uq_talent_phone_active" ON "talent_candidates"("phone") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "talent_candidates_status_updated_at_idx" ON "talent_candidates"("status", "updated_at" DESC);
CREATE INDEX "talent_candidates_created_at_idx" ON "talent_candidates"("created_at" DESC);
CREATE INDEX "talent_candidates_expect_salary_min_idx" ON "talent_candidates"("expect_salary_min");
CREATE INDEX "talent_candidates_deleted_at_idx" ON "talent_candidates"("deleted_at");
CREATE UNIQUE INDEX "talent_candidates_converted_user_id_key" ON "talent_candidates"("converted_user_id");

-- updated_at 由数据库触发器维护（与全库一致）
CREATE TRIGGER "trg_talent_candidates_updated_at"
BEFORE UPDATE ON "talent_candidates"
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- CreateTable
CREATE TABLE "talent_resume_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "talent_resume_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "talent_resume_files_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "talent_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "talent_resume_files_candidate_id_sort_order_idx" ON "talent_resume_files"("candidate_id", "sort_order");

-- CreateTable
CREATE TABLE "talent_follow_ups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "occurred_at" DATE NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "summary" TEXT NOT NULL,
    "next_follow_up_at" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "talent_follow_ups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "talent_follow_ups_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "talent_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "talent_follow_ups_candidate_id_occurred_at_idx" ON "talent_follow_ups"("candidate_id", "occurred_at" DESC);

-- CreateTable
CREATE TABLE "talent_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "recipient_ids" UUID[] NOT NULL,
    "include_resume" BOOLEAN NOT NULL DEFAULT false,
    "message" VARCHAR(100),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMPTZ(6),
    "last_viewed_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "talent_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "talent_shares_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "talent_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_share_recipients" CHECK (cardinality("recipient_ids") BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "talent_shares_token_key" ON "talent_shares"("token");
CREATE INDEX "talent_shares_candidate_id_created_at_idx" ON "talent_shares"("candidate_id", "created_at" DESC);
