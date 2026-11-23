import { DingtalkAttendanceRead } from "../dingtalk/dingtalk-attendance.service";
import {
  convertDingtalkAttendance,
  payrollDingtalkAttendancePendingLabel,
  PayrollDingtalkAttendanceOptions,
} from "./payroll-dingtalk-attendance";

const employeeId = "00000000-0000-4000-8000-000000000001";
const at = (time: string) => `2026-11-02T${time}:00+08:00`;
const read = (): DingtalkAttendanceRead => ({
  month: "2026-11",
  organizationKey: "fictional-org-key",
  scope: { employeeIds: [employeeId], from: "2026-11-02", to: "2026-11-02" },
  complete: true,
  pending: [],
  days: [
    {
      employeeId,
      workDate: "2026-11-02",
      complete: true,
      restsKnown: true,
      rests: [{ startsAt: at("12:00"), endsAt: at("13:00") }],
      approvals: [],
      schedule: [
        {
          id: "1",
          classId: "class",
          workDate: "2026-11-02",
          checkType: "OnDuty",
          plannedAt: at("09:00"),
          isRest: false,
          approvalLinked: false,
        },
        {
          id: "2",
          classId: "class",
          workDate: "2026-11-02",
          checkType: "OffDuty",
          plannedAt: at("18:00"),
          isRest: false,
          approvalLinked: false,
        },
      ],
      punches: [
        {
          id: "p1",
          planId: "1",
          workDate: "2026-11-02",
          checkType: "OnDuty",
          plannedAt: at("09:00"),
          checkedAt: at("09:00"),
          result: "Normal",
          location: "Normal",
          approvalLinked: false,
        },
        {
          id: "p2",
          planId: "2",
          workDate: "2026-11-02",
          checkType: "OffDuty",
          plannedAt: at("18:00"),
          checkedAt: at("18:00"),
          result: "Normal",
          location: "Normal",
          approvalLinked: false,
        },
      ],
    },
  ],
});
const options = (
  patch: Partial<PayrollDingtalkAttendanceOptions> = {},
): PayrollDingtalkAttendanceOptions => ({
  expected: [
    { employeeId, workDate: "2026-11-02", required: true, units: "1" },
  ],
  observationVersion: 1,
  previous: [],
  approvalMappings: {},
  ...patch,
});
const approved = () => ({
  processInstanceId: "fictional-process",
  businessType: 3,
  tagName: "leave",
  subType: "annual",
  startsAt: at("09:00"),
  endsAt: at("11:00"),
  duration: "2",
  unit: "hour",
  state: "approved" as const,
});

