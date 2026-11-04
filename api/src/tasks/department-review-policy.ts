/**
 * 部门复核节点跳过规则。
 *
 * 任务进入部门复核前，以下两种情形整体跳过该节点，直接进入绩效校准：
 * - 绩效直属上级即部门负责人（既有合并办理规则）；
 * - 被考核员工本人即部门负责人（禁止本人复核自己的绩效，系统自动跳过）。
 *
 * 判断只使用周期启动时冻结的任务快照字段，组织后续调整不影响已启动任务。
 */
export function shouldSkipDepartmentReview(task: {
  employeeId: string;
  managerId: string | null;
  deptHeadId: string | null;
}): boolean {
  return Boolean(
    task.deptHeadId &&
      (task.managerId === task.deptHeadId || task.employeeId === task.deptHeadId),
  );
}

/**
 * 是否因“被考核员工本人即部门负责人”而跳过部门复核。
 * 用于在流程记录中区分跳过原因（区别于“直属上级即部门负责人”的合并办理）。
 */
export function isSelfDepartmentReviewSkipped(task: {
  employeeId: string;
  managerId: string | null;
  deptHeadId: string | null;
}): boolean {
  return Boolean(
    task.deptHeadId &&
      task.employeeId === task.deptHeadId &&
      task.managerId !== task.deptHeadId,
  );
}
