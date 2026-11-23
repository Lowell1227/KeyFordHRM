import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  DingtalkAttendanceRead,
  DingtalkAttendancePending,
  DingtalkAttendanceDay,
  DingtalkAttendanceApproval,
} from "../dingtalk/dingtalk-attendance.service";
import {
  normalizeAttendance,
  PayrollAttendanceInput,
  PayrollAttendanceRecord,
  PayrollAttendanceType,
  PayrollOvertimeKind,
} from "./payroll-attendance-normalizer";

export interface PayrollDingtalkAttendanceSourceProof {
  kind: "derived-normal" | "approval" | "punch" | "superseded-normal";
  identityHash: string;
  evidenceHash: string;
  terminalHash?: string;
  previousFingerprint?: string;
}
export interface PayrollDingtalkAttendanceSourceState {
  sourceId: string;
  sourceVersion: number;
  fingerprint: string;
  record: PayrollAttendanceRecord;
  /** Persist alongside record; hashes only, never external identity or raw workflow payloads. */
  proof?: PayrollDingtalkAttendanceSourceProof;
}
export interface PayrollDingtalkAttendanceOptions {
  expected: PayrollAttendanceInput["expected"];
  /** Persistently allocated BEFORE the upstream read; serialize publication with the saved sourceState. */
  observationVersion: number;
  previous: PayrollDingtalkAttendanceSourceState[];
  approvalMappings: Record<
    string,
    {
      type:
        | "paid_leave"
        | "unpaid_leave"
        | "sick_leave"
        | "business_trip"
        | "outing"
        | "makeup"
        | "overtime";
      overtimeKind?: PayrollOvertimeKind;
    }
  >;
}
export interface PayrollDingtalkAttendanceConversion {
  status: "ready" | "pending";
  complete: boolean;
  sourceKey: string;
  input: PayrollAttendanceInput;
  scope: DingtalkAttendanceRead["scope"];
  pending: DingtalkAttendancePending[];
  sourceState: PayrollDingtalkAttendanceSourceState[];
}
export const PAYROLL_DINGTALK_ATTENDANCE_PENDING_LABELS: Readonly<
  Record<string, string>
