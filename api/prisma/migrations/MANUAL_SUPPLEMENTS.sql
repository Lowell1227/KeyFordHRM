-- =============================================================================
-- 手写 SQL 补充（评审决策 #2）
--
-- Prisma schema 无法表达以下数据库对象，需手动补进迁移：
--   - CHECK 约束（一票否决、weight 范围、周期日期）
--   - updated_at 自动更新触发器
--   - 部分索引 / gin_trgm 模糊搜索索引 / 函数索引
--
-- 状态：本文件内容已合并到 prisma/migrations/20260616000728_init/migration.sql。
--       新机器请直接执行 `npx prisma migrate deploy`，无需再单独运行本文件。
--       保留本文件仅作为评审决策 #2 的历史文档。
--
-- 注意：未补充原 DDL 的 chk_grade_ratio（四个等级上限之和=1.00）——
--       该约束语义错误（上限之和无需等于 100%），已在评审中移除。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK 约束
-- ---------------------------------------------------------------------------

-- 一票否决：is_veto=true 时 calibrated_grade 必须为 'D'
ALTER TABLE grade_results
  ADD CONSTRAINT chk_veto_grade
  CHECK (NOT (is_veto = true AND calibrated_grade IS DISTINCT FROM 'D'));

-- 维度权重范围 (0, 1]
ALTER TABLE template_dimensions
  ADD CONSTRAINT chk_dimension_weight CHECK (weight > 0 AND weight <= 1);

-- 考评表指标权重范围 (0, 1]
ALTER TABLE template_indicators
  ADD CONSTRAINT chk_ti_weight CHECK (weight > 0 AND weight <= 1);

-- 周期起止日期
ALTER TABLE assessment_cycles
  ADD CONSTRAINT chk_cycle_dates CHECK (end_date > start_date);

-- ---------------------------------------------------------------------------
-- 2. updated_at 自动更新触发器
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_indicators_updated_at
  BEFORE UPDATE ON indicators FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON assessment_templates FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON assessment_cycles FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON assessment_tasks FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_ii_updated_at
  BEFORE UPDATE ON indicator_instances FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_self_eval_updated_at
  BEFORE UPDATE ON self_eval_summaries FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_manager_eval_updated_at
  BEFORE UPDATE ON manager_eval_summaries FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_grade_results_updated_at
  BEFORE UPDATE ON grade_results FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
CREATE TRIGGER trg_appeals_updated_at
  BEFORE UPDATE ON appeals FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 部分索引 / 模糊搜索 / 函数索引（Prisma 无法表达）
-- ---------------------------------------------------------------------------

-- 用户软删除过滤的部分索引（覆盖 schema 中的普通索引，更高效）
CREATE INDEX idx_users_dept_active    ON users(dept_id)           WHERE deleted_at IS NULL;
CREATE INDEX idx_users_manager_active ON users(direct_manager_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status_active  ON users(status)            WHERE deleted_at IS NULL;

-- 姓名模糊搜索（pg_trgm）
CREATE INDEX idx_users_name_trgm ON users USING gin(name gin_trgm_ops);

-- 已公示等级分布查询
CREATE INDEX idx_gr_calibrated_grade ON grade_results(calibrated_grade) WHERE is_published = true;

-- 待发送通知
CREATE INDEX idx_notif_pending ON notification_logs(status) WHERE status = 'pending';

-- 催办频率限制（D19：每人每自然日最多 1 次）：sender_id + 中国日期(created_at)，type='task_reminder'
-- 注意：timestamptz::date 非 IMMUTABLE，无法直接用于函数索引；
--       此处用固定 Asia/Shanghai 时区的 IMMUTABLE 包装函数。
CREATE OR REPLACE FUNCTION fn_date_in_china(t timestamptz)
RETURNS date AS $$
  SELECT (t AT TIME ZONE 'Asia/Shanghai')::date;
$$ LANGUAGE sql IMMUTABLE;

CREATE INDEX idx_notif_sender_date
  ON notification_logs(sender_id, fn_date_in_china(created_at))
  WHERE type = 'task_reminder';
