import type { Paginated } from '@/common/dto/pagination.dto';
import type { OperationItem } from './operations.dto';

export interface OperationRows { visible: boolean; actionable: OperationItem[]; attention: OperationItem[] }

export const operationPath = (path: string, query: Record<string, string>) => `${path}?${new URLSearchParams(query)}`;

// Original paginated readers may need filtering; never use the first sample as a total.
export async function allOperationPages<T>(read: (page: number, pageSize: number) => Promise<Pick<Paginated<T>, 'items' | 'total'>>): Promise<T[]> {
  const rows: T[] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const result = await read(page, 100);
    if (!Number.isSafeInteger(result.total) || result.total < 0 || total !== undefined && result.total !== total) {
      throw new Error('Pending list changed; retry');
    }
    total = result.total;
    rows.push(...result.items);
    if (rows.length >= total) return rows;
    if (!result.items.length) throw new Error('Incomplete pending list');
  }
}

export function currentPayrollStep(row: { status: string; submittedById: string | null; approvalPath: string[];
  approvalStep: number; reviewerCount: number }, actorId: string, capabilities: readonly string[]): boolean {
  return row.status === 'pending' && !!row.submittedById && row.submittedById !== actorId
    && Number.isInteger(row.approvalStep) && row.approvalStep >= 0 && row.approvalStep < row.approvalPath.length
    && row.reviewerCount >= 1 && row.reviewerCount < row.approvalPath.length
    && new Set(row.approvalPath).size === row.approvalPath.length && !row.approvalPath.includes(row.submittedById)
    && row.approvalPath[row.approvalStep] === actorId
    && capabilities.includes(row.approvalStep < row.reviewerCount ? 'payroll_review' : 'payroll_approve');
}
