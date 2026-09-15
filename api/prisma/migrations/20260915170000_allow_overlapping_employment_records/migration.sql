-- 任职记录是经 HR 二次确认的信息档案。时间重叠只提示，不阻断保存或审核。
ALTER TABLE "employment_records"
DROP CONSTRAINT IF EXISTS "employment_records_no_overlap_excl";