> = Object.freeze({
  APPROVAL_CHAIN_UNPROVEN:
    "\u5173\u8054\u4e3b\u6d41\u7a0b\u7ec8\u5ba1\u5f85\u6838",
  APPROVAL_DAILY_ALLOCATION_UNPROVEN:
    "\u5ba1\u6279\u8de8\u65e5\u5de5\u65f6\u5206\u914d\u5f85\u6838",
  APPROVAL_DUPLICATE: "\u5ba1\u6279\u6765\u6e90\u91cd\u590d",
  APPROVAL_DURATION_UNPROVEN:
    "\u5ba1\u6279\u65f6\u957f\u4e0e\u65f6\u6bb5\u4e0d\u4e00\u81f4",
  APPROVAL_INTERVAL_UNPROVEN:
    "\u5ba1\u6279\u65f6\u6bb5\u6216\u65f6\u957f\u672a\u83b7\u8bc1\u5b9e",
  APPROVAL_LINK_UNPROVEN:
    "\u6392\u73ed\u4e0e\u5ba1\u6279\u5173\u8054\u5f85\u6838",
  APPROVAL_LIST_INVALID: "\u5ba1\u6279\u5217\u8868\u683c\u5f0f\u5f02\u5e38",
  APPROVAL_NOT_FINAL: "\u5ba1\u6279\u5c1a\u672a\u7ec8\u5ba1\u901a\u8fc7",
  APPROVAL_PERSON_MISMATCH:
    "\u5ba1\u6279\u4eba\u5458\u5173\u8054\u4e0d\u4e00\u81f4",
  APPROVAL_REVOKED:
    "\u5ba1\u6279\u5df2\u64a4\u9500\uff0c\u5de5\u8d44\u5f71\u54cd\u5f85\u6838",
  APPROVAL_TERMINAL_STATE_UNPROVEN:
    "\u5ba1\u6279\u7ec8\u5ba1\u7ed3\u679c\u672a\u83b7\u8bc1\u5b9e",
  APPROVAL_TYPE_UNMAPPED: "\u5047\u52e4\u7c7b\u578b\u5c1a\u672a\u6838\u5b9a",
  APPROVAL_MAPPING_KEY_UNSUPPORTED:
    "\u5047\u52e4\u7c7b\u522b\u952e\u8d85\u51fa\u957f\u5ea6\u6216\u5b89\u5168\u683c\u5f0f\uff0c\u8bf7\u6838\u5bf9\u6765\u6e90",
  CALENDAR_OR_RESTS_UNPROVEN:
    "\u65e5\u5386\u6216\u4f11\u606f\u65f6\u6bb5\u5f85\u6838",
  DAILY_PLANS_INVALID: "\u5f53\u65e5\u5e94\u6253\u5361\u4fe1\u606f\u5f02\u5e38",
  DAY_CONVERSION_REQUIRED:
    "\u5929\u6570\u6362\u5c0f\u65f6\u7684\u4f9d\u636e\u5f85\u6838",
  DAY_COVERAGE_INCOMPLETE:
    "\u8be5\u4eba\u5458\u5f53\u65e5\u53d6\u6570\u5c1a\u672a\u5b8c\u6574",
  DAY_COVERAGE_MISSING:
    "\u7f3a\u5c11\u8be5\u4eba\u5458\u5f53\u65e5\u53d6\u6570",
  DEADLINE_EXCEEDED: "\u9489\u9489\u8bfb\u53d6\u8d85\u65f6",
  EXPECTED_CONFLICT: "\u5e94\u51fa\u52e4\u4f9d\u636e\u51b2\u7a81",
  HOUR_PRECISION_UNPROVEN: "\u5c0f\u65f6\u6362\u7b97\u7cbe\u5ea6\u5f85\u6838",
  HOURS_EXCEED_INTERVAL:
    "\u6765\u6e90\u65f6\u957f\u8d85\u8fc7\u5bf9\u5e94\u65f6\u6bb5",
  HRM_EXPECTATION_INVALID:
    "\u6838\u5b9a\u5e94\u51fa\u52e4\u8303\u56f4\u65e0\u6548",
  HRM_EXPECTATION_MISSING:
    "\u7f3a\u5c11\u6838\u5b9a\u5e94\u51fa\u52e4\u65e5\u671f",
  INTERVAL_CONFLICT: "\u5047\u52e4\u65f6\u6bb5\u91cd\u53e0\u5f85\u6838",
  INVALID_EMPLOYEE_ID: "HRM\u4eba\u5458\u6807\u8bc6\u65e0\u6548",
  INVALID_EXPECTED_UNITS: "\u5e94\u51fa\u52e4\u5355\u4f4d\u65e0\u6548",
  INVALID_HOURS: "\u6765\u6e90\u65f6\u957f\u65e0\u6548",
  INVALID_INTERVAL: "\u6765\u6e90\u65f6\u6bb5\u65e0\u6548",
  INVALID_RECORD_STATE: "\u6765\u6e90\u751f\u6548\u72b6\u6001\u65e0\u6548",
  INVALID_RECORD_TYPE: "\u5047\u52e4\u7c7b\u578b\u65e0\u6548",
  INVALID_REQUIREMENT: "\u662f\u5426\u9700\u8981\u8003\u52e4\u672a\u660e\u786e",
  INVALID_SOURCE_ID: "\u6765\u6e90\u6807\u8bc6\u65e0\u6548",
  INVALID_SOURCE_VERSION: "\u6765\u6e90\u7248\u672c\u65e0\u6548",
  INVALID_WORK_DATE: "\u5de5\u4f5c\u65e5\u65e0\u6548",
  MISSING_PUNCH:
    "\u7f3a\u5361\u5c1a\u672a\u88ab\u6709\u6548\u5047\u52e4\u8986\u76d6",
  MISSING_RECORD:
    "\u5e94\u51fa\u52e4\u65e5\u7f3a\u5c11\u6765\u6e90\u8bb0\u5f55",
  MISSING_REGULAR_COVERAGE:
    "\u4ec5\u6709\u52a0\u73ed\uff0c\u7f3a\u5c11\u6b63\u5e38\u51fa\u52e4\u4f9d\u636e",
  NORMAL_COVERAGE_UNPROVEN:
    "\u6b63\u5e38\u51fa\u52e4\u8986\u76d6\u672a\u83b7\u8bc1\u5b9e",
  OBSERVATION_VERSION_REQUIRED: "\u53d6\u6570\u7248\u672c\u672a\u767b\u8bb0",
  OUTSIDE_MONTH: "\u6765\u6e90\u5de5\u4f5c\u65e5\u4e0d\u5728\u672c\u6708",
  OVERTIME_CLASSIFICATION_UNPROVEN:
    "\u52a0\u73ed\u5206\u7c7b\u6216\u65f6\u6bb5\u5f85\u6838",
  OVERTIME_KIND_REQUIRED: "\u52a0\u73ed\u65e5\u7c7b\u578b\u672a\u660e\u786e",
  PAGINATION_DUPLICATE: "\u5206\u9875\u8fd4\u56de\u91cd\u590d\u6765\u6e90",
  PAGINATION_INVALID: "\u5206\u9875\u7ed3\u679c\u683c\u5f0f\u5f02\u5e38",
  PAGINATION_LIMIT: "\u5206\u9875\u8fbe\u5230\u5b89\u5168\u4e0a\u9650",
  PAGINATION_STALLED: "\u5206\u9875\u672a\u7ee7\u7eed\u63a8\u8fdb",
  PENDING_APPROVAL: "\u5047\u52e4\u5ba1\u6279\u5c1a\u672a\u901a\u8fc7",
  PREVIOUS_SOURCE_STATE_INVALID:
    "\u5386\u53f2\u6765\u6e90\u7248\u672c\u8d44\u6599\u5f02\u5e38",
  PUNCH_INVALID: "\u6253\u5361\u7ed3\u679c\u683c\u5f0f\u5f02\u5e38",
  QUERY_COVERAGE_INCOMPLETE:
    "\u672c\u8f6e\u67e5\u8be2\u8986\u76d6\u5c1a\u672a\u5b8c\u6574",
  QUERY_SCOPE_INVALID:
    "\u53d6\u6570\u4eba\u5458\u6216\u65e5\u671f\u8303\u56f4\u65e0\u6548",
  READ_FAILED: "\u8003\u52e4\u6765\u6e90\u8bfb\u53d6\u5931\u8d25",
  REQUIREMENT_CONFLICT:
    "\u65e0\u9700\u8003\u52e4\u4e0e\u5b9e\u9645\u6765\u6e90\u51b2\u7a81",
  RESPONSE_INVALID: "\u9489\u9489\u8fd4\u56de\u683c\u5f0f\u5f02\u5e38",
  RESPONSE_SCOPE_MISMATCH:
    "\u8fd4\u56de\u4eba\u5458\u6216\u65e5\u671f\u8d85\u51fa\u6838\u5b9a\u8303\u56f4",
  REST_DAY_CONFLICT:
    "\u4f11\u606f\u65e5\u4e0e\u5047\u52e4\u4e8b\u5b9e\u9700\u6838\u5bf9",
  REST_INTERVAL_UNPROVEN: "\u4f11\u606f\u65f6\u6bb5\u672a\u83b7\u8bc1\u5b9e",
  REVOKED_RECORD:
    "\u6765\u6e90\u5df2\u64a4\u9500\uff0c\u5f71\u54cd\u5f85\u6838",
  SCHEDULE_DUPLICATE: "\u6392\u73ed\u6765\u6e90\u91cd\u590d",
  SCHEDULE_INVALID: "\u6392\u73ed\u6570\u636e\u683c\u5f0f\u5f02\u5e38",
  SCHEDULE_NOT_PROVEN: "\u6392\u73ed\u8986\u76d6\u672a\u83b7\u8bc1\u5b9e",
  SCHEDULE_PLAN_CONFLICT:
    "\u5e94\u6253\u5361\u65f6\u95f4\u6765\u6e90\u51b2\u7a81",
  SCHEDULE_PLAN_UNPROVEN:
    "\u5e94\u6253\u5361\u65f6\u95f4\u672a\u83b7\u8bc1\u5b9e",
  SHIFT_PAIR_UNPROVEN: "\u4e0a\u4e0b\u73ed\u5361\u70b9\u914d\u5bf9\u5f85\u6838",
  SOURCE_DISAPPEARED_UNPROVEN:
    "\u6765\u6e90\u6d88\u5931\u4f46\u64a4\u9500\u672a\u83b7\u8bc1\u5b9e",
  SOURCE_ID_INVALID: "\u8003\u52e4\u6765\u6e90\u6807\u8bc6\u65e0\u6548",
  SOURCE_IDENTITY_DUPLICATE: "\u8003\u52e4\u6765\u6e90\u6807\u8bc6\u91cd\u590d",
  SOURCE_VERSION_CONFLICT:
    "\u540c\u4e00\u6765\u6e90\u7248\u672c\u5185\u5bb9\u51b2\u7a81",
  SOURCE_VERSION_NOT_NEWER:
    "\u53d6\u6570\u7248\u672c\u8fc7\u65e7\u6216\u53d1\u751f\u51b2\u7a81",
  TIMEZONE_UNSUPPORTED: "\u8003\u52e4\u65f6\u533a\u6682\u4e0d\u652f\u6301",
  TOKEN_UNAVAILABLE: "\u9489\u9489\u8bbf\u95ee\u51ed\u8bc1\u4e0d\u53ef\u7528",
  TRANSPORT_OR_RESPONSE_FAILED:
    "\u9489\u9489\u901a\u4fe1\u6216\u54cd\u5e94\u5f02\u5e38",
  UNEXPECTED_RECORD:
    "\u6765\u6e90\u8d85\u51fa\u6838\u5b9a\u5e94\u51fa\u52e4\u8303\u56f4",
  UNKNOWN_UNIT: "\u65f6\u957f\u5355\u4f4d\u672a\u8bc6\u522b",
  UNMATCHED_PUNCH: "\u6253\u5361\u7ed3\u679c\u672a\u5339\u914d\u6392\u73ed",
  UPSTREAM_REJECTED: "\u9489\u9489\u62d2\u7edd\u672c\u6b21\u8bfb\u53d6",
  WORK_DATE_INVALID: "\u6765\u6e90\u5de5\u4f5c\u65e5\u65e0\u6548",
  WORKFLOW_PERMISSION_UNCONFIRMED:
    "\u5ba1\u6279\u5b9e\u4f8b\u8bfb\u53d6\u6743\u9650\u672a\u786e\u8ba4",
  WORKFLOW_READ_FAILED: "\u5ba1\u6279\u5b9e\u4f8b\u8bfb\u53d6\u5931\u8d25",
});

export function payrollDingtalkAttendancePendingLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(
    PAYROLL_DINGTALK_ATTENDANCE_PENDING_LABELS,
    code,
  )
    ? PAYROLL_DINGTALK_ATTENDANCE_PENDING_LABELS[code]
    : "\u8003\u52e4\u6765\u6e90\u5f85\u6838";
}

const D = Prisma.Decimal.clone({ precision: 40 });
const Hour = Prisma.Decimal.clone({
  precision: 40,
  rounding: Prisma.Decimal.ROUND_DOWN,
});
type Interval = { startsAt: string; endsAt: string };
function safeMappingKey(
  approval: DingtalkAttendanceApproval,
): string | undefined {
  if (![1, 2, 3].includes(approval.businessType ?? 0)) return;
  const categories = [approval.tagName, approval.subType];
  if (
    !approval.tagName ||
    categories.some(
      (value) =>
        typeof value !== "string" ||
        value.length > 190 ||
        value !== value.trim() ||
        !/^[\p{L}\p{M}\p{N} _./()\uFF08\uFF09-]*$/u.test(value) ||
        /\d{6,}/.test(value) ||
        (approval.processInstanceId &&
          value.includes(approval.processInstanceId)),
    )
  )
    return;
  const key = `${approval.businessType}:${approval.tagName}:${approval.subType}`;
  return key.length <= 200 ? key : undefined;
}
function hash(raw: unknown): string {
  const sorted = (value: any): any =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(sorted(raw)))
    .digest("hex");
}
const millis = (value: string) => Date.parse(value);
const validInterval = (row: Interval) =>
  typeof row.startsAt === "string" &&
  typeof row.endsAt === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(row.startsAt) &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(row.endsAt) &&
  Number.isFinite(millis(row.startsAt)) &&
  Number.isFinite(millis(row.endsAt)) &&
  millis(row.startsAt) < millis(row.endsAt);
