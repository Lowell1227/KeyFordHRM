import { FlowNodeType, Prisma } from '@prisma/client';

export const REVIEW_HISTORY_NODES: FlowNodeType[] = ['manager_score', 'dept_review', 'hr_calibration', 'approval', 'employee_confirm', 'appeal', 'publish'];

type ReviewRecord = {
  id: string; nodeType: string; action: string; comment: string | null;
  extraData: Prisma.JsonValue; createdAt: Date; actor: { name: string } | null;
};

/** Keep recorded opinions and attribution; do not expose unrelated workflow payloads. */
export function mapReviewHistory(records: ReviewRecord[] = []) {
  return records.map(record => {
    const data = record.extraData;
    const extraData = data && typeof data === 'object' && !Array.isArray(data)
      ? data.type === 'final_grade_submitted'
        ? { type: data.type, comment: typeof data.comment === 'string' ? data.comment : null }
        : data.type === 'combined_department_review' ? { type: data.type }
          : data.type === 'manager_period_review_returned'
            ? { type: data.type, periodKey: typeof data.periodKey === 'string' ? data.periodKey : null } : null
      : null;
    return { id: record.id, nodeType: record.nodeType, action: record.action,
      actorName: record.actor?.name ?? null, comment: record.comment, extraData, createdAt: record.createdAt };
  });
}
