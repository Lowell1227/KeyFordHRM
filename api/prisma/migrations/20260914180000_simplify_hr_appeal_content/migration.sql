UPDATE "hr_appeal_records"
SET "content" = "subject" || E'\n' || "content"
WHERE "subject" <> '' AND POSITION("subject" IN "content") = 0;

ALTER TABLE "hr_appeal_records" DROP COLUMN "subject";
