import { IsUUID, Matches } from 'class-validator';

export class PayrollAttendanceSyncListDto {
  @IsUUID() subjectId!: string;
  @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/) month!: string;
}
export class PayrollAttendanceSyncStartDto extends PayrollAttendanceSyncListDto {
  @IsUUID() requestId!: string;
}
export class PayrollAttendanceSyncRetryDto {
  @IsUUID() requestId!: string;
}

export type AttendanceSyncStatus = 'queued' | 'processing' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type AttendanceSyncIssue = { code: string; message: string; mappingKey?: string };
export type AttendanceSyncJob = {
  id: string; subjectId: string; month: string; domain: 'formal'; status: AttendanceSyncStatus;
  observationVersion: number; totalCells: number; completedCells: number; pendingCells: number; attempts: number;
  issues: AttendanceSyncIssue[]; createdAt: string; updatedAt: string; finishedAt: string | null;
  canCancel: boolean; canRetry: boolean;
};
