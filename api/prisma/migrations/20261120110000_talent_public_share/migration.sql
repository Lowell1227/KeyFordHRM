-- Existing restricted shares must never become anonymous, including empty recipient lists.
ALTER TABLE "talent_shares" ADD COLUMN "is_public_link" BOOLEAN NOT NULL DEFAULT false;
