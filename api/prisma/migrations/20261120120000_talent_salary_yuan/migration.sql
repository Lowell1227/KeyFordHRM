-- Preserve historical raw K amounts. Only explicit salary edits change their unit.
ALTER TABLE "talent_candidates"
  ADD COLUMN "expect_salary_unit" VARCHAR(12) NOT NULL DEFAULT 'legacy_k',
  ADD CONSTRAINT "talent_candidates_expect_salary_unit_check"
    CHECK ("expect_salary_unit" IN ('legacy_k', 'yuan'));
