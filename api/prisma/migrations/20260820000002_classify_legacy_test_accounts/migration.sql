UPDATE "users"
SET "account_type" = 'test'
WHERE "account_type" = 'employee'
  AND "name" LIKE '测试·%';
