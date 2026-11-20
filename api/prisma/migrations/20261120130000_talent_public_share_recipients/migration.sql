-- Keep legacy shares restricted while allowing explicitly public links without recipients.
ALTER TABLE "talent_shares" DROP CONSTRAINT "chk_share_recipients";
ALTER TABLE "talent_shares" ADD CONSTRAINT "chk_share_recipients" CHECK (
  ("is_public_link" AND cardinality("recipient_ids") = 0)
  OR (NOT "is_public_link" AND cardinality("recipient_ids") BETWEEN 1 AND 5)
);
