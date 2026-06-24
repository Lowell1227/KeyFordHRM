-- =============================================================================
-- 迁移：B1 字段补丁批
--   - 指标库 / 模板指标 / 指标实例：增加数据来源、数据口径
--   - 主管评价总结：增加附件 JSONB 数组
-- =============================================================================

-- AddColumn indicators
ALTER TABLE "indicators" ADD COLUMN "data_source" TEXT;
ALTER TABLE "indicators" ADD COLUMN "data_caliber" TEXT;

-- AddColumn template_indicators
ALTER TABLE "template_indicators" ADD COLUMN "data_source" TEXT;
ALTER TABLE "template_indicators" ADD COLUMN "data_caliber" TEXT;

-- AddColumn indicator_instances
ALTER TABLE "indicator_instances" ADD COLUMN "data_source" TEXT;
ALTER TABLE "indicator_instances" ADD COLUMN "data_caliber" TEXT;

-- AddColumn manager_eval_summaries
ALTER TABLE "manager_eval_summaries" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
