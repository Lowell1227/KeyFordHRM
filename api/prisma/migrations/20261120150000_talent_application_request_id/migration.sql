ALTER TABLE "talent_applications"
  ADD COLUMN "request_id" UUID,
  ADD COLUMN "creation_fingerprint" CHAR(64);

CREATE UNIQUE INDEX "talent_applications_request_id_key" ON "talent_applications"("request_id");
