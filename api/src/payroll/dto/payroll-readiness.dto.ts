import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import type { PayrollNetSnapshot } from '../payroll-net';
import { ConflictException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import { payrollHash } from '../payroll-transaction';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class PayrollReadinessQueryDto { @IsUUID() subjectId!: string; }
export class PayrollReadinessSubmitDto {
  @IsUUID() batchId!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
  @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/) firstMonth!: string;
  @Transform(trim) @IsString() @Length(1, 200) reference!: string;
  @IsUUID() requestId!: string;
}
export class PayrollReadinessDecisionDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
  @IsIn(['approve', 'return']) decision!: 'approve' | 'return';
  @Transform(trim) @IsString() @MaxLength(500) note!: string;
}
export class PayrollReadinessNoteDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
  @Transform(trim) @IsString() @Length(1, 500) note!: string;
}

export type PayrollReadinessStatus = 'pending' | 'returned' | 'withdrawn' | 'approved' | 'revoked';
export interface PayrollReadinessDecision {
  step: number;
  actorId: string;
  decision: 'approve' | 'return';
  note: string;
  decidedAt: string;
}
export interface PayrollReadinessRow {
  id: string;
  subjectId: string;
  batchId: string;
  versionId: string;
  calculationVersion: number;
  version: number;
  month: string;
  firstMonth: string;
  sourceHash: string;
  netHash: string;
  reference: string;
  status: PayrollReadinessStatus;
  approvalStep: number;
  approvalPath: string[];
  reviewerCount: number;
  submittedById: string;
  submittedAt: string;
  approvedAt: string | null;
  closedAt: string | null;
  closedById: string | null;
  closeNote: string | null;
  decisions: PayrollReadinessDecision[];
}
export interface PayrollReadinessLine {
  id: string;
  employeeId: string;
  attributionMonth: string;
  itemCode: string;
  status: string;
  entitlement: string | null;
  paidBefore: string | null;
  amount: string | null;
  evidence: unknown;
}
export interface PayrollReadinessDetail {
  request: PayrollReadinessRow;
  netSnapshot: PayrollNetSnapshot;
  lines: PayrollReadinessLine[];
  actors: Array<{ id: string; name: string }>;
  canDecide: boolean;
  canWithdraw: boolean;
  canRevoke: boolean;
}

export interface PayrollReadinessRecord extends PayrollReadinessRow {
  schema: 1;
  batchVersion: number;
  requestHash: string;
}

export function payrollReadinessRequestHash(value: Pick<PayrollReadinessRecord,
  'id' | 'batchId' | 'batchVersion' | 'firstMonth' | 'reference' | 'submittedById'>): string {
  return payrollHash({ batchId: value.batchId, expectedVersion: value.batchVersion, firstMonth: value.firstMonth,
    reference: value.reference, requestId: value.id, actorId: value.submittedById });
}

export function parsePayrollReadinessRecord(raw: unknown, id: string): PayrollReadinessRecord {
  const fail = (): never => { throw new ConflictException('首月签收记录不完整或已变化，请核对后重新提交'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const r = raw as PayrollReadinessRecord;
  const keys = ['schema', 'id', 'subjectId', 'batchId', 'versionId', 'calculationVersion', 'version', 'batchVersion', 'month', 'firstMonth',
    'sourceHash', 'netHash', 'reference', 'status', 'approvalStep', 'approvalPath', 'reviewerCount', 'submittedById', 'submittedAt',
    'approvedAt', 'closedAt', 'closedById', 'closeNote', 'decisions', 'requestHash'];
  const iso = (value: unknown): value is string => typeof value === 'string' && isISO8601(value, { strict: true, strictSeparator: true })
    && Number.isFinite(Date.parse(value));
  const month = (value: unknown): value is string => typeof value === 'string' && /^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
  const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= max;
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(key => !keys.includes(key)) || r.schema !== 1 || r.id !== id
    || [r.id, r.subjectId, r.batchId, r.versionId, r.submittedById].some(value => typeof value !== 'string' || !isUUID(value))
    || !Number.isSafeInteger(r.version) || r.version < 1 || !Number.isSafeInteger(r.batchVersion) || r.batchVersion < 0
    || !Number.isSafeInteger(r.calculationVersion) || r.calculationVersion < 1 || !month(r.month) || !month(r.firstMonth) || r.firstMonth < r.month
    || [r.sourceHash, r.netHash, r.requestHash].some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    || !text(r.reference, 200) || !iso(r.submittedAt) || !['pending', 'returned', 'withdrawn', 'approved', 'revoked'].includes(r.status)
    || !Array.isArray(r.approvalPath) || r.approvalPath.length > 20 || r.approvalPath.some(value => typeof value !== 'string' || !isUUID(value))
    || new Set(r.approvalPath).size !== r.approvalPath.length || r.approvalPath.includes(r.submittedById)
    || !Number.isInteger(r.reviewerCount) || r.reviewerCount < 1 || r.reviewerCount >= r.approvalPath.length
    || !Number.isInteger(r.approvalStep) || r.approvalStep < 0 || r.approvalStep > r.approvalPath.length
    || !Array.isArray(r.decisions) || r.decisions.length > r.approvalPath.length
    || r.requestHash !== payrollReadinessRequestHash(r)) fail();
  for (const [index, d] of r.decisions.entries()) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length !== 5
      || Object.keys(d).some(key => !['step', 'actorId', 'decision', 'note', 'decidedAt'].includes(key))
      || d.step !== index || d.actorId !== r.approvalPath[index] || !['approve', 'return'].includes(d.decision)
      || d.decision === 'return' && (r.status !== 'returned' || index !== r.decisions.length - 1)
      || typeof d.note !== 'string' || d.note !== d.note.trim() || d.note.length > 500 || d.decision === 'return' && !d.note
      || !iso(d.decidedAt) || Date.parse(d.decidedAt) < Date.parse(index ? r.decisions[index - 1].decidedAt : r.submittedAt)) fail();
  }
  const signed = r.status === 'approved' || r.status === 'revoked';
  if (signed ? r.approvalStep !== r.approvalPath.length || r.decisions.length !== r.approvalPath.length
      || !iso(r.approvedAt) || r.approvedAt !== r.decisions.at(-1)?.decidedAt
    : r.approvalStep >= r.approvalPath.length || r.approvedAt !== null) fail();
  if (r.decisions.length !== r.approvalStep + (r.status === 'returned' ? 1 : 0)
    || r.version !== 1 + r.decisions.length + (r.status === 'withdrawn' || r.status === 'revoked' ? 1 : 0)) fail();
  const closed = ['returned', 'withdrawn', 'revoked'].includes(r.status);
  if (closed ? !iso(r.closedAt) || !text(r.closeNote, 500)
      || r.closedById !== (r.status === 'returned' ? r.approvalPath[r.approvalStep]
        : r.status === 'withdrawn' ? r.submittedById : r.approvalPath.at(-1))
    : r.closedAt !== null || r.closedById !== null || r.closeNote !== null) fail();
  return r;
}
