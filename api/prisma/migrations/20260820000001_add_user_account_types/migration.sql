CREATE TYPE "account_type" AS ENUM ('employee', 'service', 'test');

ALTER TABLE "users"
ADD COLUMN "account_type" "account_type" NOT NULL DEFAULT 'employee';

UPDATE "users"
SET "account_type" = 'test'
WHERE "name" = '测试'
   OR "dept_id" IN (
     SELECT "id"
     FROM "departments"
     WHERE "name" LIKE '%测试组织%'
        OR COALESCE("full_path", '') LIKE '%测试组织%'
   );

CREATE INDEX "users_account_type_idx" ON "users"("account_type");
