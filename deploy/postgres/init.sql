-- 执行时机：PostgreSQL 首次初始化时自动运行
-- 此文件仅用于创建扩展，实际建表由 Prisma migrate 完成

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- 模糊搜索索引支持

-- 设置时区
SET timezone = 'Asia/Shanghai';