function subtract(intervals: Interval[], cuts: Interval[]): Interval[] {
  return cuts.reduce(
    (remaining, cut) =>
      remaining.flatMap((row) => {
        if (
          millis(cut.endsAt) <= millis(row.startsAt) ||
          millis(cut.startsAt) >= millis(row.endsAt)
        )
          return [row];
        const parts: Interval[] = [];
        if (millis(cut.startsAt) > millis(row.startsAt))
          parts.push({ startsAt: row.startsAt, endsAt: cut.startsAt });
        if (millis(cut.endsAt) < millis(row.endsAt))
          parts.push({ startsAt: cut.endsAt, endsAt: row.endsAt });
        return parts;
      }),
    intervals,
  );
}
function intersect(intervals: Interval[], window: Interval): Interval[] {
  return intervals.flatMap((row) => {
    const startsAt =
      millis(row.startsAt) > millis(window.startsAt)
        ? row.startsAt
        : window.startsAt;
    const endsAt =
      millis(row.endsAt) < millis(window.endsAt) ? row.endsAt : window.endsAt;
    return millis(startsAt) < millis(endsAt) ? [{ startsAt, endsAt }] : [];
  });
}

/** Callers must persist sourceState and allocate observationVersion transactionally before enabling real synchronization. */
export function convertDingtalkAttendance(
  read: DingtalkAttendanceRead,
  options: PayrollDingtalkAttendanceOptions,
): PayrollDingtalkAttendanceConversion {
  const pending = [...read.pending],
    input: PayrollAttendanceInput = {
      month: read.month,
      expected: [],
      records: [],
    };
  const state = new Map<string, PayrollDingtalkAttendanceSourceState>(),
    observed = new Set<string>();
  const provenDays = new Map<
    string,
    { working: Interval[]; evidenceHash: string }
  >();
  const note = (
    code: string,
    day?: Pick<DingtalkAttendanceDay, "employeeId" | "workDate">,
    mappingKey?: string,
  ) =>
    pending.push({
      code,
      ...(day ? { employeeId: day.employeeId, workDate: day.workDate } : {}),
      ...(mappingKey ? { mappingKey } : {}),
    });
  const inScope = (row: { employeeId: string; workDate: string }) =>
    read.scope.employeeIds.includes(row.employeeId) &&
    row.workDate >= read.scope.from &&
    row.workDate <= read.scope.to &&
    row.workDate.startsWith(read.month + "-");
  const finish = (): PayrollDingtalkAttendanceConversion => {
    const normalized = normalizeAttendance(input);
    for (const issue of normalized.issues) note(issue.code, issue);
    const unique = [
      ...new Map(pending.map((issue) => [hash(issue), issue])).values(),
    ].sort((a, b) => hash(a).localeCompare(hash(b)));
    const complete = read.complete && !unique.length;
    return {
      status: complete ? "ready" : "pending",
      complete,
      scope: structuredClone(read.scope),
      input,
      sourceKey: `ding-attendance:${hash({ organizationKey: read.organizationKey, input, scope: read.scope, complete, pending: unique })}`,
      pending: unique,
      sourceState: [...state.values()].sort((a, b) =>
        a.sourceId.localeCompare(b.sourceId),
      ),
    };
  };
  if (!read.complete) note("QUERY_COVERAGE_INCOMPLETE");
  if (
    !Number.isSafeInteger(options.observationVersion) ||
    options.observationVersion < 1
  ) {
    note("OBSERVATION_VERSION_REQUIRED");
    return finish();
  }
  for (const previous of options.previous) {
    if (
      !previous ||
      !previous.record ||
      previous.sourceId !== previous.record.sourceId ||
      previous.sourceVersion !== previous.record.sourceVersion ||
      !Number.isSafeInteger(previous.sourceVersion) ||
      previous.sourceVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(previous.fingerprint) ||
      (previous.proof &&
        (!["derived-normal", "approval", "punch", "superseded-normal"].includes(
          previous.proof.kind,
        ) ||
          !/^[a-f0-9]{64}$/.test(previous.proof.identityHash) ||
          !/^[a-f0-9]{64}$/.test(previous.proof.evidenceHash) ||
          (previous.proof.terminalHash !== undefined &&
            !/^[a-f0-9]{64}$/.test(previous.proof.terminalHash)) ||
          (previous.proof.previousFingerprint !== undefined &&
            !/^[a-f0-9]{64}$/.test(previous.proof.previousFingerprint)))) ||
      state.has(previous.sourceId)
    ) {
      note("PREVIOUS_SOURCE_STATE_INVALID");
      return finish();
    }
    state.set(previous.sourceId, structuredClone(previous));
  }
  const expected = new Map<
    string,
    PayrollAttendanceInput["expected"][number]
  >();
  for (const row of options.expected) {
    const key = `${row.employeeId}:${row.workDate}`;
    if (
      !inScope(row) ||
      expected.has(key) ||
      typeof row.required !== "boolean" ||
      typeof row.units !== "string" ||
      !/^(?:0|1)(?:\.\d{1,4})?$/.test(row.units) ||
      new D(row.units).gt(1) ||
      row.required !== new D(row.units).gt(0)
    ) {
      note("HRM_EXPECTATION_INVALID");
      return finish();
    }
    const value = {
      employeeId: row.employeeId,
      workDate: row.workDate,
      required: row.required,
      units: new D(row.units).toString(),
    };
    expected.set(key, value);
    input.expected.push(value);
  }
  const dates: string[] = [];
  const first = millis(`${read.scope.from}T00:00:00Z`),
    last = millis(`${read.scope.to}T00:00:00Z`);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    first > last ||
    last - first > 30 * 86400000
  ) {
    note("QUERY_SCOPE_INVALID");
    return finish();
  }
  for (let day = first; day <= last; day += 86400000)
    dates.push(new Date(day).toISOString().slice(0, 10));
  for (const employeeId of read.scope.employeeIds)
    for (const workDate of dates)
      if (!expected.has(`${employeeId}:${workDate}`))
        note("HRM_EXPECTATION_MISSING", { employeeId, workDate });
  const seenDays = new Set<string>();
  function hours(parts: Interval[], day: DingtalkAttendanceDay): string | null {
    const duration = parts.reduce(
      (sum, row) => sum.plus(millis(row.endsAt) - millis(row.startsAt)),
      new D(0),
    );
    // Keep exact intervals; a repeating hour fraction must not exceed its source duration.
    const value = new Hour(duration.toString()).div(3600000);
    if (
      !value.isFinite() ||
      duration.minus(value.times(3600000)).abs().gt("1e-30")
    ) {
      note("HOUR_PRECISION_UNPROVEN", day);
      return null;
    }
    return value.toString();
  }
  function add(
    day: DingtalkAttendanceDay,
    identity: unknown,
    interval: Interval,
    type: PayrollAttendanceType,
    status: PayrollAttendanceRecord["state"],
    quantity: string,
    evidence: unknown,
    overtimeKind?: PayrollOvertimeKind,
    proof?: PayrollDingtalkAttendanceSourceProof,
  ) {
    const sourceId = `dt:${hash([read.organizationKey, day.employeeId, day.workDate, identity])}`;
    const record: PayrollAttendanceRecord = {
      sourceId,
      sourceVersion: options.observationVersion,
      employeeId: day.employeeId,
      workDate: day.workDate,
      startsAt: new Date(interval.startsAt).toISOString(),
      endsAt: new Date(interval.endsAt).toISOString(),
      type,
      state: status,
      hours: quantity,
      unit: "hour",
      ...(overtimeKind ? { overtimeKind } : {}),
    };
    save(sourceId, record, evidence, proof);
  }
  function save(
    sourceId: string,
    record: PayrollAttendanceRecord,
    evidence: unknown,
    proof?: PayrollDingtalkAttendanceSourceProof,
  ) {
    const day = record;
    const { sourceVersion: _version, ...body } = record,
      fingerprint = hash({ body, evidence, ...(proof ? { proof } : {}) }),
      previous = state.get(sourceId);
    if (observed.has(sourceId)) {
      note("SOURCE_IDENTITY_DUPLICATE", day);
      return;
    }
    observed.add(sourceId);
    if (
      previous &&
      (previous.sourceVersion > options.observationVersion ||
        (previous.fingerprint !== fingerprint &&
          previous.sourceVersion >= options.observationVersion))
    ) {
      note("SOURCE_VERSION_NOT_NEWER", day);
      return;
    }
    if (previous?.fingerprint === fingerprint)
      record.sourceVersion = previous.sourceVersion;
    state.set(sourceId, {
      sourceId,
      sourceVersion: record.sourceVersion,
      fingerprint,
      record,
      ...(proof ? { proof } : {}),
    });
    input.records.push(record);
  }
  for (const day of read.days) {
    const key = `${day.employeeId}:${day.workDate}`,
      wanted = expected.get(key);
    if (!inScope(day) || !wanted || seenDays.has(key)) {
      note("RESPONSE_SCOPE_MISMATCH");
      continue;
    }
    seenDays.add(key);
    if (!day.complete) note("DAY_COVERAGE_INCOMPLETE", day);
    if (
      [...day.schedule, ...day.punches].some(
        (row) => row.workDate !== day.workDate,
      )
    ) {
      note("RESPONSE_SCOPE_MISMATCH", day);
      continue;
    }
    const linked = (id?: string) =>
      !!id &&
      day.approvals.some((approval) => approval.processInstanceId === id);
    if (
      day.punches.some(
        (punch) => punch.approvalLinked && !linked(punch.processInstanceId),
      ) ||
      day.schedule.some(
        (row) =>
          row.approvalLinked &&
          !day.punches.some(
            (punch) =>
              punch.planId === row.id &&
              punch.checkType === row.checkType &&
              !!row.approvalId &&
              row.approvalId === punch.approvalId &&
              linked(punch.processInstanceId),
          ),
      )
    ) {
      note("APPROVAL_LINK_UNPROVEN", day);
      continue;
    }
    if (!day.schedule.length) {
      note("SCHEDULE_NOT_PROVEN", day);
      continue;
    }
    if (day.schedule.every((row) => row.isRest)) {
      if (wanted.required || day.punches.length || day.approvals.length)
        note("REST_DAY_CONFLICT", day);
      continue;
    }
    if (
      !wanted.required ||
      day.schedule.some((row) => row.isRest) ||
      !day.restsKnown
    ) {
      note("CALENDAR_OR_RESTS_UNPROVEN", day);
      continue;
    }
    const schedule = [...day.schedule].sort(
      (a, b) => millis(a.plannedAt ?? "") - millis(b.plannedAt ?? ""),
    );
    const shifts: Array<Interval & { on: string; off: string }> = [];
    for (let i = 0; i < schedule.length; i += 2) {
      const on = schedule[i],
        off = schedule[i + 1];
      const interval = {
        startsAt: on.plannedAt ?? "",
        endsAt: off?.plannedAt ?? "",
      };
      if (
        !off ||
        on.checkType !== "OnDuty" ||
        off.checkType !== "OffDuty" ||
        !on.classId ||
        on.classId !== off.classId ||
        !validInterval(interval) ||
        millis(interval.endsAt) - millis(interval.startsAt) > 48 * 3600000 ||
        shifts.some((row) => millis(row.endsAt) > millis(interval.startsAt))
      ) {
        note("SHIFT_PAIR_UNPROVEN", day);
        break;
      }
      shifts.push({ ...interval, on: on.id, off: off.id });
    }
    if (shifts.length * 2 !== schedule.length) continue;
    const rests = [...day.rests].sort(
      (a, b) => millis(a.startsAt) - millis(b.startsAt),
    );
    if (
      rests.some(
        (rest, index) =>
          !validInterval(rest) ||
          (index > 0 &&
            millis(rests[index - 1].endsAt) > millis(rest.startsAt)) ||
          !shifts.some(
            (shift) =>
              millis(rest.startsAt) >= millis(shift.startsAt) &&
              millis(rest.endsAt) <= millis(shift.endsAt),
          ),
      )
    ) {
      note("REST_INTERVAL_UNPROVEN", day);
      continue;
    }
    const working = subtract(shifts, rests),
      leave: Interval[] = [];
    for (const approval of day.approvals) {
      const approvalIdentity = hash(["approval", approval.processInstanceId]);
      const cancelled = approval.state === "cancelled";
      if (
        cancelled &&
        (approval.terminalProof?.status !== "TERMINATED" ||
          !/^[a-f0-9]{64}$/.test(approval.terminalProof.fingerprint))
      ) {
        note("APPROVAL_TERMINAL_STATE_UNPROVEN", day);
        continue;
      }
      const approvalProof: PayrollDingtalkAttendanceSourceProof = {
        kind: "approval",
        identityHash: approvalIdentity,
        evidenceHash: hash(cancelled ? approval.terminalProof : approval),
        ...(cancelled
          ? { terminalHash: approval.terminalProof!.fingerprint }
          : {}),
      };
      if (cancelled) {
        const previous = [...state.values()].filter(
          (row) =>
            row.record.employeeId === day.employeeId &&
            row.record.workDate === day.workDate &&
            row.proof?.kind === "approval" &&
            row.proof.identityHash === approvalIdentity,
        );
        if (previous.length) {
          for (const prior of previous)
            save(
              prior.sourceId,
              {
                ...prior.record,
                state: "cancelled",
                sourceVersion: options.observationVersion,
              },
              approval.terminalProof,
              approvalProof,
            );
          continue;
        }
      }
      const mappingKey = safeMappingKey(approval);
      const mapping = mappingKey
        ? options.approvalMappings[mappingKey]
        : undefined;
      if (
        !mapping ||
        ![
          "paid_leave",
          "unpaid_leave",
          "sick_leave",
          "business_trip",
          "outing",
          "makeup",
          "overtime",
        ].includes(mapping.type)
      ) {
        if (!mappingKey) note("APPROVAL_MAPPING_KEY_UNSUPPORTED", day);
        note("APPROVAL_TYPE_UNMAPPED", day, mappingKey);
        continue;
      }
      if (approval.state !== "approved" && !cancelled)
        note(
          approval.state === "revoked"
            ? "APPROVAL_REVOKED"
            : "APPROVAL_NOT_FINAL",
          day,
        );
      if (approval.unit !== "hour") {
        note(
          approval.unit === "day" ? "DAY_CONVERSION_REQUIRED" : "UNKNOWN_UNIT",
          day,
        );
        continue;
      }
      const interval = {
        startsAt: approval.startsAt ?? "",
        endsAt: approval.endsAt ?? "",
      };
      if (
        !validInterval(interval) ||
        !approval.duration ||
        !/^\d{1,12}(\.\d{1,4})?$/.test(approval.duration) ||
        !new D(approval.duration).gt(0)
      ) {
        note("APPROVAL_INTERVAL_UNPROVEN", day);
        continue;
      }
      const pieces = subtract([interval], rests),
        quantity = hours(pieces, day);
      if (quantity === null || !new D(quantity).eq(approval.duration)) {
        note("APPROVAL_DURATION_UNPROVEN", day);
        continue;
      }
      if (mapping.type === "overtime") {
        if (
          !["weekday", "restday", "holiday"].includes(
            mapping.overtimeKind ?? "",
          ) ||
          working.some(
            (row) =>
              millis(row.startsAt) < millis(interval.endsAt) &&
              millis(row.endsAt) > millis(interval.startsAt),
          )
        ) {
          note("OVERTIME_CLASSIFICATION_UNPROVEN", day);
          continue;
        }
      } else if (subtract(pieces, working).length) {
        note("APPROVAL_DAILY_ALLOCATION_UNPROVEN", day);
        continue;
      }
      for (const [index, piece] of pieces.entries()) {
        const part = hours([piece], day);
        if (part === null) continue;
        add(
          day,
          ["approval", approval.processInstanceId, index],
          piece,
          mapping.type,
          approval.state === "approved" ? "effective" : approval.state,
          part,
          cancelled ? approval.terminalProof : approval,
          mapping.overtimeKind,
          approvalProof,
        );
      }
      if (approval.state === "approved" && mapping.type !== "overtime")
        leave.push(...pieces);
    }
    if (
      day.punches.some(
        (punch) => !schedule.some((row) => row.id === punch.planId),
      )
    )
      note("UNMATCHED_PUNCH", day);
    for (const shift of shifts) {
      const regular = subtract(subtract([shift], rests), leave);
      if (!regular.length) continue;
      const on = day.punches.filter((punch) => punch.planId === shift.on),
        off = day.punches.filter((punch) => punch.planId === shift.off);
      if (
        on.length !== 1 ||
        off.length !== 1 ||
        on[0].checkType !== "OnDuty" ||
        off[0].checkType !== "OffDuty" ||
        !["Normal", "Late"].includes(on[0].result) ||
        !["Normal", "Early"].includes(off[0].result) ||
        [on[0], off[0]].some(
          (punch) =>
            punch.location !== "Normal" ||
            !punch.checkedAt ||
            !/(?:Z|[+-]\d{2}:\d{2})$/.test(punch.checkedAt) ||
            !Number.isFinite(millis(punch.checkedAt)),
        ) ||
        millis(on[0].checkedAt!) > millis(off[0].checkedAt!) ||
        (on[0].result === "Late" &&
          !(
            millis(shift.startsAt) < millis(on[0].checkedAt!) &&
            millis(on[0].checkedAt!) < millis(shift.endsAt)
          )) ||
        (off[0].result === "Early" &&
          !(
            millis(shift.startsAt) < millis(off[0].checkedAt!) &&
            millis(off[0].checkedAt!) < millis(shift.endsAt)
          )) ||
        millis(on[0].plannedAt) !== millis(shift.startsAt) ||
        millis(off[0].plannedAt) !== millis(shift.endsAt)
      ) {
        note("NORMAL_COVERAGE_UNPROVEN", day);
        continue;
      }
      const shortfalls: Array<
        Interval & { type: "late" | "early"; punch: (typeof on)[number] }
      > = [];
      if (on[0].result === "Late")
        shortfalls.push(
          ...intersect(regular, {
            startsAt: shift.startsAt,
            endsAt: on[0].checkedAt!,
          }).map((part) => ({ ...part, type: "late" as const, punch: on[0] })),
        );
      if (off[0].result === "Early")
        shortfalls.push(
          ...intersect(regular, {
            startsAt: off[0].checkedAt!,
            endsAt: shift.endsAt,
          }).map((part) => ({
            ...part,
            type: "early" as const,
            punch: off[0],
          })),
        );
      for (const type of ["late", "early"] as const) {
        for (const [index, part] of shortfalls
          .filter((row) => row.type === type)
          .entries()) {
          const quantity = hours([part], day);
          if (quantity === null) continue;
          add(
            day,
            [type, shift.on, shift.off, index],
            part,
            type,
            "effective",
            quantity,
            part.punch,
            undefined,
            {
              kind: "punch",
              identityHash: hash([
                part.punch.id,
                part.punch.planId,
                part.punch.checkType,
              ]),
              evidenceHash: hash(part.punch),
            },
          );
        }
      }
      for (const [index, interval] of subtract(regular, shortfalls).entries()) {
        const quantity = hours([interval], day);
        if (quantity === null) continue;
        add(
          day,
          ["normal", shift.on, shift.off, index],
          interval,
          "normal",
          "effective",
          quantity,
          { on: on[0], off: off[0], rests, leave },
          undefined,
          {
            kind: "derived-normal",
            identityHash: hash(["normal", shift.on, shift.off, index]),
            evidenceHash: hash({ on: on[0], off: off[0], rests, leave }),
          },
        );
      }
    }
    const current = input.records.filter(
      (row) =>
        row.employeeId === day.employeeId && row.workDate === day.workDate,
    );
    if (
      read.complete &&
      day.complete &&
      !pending.some(
        (issue) =>
          !issue.workDate ||
          (issue.employeeId === day.employeeId &&
            issue.workDate === day.workDate),
      ) &&
      !normalizeAttendance(input).issues.some(
        (issue) =>
          issue.employeeId === day.employeeId &&
          issue.workDate === day.workDate,
      ) &&
      !subtract(
        working,
        current
          .filter((row) => row.state === "effective" && row.type !== "overtime")
          .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
      ).length
    ) {
      provenDays.set(key, {
        working,
        evidenceHash: hash({ schedule: day.schedule, rests, current }),
      });
    }
  }
  for (const row of input.expected)
    if (!seenDays.has(`${row.employeeId}:${row.workDate}`))
      note("DAY_COVERAGE_MISSING", row);
  // Only our own derived normal segments can be retired by proven replacement coverage.
  for (const previous of [...state.values()]) {
    if (!inScope(previous.record) || observed.has(previous.sourceId)) continue;
    const proof = previous.proof;
    if (
      (previous.record.state === "superseded" &&
        previous.record.type === "normal" &&
        proof?.kind === "superseded-normal") ||
      (previous.record.state === "cancelled" &&
        proof?.kind === "approval" &&
        proof.terminalHash)
    ) {
      observed.add(previous.sourceId);
      input.records.push(structuredClone(previous.record));
      continue;
    }
    const coverage = provenDays.get(
      `${previous.record.employeeId}:${previous.record.workDate}`,
    );
    if (
      previous.record.type === "normal" &&
      previous.record.state === "effective" &&
      proof?.kind === "derived-normal" &&
      coverage &&
      validInterval(previous.record) &&
      !subtract([previous.record], coverage.working).length
    ) {
      save(
        previous.sourceId,
        {
          ...previous.record,
          sourceVersion: options.observationVersion,
          state: "superseded",
        },
        coverage.evidenceHash,
        {
          kind: "superseded-normal",
          identityHash: proof.identityHash,
          evidenceHash: coverage.evidenceHash,
          previousFingerprint: previous.fingerprint,
        },
      );
    } else note("SOURCE_DISAPPEARED_UNPROVEN", previous.record);
  }
  return finish();
}
