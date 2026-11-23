import { Prisma } from "@prisma/client";
import type { DingtalkAttendanceRead } from "../dingtalk/dingtalk-attendance.service";
import { normalizeAttendance } from "./payroll-attendance-normalizer";
import * as converter from "./payroll-dingtalk-attendance";
import type { PayrollDingtalkAttendanceOptions } from "./payroll-dingtalk-attendance";

const employeeId = "00000000-0000-4000-8000-000000000001";
const workDate = "2026-11-02";
const at = (time: string) => `${workDate}T${time}:00+08:00`;
function fixture(planned = false) {
  const read: DingtalkAttendanceRead = {
    month: "2026-11",
    organizationKey: "fictional-org",
    complete: true,
    pending: [],
    scope: { employeeIds: [employeeId], from: workDate, to: workDate },
    days: [
      {
        employeeId,
        workDate,
        complete: true,
        restsKnown: true,
        rests: planned ? [{ startsAt: at("12:00"), endsAt: at("13:00") }] : [],
        schedule: ["OnDuty", "OffDuty"].map((checkType, index) => ({
          id: `plan-${index}`,
          classId: "fictional-class",
          workDate,
          checkType,
          plannedAt: at(index ? "18:00" : "09:00"),
          isRest: !planned,
          approvalLinked: false,
        })),
        punches: [],
        approvals: [
          {
            processInstanceId: "fictional-overtime",
            businessType: 3,
            tagName: "overtime",
            subType: "confirmed",
            startsAt: at("09:00"),
            endsAt: at(planned ? "18:00" : "11:00"),
            duration: planned ? "8" : "2",
            unit: "hour",
            state: "approved",
          },
        ],
      },
    ],
  };
  const options: PayrollDingtalkAttendanceOptions = {
    expected: [{ employeeId, workDate, required: false, units: "0" }],
    observationVersion: 1,
    previous: [],
    approvalMappings: {
      "3:overtime:confirmed": { type: "overtime", overtimeKind: "restday" },
    },
  };
  return {
    read,
    options,
    day: read.days[0],
    run: () => converter.convertDingtalkAttendance(read, options),
  };
}
function punches(
  value: ReturnType<typeof fixture>,
  on = "09:00",
  off = "18:00",
) {
  value.day.punches = value.day.schedule.map((plan, index) => ({
    id: `punch-${index}`,
    planId: plan.id,
    workDate,
    checkType: plan.checkType,
    plannedAt: plan.plannedAt!,
    checkedAt: at(index ? off : on),
    result: "Normal",
    location: "Normal",
    approvalLinked: false,
  }));
}
function expectOvertime(value: ReturnType<typeof fixture>, hours: string) {
  const result = value.run();
  expect(result.pending).toEqual([]);
  expect(result.complete).toBe(true);
  expect(result.input.records.length).toBeGreaterThan(0);
  expect(
    result.input.records.every(
      (row) => row.type === "overtime" && row.state === "effective",
    ),
  ).toBe(true);
  expect(
    result.input.records
      .reduce((sum, row) => sum.plus(row.hours), new Prisma.Decimal(0))
      .toString(),
  ).toBe(hours);
  expect(normalizeAttendance(result.input).issues).toEqual([]);
  return result;
}

