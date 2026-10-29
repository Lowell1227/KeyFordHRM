ALTER TYPE "task_status" ADD VALUE 'indicator_dept_reviewing';
ALTER TYPE "task_status" ADD VALUE 'indicator_approving';
ALTER TYPE "flow_node_type" ADD VALUE 'indicator_dept_review';
ALTER TYPE "flow_node_type" ADD VALUE 'indicator_approval';
ALTER TABLE "assessment_cycles" ADD COLUMN "goal_workflow_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "assessment_tasks" ADD COLUMN "goal_approved_at" TIMESTAMPTZ(6);
