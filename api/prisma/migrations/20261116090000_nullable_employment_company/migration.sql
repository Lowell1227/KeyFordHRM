-- Company directory references no longer require a legacy organization code.
-- Existing codes and all company/name snapshots remain unchanged.
ALTER TABLE "employment_records" ALTER COLUMN "company" DROP NOT NULL;