describe("non-required-day approved overtime conversion", () => {
  it("accepts approved restday overtime without normal attendance", () => {
    expectOvertime(fixture(), "2");
  });
  it.each(["restday", "holiday"] as const)(
    "uses only the reviewed %s mapping and excludes proved rests",
    (kind) => {
      const value = fixture(true);
      value.options.approvalMappings["3:overtime:confirmed"].overtimeKind =
        kind;
      const result = expectOvertime(value, "8");
      expect(
        result.input.records.every((row) => row.overtimeKind === kind),
      ).toBe(true);
      expect(result.input.records).toHaveLength(2);
    },
  );
  it("accepts exactly covered, matched optional punches without inventing regular work", () => {
    const value = fixture(true);
    punches(value);
    expectOvertime(value, "8");
  });
  it.each(["pending", "revoked"] as const)(
    "keeps %s overtime blocked",
    (state) => {
      const value = fixture();
      value.day.approvals[0].state = state;
      const result = value.run();
      expect(result.complete).toBe(false);
      expect(result.pending.map((row) => row.code)).toContain(
        state === "pending" ? "APPROVAL_NOT_FINAL" : "APPROVAL_REVOKED",
      );
      expect(
        result.input.records.some((row) => row.state === "effective"),
      ).toBe(false);
    },
  );
  it.each([
    "unmapped",
    "leave",
    "weekday",
    "day_unit",
    "duration",
    "outside_day",
    "unknown_rests",
    "overlapping_rests",
    "bad_rest",
    "incomplete",
    "missing_day",
    "calendar",
  ])("does not accept unproved non-required-day facts: %s", (condition) => {
    const value = fixture(true);
    const approval = value.day.approvals[0];
    if (condition === "unmapped") value.options.approvalMappings = {};
    if (condition === "leave")
      value.options.approvalMappings["3:overtime:confirmed"] = {
        type: "paid_leave",
      };
    if (condition === "weekday")
      value.options.approvalMappings["3:overtime:confirmed"].overtimeKind =
        "weekday";
    if (condition === "day_unit") approval.unit = "day";
    if (condition === "duration") approval.duration = "9";
    if (condition === "outside_day") {
      approval.endsAt = "2026-11-03T02:00:00+08:00";
      approval.duration = "16";
    }
    if (condition === "unknown_rests") value.day.restsKnown = false;
    if (condition === "overlapping_rests")
      value.day.rests.push({ ...value.day.rests[0] });
    if (condition === "bad_rest")
      value.day.rests = [{ startsAt: at("11:00"), endsAt: at("10:00") }];
    if (condition === "incomplete") value.read.complete = false;
    if (condition === "missing_day") value.day.complete = false;
    if (condition === "calendar") {
      value.options.expected[0] = {
        employeeId,
        workDate,
        required: true,
        units: "1",
      };
      value.day.schedule.forEach((row) => (row.isRest = true));
    }
    expect(value.run().complete).toBe(false);
  });
  it.each([
    "no_approval",
    "unmatched",
    "missing_pair",
    "outside_approval",
    "unknown_result",
    "unknown_location",
    "missing_time",
    "wrong_plan_time",
  ])("does not swallow unexplained optional punches: %s", (condition) => {
    const value = fixture(true);
    punches(value);
    if (condition === "no_approval") value.day.approvals = [];
    if (condition === "unmatched") value.day.punches[0].planId = "foreign-plan";
    if (condition === "missing_pair") value.day.punches.pop();
    if (condition === "outside_approval") {
      value.day.approvals[0].endsAt = at("11:00");
      value.day.approvals[0].duration = "2";
    }
    if (condition === "unknown_result")
      value.day.punches[0].result = "NotSigned";
    if (condition === "unknown_location")
      value.day.punches[0].location = "Outside";
    if (condition === "missing_time") value.day.punches[0].checkedAt = null;
    if (condition === "wrong_plan_time")
      value.day.punches[0].plannedAt = at("10:00");
    expect(value.run().complete).toBe(false);
  });
  it("keeps another leave approval visible instead of passing the overtime alone", () => {
    const value = fixture();
    value.day.approvals.push({
      ...value.day.approvals[0],
      processInstanceId: "fictional-leave",
      tagName: "leave",
    });
    value.options.approvalMappings["3:leave:confirmed"] = {
      type: "paid_leave",
    };
    const result = value.run();
    expect(result.complete).toBe(false);
    expect(result.pending.map((row) => row.code)).toContain(
      "REST_DAY_CONFLICT",
    );
  });
  it.each([true, false])(
    "rejects %s duplicate-identity or overlapping overtime",
    (duplicate) => {
      const value = fixture();
      value.day.approvals.push({
        ...value.day.approvals[0],
        ...(duplicate ? {} : { processInstanceId: "fictional-overlap" }),
      });
      const result = value.run();
      expect(result.complete).toBe(false);
      expect(result.pending.map((row) => row.code)).toContain(
        duplicate ? "SOURCE_IDENTITY_DUPLICATE" : "INTERVAL_CONFLICT",
      );
    },
  );
  it("does not infer regular attendance from overtime on a required workday", () => {
    const value = fixture(true);
    value.options.expected[0] = {
      employeeId,
      workDate,
      required: true,
      units: "1",
    };
    value.options.approvalMappings["3:overtime:confirmed"].overtimeKind =
      "weekday";
    value.day.approvals[0] = {
      ...value.day.approvals[0],
      startsAt: at("19:00"),
      endsAt: at("21:00"),
      duration: "2",
    };
    expect(value.run().complete).toBe(false);
  });
  it("retains stable IDs on replay and terminal cancellation tombstones", () => {
    const value = fixture();
    const first = expectOvertime(value, "2");
    value.options.previous = JSON.parse(JSON.stringify(first.sourceState));
    value.options.observationVersion = 2;
    const replay = expectOvertime(value, "2");
    expect(replay.sourceState).toEqual(first.sourceState);
    value.day.approvals[0].state = "cancelled";
    value.day.approvals[0].terminalProof = {
      status: "TERMINATED",
      fingerprint: "a".repeat(64),
    };
    value.options.previous = replay.sourceState;
    value.options.observationVersion = 3;
    const cancelled = value.run();
    expect(cancelled.complete).toBe(true);
    expect(
      cancelled.input.records.every((row) => row.state === "cancelled"),
    ).toBe(true);
    expect(cancelled.input.records.map((row) => row.sourceId)).toEqual(
      first.input.records.map((row) => row.sourceId),
    );
    value.options.previous = JSON.parse(JSON.stringify(cancelled.sourceState));
    value.options.observationVersion = 4;
    expect(value.run().sourceState).toEqual(cancelled.sourceState);
  });
  it("does not interpret disappeared overtime as an authorized withdrawal", () => {
    const value = fixture();
    const first = expectOvertime(value, "2");
    value.options.previous = first.sourceState;
    value.options.observationVersion = 2;
    value.day.approvals = [];
    expect(value.run().pending.map((row) => row.code)).toContain(
      "SOURCE_DISAPPEARED_UNPROVEN",
    );
  });
  it("does not accept a cancellation without terminal evidence", () => {
    const value = fixture();
    value.day.approvals[0].state = "cancelled";
    expect(value.run().pending.map((row) => row.code)).toContain(
      "APPROVAL_TERMINAL_STATE_UNPROVEN",
    );
  });
  it("exposes only validated plan and rest intervals for separate manual review", () => {
    const value = fixture(true);
    const readPlan = converter.readPayrollDingtalkDayPlan;
    expect(typeof readPlan).toBe("function");
    const plan = readPlan(value.day);
    expect(plan.issues).toEqual([]);
    expect(plan.shifts).toHaveLength(1);
    expect(plan.working).toEqual([
      { startsAt: at("09:00"), endsAt: at("12:00") },
      { startsAt: at("13:00"), endsAt: at("18:00") },
    ]);
    value.day.restsKnown = false;
    expect(readPlan(value.day).issues).toContain("CALENDAR_OR_RESTS_UNPROVEN");
    expect(readPlan(value.day).working).toEqual([]);
  });
});

