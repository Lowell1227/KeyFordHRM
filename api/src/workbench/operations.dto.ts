import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class OperationsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(20) pageSize = 5;
}

export interface OperationItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  nextAction: string;
  path: string;
  dueAt: string | null;
  subjectId?: string;
  month?: string;
  requestId?: string;
  batchId?: string;
  cycleId?: string;
  taskId?: string;
  recordCount?: number;
}

export interface OperationPage {
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: OperationItem[];
}

export interface OperationGroup {
  visible: boolean;
  status: 'ready' | 'error';
  actionable: OperationPage;
  attention: OperationPage;
  counts: Record<string, { actionable: number; attention: number }> | null;
  error?: { code: string; message: string };
}

export interface OperationsSummary {
  generatedAt: string;
  groups: { personnel: OperationGroup; payroll: OperationGroup; performance: OperationGroup };
}
