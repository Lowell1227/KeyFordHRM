-- CreateEnum
CREATE TYPE "action_item_status" AS ENUM ('todo', 'in_progress', 'done', 'blocked');

-- CreateTable
CREATE TABLE "action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "objective_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "assignee_id" UUID,
    "start_date" DATE,
    "due_date" DATE,
    "status" "action_item_status" NOT NULL DEFAULT 'todo',
    "parent_id" UUID,
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_items_objective_id_idx" ON "action_items"("objective_id");

-- CreateIndex
CREATE INDEX "action_items_assignee_id_idx" ON "action_items"("assignee_id");

-- CreateIndex
CREATE INDEX "action_items_parent_id_idx" ON "action_items"("parent_id");

-- CreateIndex
CREATE INDEX "action_items_status_idx" ON "action_items"("status");

-- CreateIndex
CREATE INDEX "action_items_created_by_idx" ON "action_items"("created_by");

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "action_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 手动补充：updated_at 触发器（与项目其他表保持一致）
CREATE OR REPLACE TRIGGER "trg_action_items_updated_at"
BEFORE UPDATE ON "action_items"
FOR EACH ROW
EXECUTE FUNCTION "fn_update_updated_at"();