type AbsenceCandidate = {
  employeeId: string;
  workDate: string;
  proofHash: string;
  intervals: Array<{ startsAt: string; endsAt: string }>;
  hours: string;
};
function absent() {
  const value = fixture(true);
  value.day.approvals = [];
  value.options.expected[0] = {
    employeeId,
    workDate,
    required: true,
    units: "1",
  };
  return value;
}
function candidate(value: ReturnType<typeof fixture>): AbsenceCandidate | null {
  return converter.payrollAbsenceCandidate(
    value.day,
    value.options.expected[0],
  );
}
function confirm(value: ReturnType<typeof fixture>, proof = candidate(value)!) {
  const records = proof.intervals.map((interval, index) => ({
    ...interval,
    sourceId: `fictional-manual-absence-${index}`,
    sourceVersion: 1,
    employeeId,
    workDate,
    type: "absence" as const,
    state: "effective" as const,
    unit: "hour" as const,
    hours: new Prisma.Decimal(
      Date.parse(interval.endsAt) - Date.parse(interval.startsAt),
    )
      .div(3600000)
      .toString(),
  }));
  const fact = { employeeId, workDate, proofHash: proof.proofHash, records };
  value.options.confirmedAbsences = [fact];
  return fact;
}

describe("evidence-backed absence candidates, never inferred payroll facts", () => {
  it("returns proved missing-shift intervals but never creates automatic absence", () => {
    expect(typeof converter.payrollAbsenceCandidate).toBe("function");
    const value = absent(),
      proof = candidate(value)!;
    expect(proof).toMatchObject({ employeeId, workDate, hours: "8" });
    expect(proof.proofHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.intervals).toEqual([
      { startsAt: at("09:00"), endsAt: at("12:00") },
      { startsAt: at("13:00"), endsAt: at("18:00") },
    ]);
    const result = value.run();
    expect(result.complete).toBe(false);
    expect(result.input.records.some((row) => row.type === "absence")).toBe(
      false,
    );
  });
  it("uses exact already-reviewed facts while keeping manual records out of external sourceState", () => {
    const value = absent();
    const fact = confirm(value),
      result = value.run();
    expect(result.complete).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.input.records).toEqual(fact.records);
    expect(result.sourceState).toEqual([]);
    expect(normalizeAttendance(result.input).issues).toEqual([]);
    expect(value.run()).toEqual(result);
  });
  it("accepts two explicit NotSigned cards only when both have no actual punch", () => {
    const value = absent();
    punches(value);
    value.day.punches.forEach((row) => {
      row.checkedAt = null;
      row.result = "NotSigned";
    });
    expect(candidate(value)?.hours).toBe("8");
    confirm(value);
    expect(value.run().complete).toBe(true);
  });
  it("keeps present shifts normal while replacing only a completely missing shift", () => {
    const value = absent();
    value.day.rests = [];
    value.day.schedule = ["09:00", "12:00", "13:00", "18:00"].map(
      (time, index) => ({
        ...value.day.schedule[index % 2],
        id: `plan-${index}`,
        plannedAt: at(time),
      }),
    );
    punches(value, "09:00", "12:00");
    value.day.punches = value.day.punches.slice(0, 2);
    expect(candidate(value)?.hours).toBe("5");
    confirm(value);
    const result = value.run();
    expect(result.complete).toBe(true);
    expect(
      result.input.records
        .filter((row) => row.type === "normal")
        .map((row) => row.hours),
    ).toEqual(["3"]);
    expect(
      result.input.records
        .filter((row) => row.type === "absence")
        .map((row) => row.hours),
    ).toEqual(["5"]);
    expect(
      result.sourceState.every((row) => row.record.type === "normal"),
    ).toBe(true);
  });
  it.each([
    "incomplete",
    "unknown_rests",
    "missing_plan",
    "duplicate_plan",
    "rest_day",
    "wrong_employee",
    "wrong_day",
    "units",
    "one_card",
    "unmatched_card",
    "invalid_pair",
    "effective_leave",
    "pending_leave",
    "unproved_revoke",
    "approval_link",
  ])("does not offer an absence candidate for %s", (condition) => {
    const value = absent();
    if (condition === "incomplete") value.day.complete = false;
    if (condition === "unknown_rests") value.day.restsKnown = false;
    if (condition === "missing_plan") value.day.schedule = [];
    if (condition === "duplicate_plan")
      value.day.schedule[1].id = value.day.schedule[0].id;
    if (condition === "rest_day")
      value.options.expected[0] = {
        employeeId,
        workDate,
        required: false,
        units: "0",
      };
    if (condition === "wrong_employee")
      value.options.expected[0].employeeId = "foreign";
    if (condition === "wrong_day")
      value.options.expected[0].workDate = "2026-11-03";
    if (condition === "units") value.options.expected[0].units = "0";
    if (["one_card", "unmatched_card", "invalid_pair"].includes(condition))
      punches(value);
    if (condition === "one_card") value.day.punches.pop();
    if (condition === "unmatched_card")
      value.day.punches[0].planId = "foreign-plan";
    if (condition === "invalid_pair") value.day.punches[0].checkedAt = null;
    if (
      ["effective_leave", "pending_leave", "unproved_revoke"].includes(
        condition,
      )
    )
      value.day.approvals = [
        {
          ...fixture().day.approvals[0],
          state:
            condition === "effective_leave"
              ? "approved"
              : condition === "pending_leave"
                ? "pending"
                : "revoked",
        },
      ];
    if (condition === "approval_link")
      value.day.schedule[0].approvalLinked = true;
    expect(candidate(value)).toBeNull();
  });
  it.each([
    "proof",
    "hours",
    "type",
    "state",
    "unit",
    "employee",
    "date",
    "interval",
    "partial",
    "duplicate",
    "duplicate_fact",
  ])(
    "refuses an inconsistent confirmed absence without hiding the missing coverage: %s",
    (condition) => {
      const value = absent(),
        fact = confirm(value);
      if (condition === "proof") fact.proofHash = "b".repeat(64);
      if (condition === "hours") fact.records[0].hours = "2";
      if (condition === "type") (fact.records[0] as any).type = "normal";
      if (condition === "state") (fact.records[0] as any).state = "pending";
      if (condition === "unit") (fact.records[0] as any).unit = "day";
      if (condition === "employee") fact.records[0].employeeId = "foreign";
      if (condition === "date") fact.records[0].workDate = "2026-11-03";
      if (condition === "interval") fact.records[0].endsAt = at("13:00");
      if (condition === "partial") fact.records.pop();
      if (condition === "duplicate") fact.records.push({ ...fact.records[0] });
      if (condition === "duplicate_fact")
        value.options.confirmedAbsences!.push(fact);
      const result = value.run();
      expect(result.complete).toBe(false);
      expect(result.pending.map((row) => row.code)).toContain(
        "NORMAL_COVERAGE_UNPROVEN",
      );
      expect(result.input.records.some((row) => row.type === "absence")).toBe(
        false,
      );
    },
  );
  it("invalidates confirmed absence when raw plan or punches change", () => {
    const value = absent();
    confirm(value);
    const before = candidate(value)!.proofHash;
    value.day.schedule[0].plannedAt = at("10:00");
    expect(candidate(value)!.proofHash).not.toBe(before);
    expect(value.run().complete).toBe(false);
    expect(
      value.run().input.records.some((row) => row.type === "absence"),
    ).toBe(false);
    punches(value);
    value.day.punches.pop();
    expect(candidate(value)).toBeNull();
    expect(value.run().complete).toBe(false);
  });
  it.each(["complete_punches", "rest_day"])(
    "does not silently discard a prior confirmation after %s replaces its candidate",
    (change) => {
      const value = absent();
      confirm(value);
      if (change === "complete_punches") punches(value);
      else {
        value.options.expected[0] = {
          employeeId,
          workDate,
          required: false,
          units: "0",
        };
        value.day.schedule.forEach((row) => (row.isRest = true));
      }
      expect(candidate(value)).toBeNull();
      const result = value.run();
      expect(result.complete).toBe(false);
      expect(result.pending.map((row) => row.code)).toContain(
        "NORMAL_COVERAGE_UNPROVEN",
      );
    },
  );
  it("does not clear independent upstream pending issues with an approved absence", () => {
    const value = absent();
    confirm(value);
    value.read.pending.push({
      code: "WORKFLOW_READ_FAILED",
      employeeId,
      workDate,
    });
    const result = value.run();
    expect(result.complete).toBe(false);
    expect(result.pending.map((row) => row.code)).toContain(
      "WORKFLOW_READ_FAILED",
    );
    expect(result.sourceState).toEqual([]);
  });
});
