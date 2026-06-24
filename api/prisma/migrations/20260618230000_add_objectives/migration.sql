-- CreateEnum
CREATE TYPE "objective_level" AS ENUM ('company', 'department', 'individual');

-- CreateEnum
CREATE TYPE "objective_status" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "objectives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "level" "objective_level" NOT NULL,
    "dept_id" UUID,
    "owner_id" UUID,
    "parent_id" UUID,
    "cycle_id" UUID,
    "weight" DECIMAL(5,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "status" "objective_status" NOT NULL DEFAULT 'active',
    "related_indicator_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "objectives_level_idx" ON "objectives"("level");

-- CreateIndex
CREATE INDEX "objectives_dept_id_idx" ON "objectives"("dept_id");

-- CreateIndex
CREATE INDEX "objectives_owner_id_idx" ON "objectives"("owner_id");

-- CreateIndex
CREATE INDEX "objectives_parent_id_idx" ON "objectives"("parent_id");

-- CreateIndex
CREATE INDEX "objectives_cycle_id_idx" ON "objectives"("cycle_id");

-- CreateIndex
CREATE INDEX "objectives_status_idx" ON "objectives"("status");

-- CreateIndex
CREATE INDEX "objectives_related_indicator_id_idx" ON "objectives"("related_indicator_id");

-- CreateIndex
CREATE INDEX "objectives_created_by_idx" ON "objectives"("created_by");

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "assessment_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_related_indicator_id_fkey" FOREIGN KEY ("related_indicator_id") REFERENCES "indicators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 手动补充：updated_at 触发器（与项目其他表保持一致）
CREATE OR REPLACE TRIGGER "trg_objectives_updated_at"
BEFORE UPDATE ON "objectives"
FOR EACH ROW
EXECUTE FUNCTION "fn_update_updated_at"();