describe("convertDingtalkAttendance trusted source conversion", () => {
  it("provides business labels for pending results without echoing unknown payloads or prototype names", () => {
    expect(
      payrollDingtalkAttendancePendingLabel("SCHEDULE_PLAN_CONFLICT"),
    ).toBe("\u5e94\u6253\u5361\u65f6\u95f4\u6765\u6e90\u51b2\u7a81");
    expect(
      payrollDingtalkAttendancePendingLabel("APPROVAL_LINK_UNPROVEN"),
    ).toBe("\u6392\u73ed\u4e0e\u5ba1\u6279\u5173\u8054\u5f85\u6838");
    expect(payrollDingtalkAttendancePendingLabel("UNKNOWN_UNIT")).toBe(
      "\u65f6\u957f\u5355\u4f4d\u672a\u8bc6\u522b",
    );
    expect(
      payrollDingtalkAttendancePendingLabel("SOURCE_DISAPPEARED_UNPROVEN"),
    ).toBe(
      "\u6765\u6e90\u6d88\u5931\u4f46\u64a4\u9500\u672a\u83b7\u8bc1\u5b9e",
    );
    for (const code of ["PRIVATE_TOKEN_PAYLOAD", "__proto__", "toString"])
      expect(payrollDingtalkAttendancePendingLabel(code)).toBe(
        "\u8003\u52e4\u6765\u6e90\u5f85\u6838",
      );
  });
  it("uses planned intervals minus explicit rests, not actual punch duration, and replays stably", () => {
    const source = read();
    source.days[0].punches[0].checkedAt = at("08:00");
    source.days[0].punches[1].checkedAt = at("19:00");
    const original = JSON.stringify(source),
      result = convertDingtalkAttendance(source, options());
    expect(result.status).toBe("ready");
    expect(result.complete).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.input.records.map((r) => [r.type, r.hours, r.state])).toEqual(
      [
        ["normal", "3", "effective"],
        ["normal", "5", "effective"],
      ],
    );
    const again = convertDingtalkAttendance(
      source,
      options({ observationVersion: 2, previous: result.sourceState }),
    );
    expect(again.input).toEqual(result.input);
    expect(again.sourceKey).toBe(result.sourceKey);
    expect(JSON.stringify(source)).toBe(original);
  });
  it.each(["schedule", "rests", "punch", "late", "incomplete", "day_coverage"])(
    "does not fabricate coverage for %s",
    (condition) => {
      const source = read();
      if (condition === "schedule") source.days[0].schedule = [];
      if (condition === "rests") source.days[0].restsKnown = false;
      if (condition === "punch") source.days[0].punches = [];
      if (condition === "late") source.days[0].punches[0].result = "Late";
      if (condition === "incomplete") source.complete = false;
      if (condition === "day_coverage") source.days = [];
      const result = convertDingtalkAttendance(source, options());
      expect(result.status).toBe("pending");
      expect(result.complete).toBe(false);
      expect(result.pending.length).toBeGreaterThan(0);
    },
  );
  it("accepts explicit rest while never treating empty punch data as a rest day", () => {
    const source = read();
    source.days[0].schedule.forEach((s) => (s.isRest = true));
    source.days[0].punches = [];
    const result = convertDingtalkAttendance(
      source,
      options({
        expected: [
          { employeeId, workDate: "2026-11-02", required: false, units: "0" },
        ],
      }),
    );
    expect(result.complete).toBe(true);
    expect(result.input.records).toEqual([]);
    source.days[0].schedule = [];
    expect(convertDingtalkAttendance(source, options()).complete).toBe(false);
  });
  it("requires an explicit leave classification, then replaces only its proven hours", () => {
    const source = read();
    source.days[0].approvals = [approved()];
    const unmapped = convertDingtalkAttendance(source, options());
    expect(
      unmapped.pending.find((issue) => issue.code === "APPROVAL_TYPE_UNMAPPED"),
    ).toMatchObject({ mappingKey: "3:leave:annual" });
    expect(JSON.stringify(unmapped.pending)).not.toContain("fictional-process");
    expect(
      convertDingtalkAttendance(source, options()).pending.map((p) => p.code),
    ).toContain("APPROVAL_TYPE_UNMAPPED");
    const result = convertDingtalkAttendance(
      source,
      options({
        approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
      }),
    );
    expect(result.complete).toBe(true);
    expect(
      result.input.records
        .filter((r) => r.type === "paid_leave")
        .map((r) => r.hours),
    ).toEqual(["2"]);
    expect(
      result.input.records
        .filter((r) => r.type === "normal")
        .reduce((n, r) => n + Number(r.hours), 0),
    ).toBe(6);
  });
  it.each([
    "x".repeat(201),
    "fictional-process",
    "person@example.invalid",
    "13800138000",
  ])(
    "does not expose unsafe or oversized category metadata as a mapping key: %s",
    (subType) => {
      const source = read();
      source.days[0].approvals = [{ ...approved(), subType }];
      const result = convertDingtalkAttendance(source, options());
      const issue = result.pending.find(
        (row) => row.code === "APPROVAL_TYPE_UNMAPPED",
      );
      expect(result.complete).toBe(false);
      expect(issue).toBeDefined();
      expect(issue).not.toHaveProperty("mappingKey");
    },
  );
  it.each([
    "day",
    "unknown",
    "pending",
    "revoked",
    "duration_mismatch",
    "cross_day",
  ])("blocks unproven approval %s", (condition) => {
    const source = read(),
      a: any = approved();
    source.days[0].approvals = [a];
    if (condition === "day" || condition === "unknown") a.unit = condition;
    if (condition === "pending" || condition === "revoked") a.state = condition;
    if (condition === "duration_mismatch") a.duration = "8";
    if (condition === "cross_day") a.endsAt = "2026-11-03T11:00:00+08:00";
    const result = convertDingtalkAttendance(
      source,
      options({
        approvalMappings: { "3:leave:annual": { type: "unpaid_leave" } },
      }),
    );
    expect(result.complete).toBe(false);
    expect(result.pending.length).toBeGreaterThan(0);
    if (condition === "revoked")
      expect(result.input.records.some((r) => r.state === "revoked")).toBe(
        true,
      );
  });
  it("increments changed-source versions only with a newer persisted observation sequence", () => {
    const initial = convertDingtalkAttendance(read(), options());
    const changed = read();
    changed.days[0].punches[0].checkedAt = at("08:59");
    const next = convertDingtalkAttendance(
      changed,
      options({ observationVersion: 2, previous: initial.sourceState }),
    );
    expect(next.input.records.some((r) => r.sourceVersion === 2)).toBe(true);
    expect(
      convertDingtalkAttendance(
        changed,
        options({ observationVersion: 1, previous: initial.sourceState }),
      ).complete,
    ).toBe(false);
    expect(
      convertDingtalkAttendance(
        read(),
        options({ observationVersion: 1, previous: next.sourceState }),
      ).complete,
    ).toBe(false);
  });
  it("does not turn a disappeared source into a withdrawal or silently discard it", () => {
    const source = read(),
      initial = convertDingtalkAttendance(source, options());
    source.days[0].punches = [];
    source.days[0].schedule = [];
    const next = convertDingtalkAttendance(
      source,
      options({ observationVersion: 2, previous: initial.sourceState }),
    );
    expect(next.pending.map((p) => p.code)).toContain(
      "SOURCE_DISAPPEARED_UNPROVEN",
    );
    expect(next.complete).toBe(false);
    expect(next.sourceState.map((s) => s.sourceId).sort()).toEqual(
      initial.sourceState.map((s) => s.sourceId).sort(),
    );
  });
  it("rejects wrong employee/calendar scope rather than writing facts under a different HRM identity", () => {
    const source = read();
    source.days[0].employeeId = "foreign";
    const result = convertDingtalkAttendance(source, options());
    expect(result.complete).toBe(false);
    expect(result.input.records).toEqual([]);
  });
  it("does not accept another work date inside an otherwise valid day envelope", () => {
    const source = read();
    source.days[0].punches[0].workDate = "2026-11-03";
    const result = convertDingtalkAttendance(source, options());
    expect(result.complete).toBe(false);
    expect(result.input.records).toEqual([]);
  });
  it("does not turn approval-linked normal punches into normal hours without their proven approval", () => {
    const source = read();
    source.days[0].punches[0].approvalLinked = true;
    const result = convertDingtalkAttendance(source, options());
    expect(result.complete).toBe(false);
    expect(result.pending.map((p) => p.code)).toContain(
      "APPROVAL_LINK_UNPROVEN",
    );
  });
  it("keeps the source workday for a proven night shift ending in the next month", () => {
    const source = read();
    source.scope.from = source.scope.to = "2026-11-30";
    const day = source.days[0];
    day.workDate = "2026-11-30";
    day.rests = [];
    for (const [i, row] of day.schedule.entries()) {
      row.workDate = day.workDate;
      row.plannedAt = i
        ? "2026-12-01T06:00:00+08:00"
        : "2026-11-30T22:00:00+08:00";
    }
    for (const [i, row] of day.punches.entries()) {
      row.workDate = day.workDate;
      row.plannedAt = row.checkedAt = day.schedule[i].plannedAt!;
    }
    const result = convertDingtalkAttendance(
      source,
      options({
        expected: [
          { employeeId, workDate: "2026-11-30", required: true, units: "1" },
        ],
      }),
    );
    expect(result.complete).toBe(true);
    expect(
      result.input.records.map((row) => [row.workDate, row.hours]),
    ).toEqual([["2026-11-30", "8"]]);
  });
  it("requires explicit overtime classification and keeps it separate from regular hours", () => {
    const source = read();
    source.days[0].approvals = [
      {
        ...approved(),
        businessType: 1,
        tagName: "overtime",
        subType: "paid",
        startsAt: at("19:00"),
        endsAt: at("21:00"),
      },
    ];
    const mapping = { type: "overtime" as const };
    expect(
      convertDingtalkAttendance(
        source,
        options({ approvalMappings: { "1:overtime:paid": mapping } }),
      ).complete,
    ).toBe(false);
    const result = convertDingtalkAttendance(
      source,
      options({
        approvalMappings: {
          "1:overtime:paid": { ...mapping, overtimeKind: "weekday" },
        },
      }),
    );
    expect(result.complete).toBe(true);
    expect(
      result.input.records
        .filter((row) => row.type === "overtime")
        .map((row) => [row.hours, row.overtimeKind]),
    ).toEqual([["2", "weekday"]]);
    expect(
      result.input.records
        .filter((row) => row.type === "normal")
        .reduce((sum, row) => sum + Number(row.hours), 0),
    ).toBe(8);
  });
});
