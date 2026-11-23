import { DingtalkAttendanceRead } from "../dingtalk/dingtalk-attendance.service";
import { normalizeAttendance } from "./payroll-attendance-normalizer";
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
  it.each([1, 5, 10])(
    "retains a proven %s-minute Late interval without failing finite-decimal representation",
    (minutes) => {
      const source = read();
      source.days[0].punches[0].result = "Late";
      source.days[0].punches[0].checkedAt = at(
        `09:${String(minutes).padStart(2, "0")}`,
      );
      const result = convertDingtalkAttendance(source, options());
      expect(result.complete).toBe(true);
      expect(result.pending).toEqual([]);
      const late = result.input.records.filter((row) => row.type === "late");
      expect(late).toHaveLength(1);
      expect(late[0]).toMatchObject({
        startsAt: "2026-11-02T01:00:00.000Z",
        endsAt: `2026-11-02T01:${String(minutes).padStart(2, "0")}:00.000Z`,
      });
      expect(Number(late[0].hours)).toBeCloseTo(minutes / 60, 14);
      expect(
        result.input.records.reduce((sum, row) => sum + Number(row.hours), 0),
      ).toBeCloseTo(8, 12);
      expect(normalizeAttendance(result.input).issues).toEqual([]);
    },
  );
  it("replays normal to full leave to terminal cancellation after a JSON persistence round trip", () => {
    const mapped = { "3:leave:annual": { type: "paid_leave" as const } };
    const first = convertDingtalkAttendance(read(), options());
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const leave = convertDingtalkAttendance(
      source,
      options({
        previous: JSON.parse(JSON.stringify(first.sourceState)),
        observationVersion: 2,
        approvalMappings: mapped,
      }),
    );
    expect(leave.complete).toBe(true);
    source.days[0].approvals = [
      {
        ...source.days[0].approvals[0],
        state: "cancelled",
        terminalProof: { status: "TERMINATED", fingerprint: "a".repeat(64) },
      } as any,
    ];
    const cancelled = convertDingtalkAttendance(
      source,
      options({
        previous: JSON.parse(JSON.stringify(leave.sourceState)),
        observationVersion: 3,
        approvalMappings: mapped,
      }),
    );
    expect(cancelled.complete).toBe(true);
    expect(
      normalizeAttendance({
        ...cancelled.input,
        records: [
          ...first.input.records,
          ...leave.input.records,
          ...cancelled.input.records,
        ],
      }).issues,
    ).toEqual([]);
    const replay = convertDingtalkAttendance(
      source,
      options({
        previous: cancelled.sourceState,
        observationVersion: 4,
        approvalMappings: mapped,
      }),
    );
    expect(replay.sourceState).toEqual(cancelled.sourceState);
    expect(replay.complete).toBe(true);
  });
  it("does not auto-retire legacy normal records whose derivation proof was not persisted", () => {
    const first = convertDingtalkAttendance(read(), options());
    const legacy = first.sourceState.map(({ proof, ...source }) => source);
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const result = convertDingtalkAttendance(
      source,
      options({
        previous: legacy,
        observationVersion: 2,
        approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
      }),
    );
    expect(result.complete).toBe(false);
    expect(result.pending.map((row) => row.code)).toContain(
      "SOURCE_DISAPPEARED_UNPROVEN",
    );
  });
  it("keeps a first-observed terminal cancellation stable on repeated sync", () => {
    const source = read();
    source.days[0].approvals = [
      {
        ...approved(),
        state: "cancelled",
        terminalProof: { status: "TERMINATED", fingerprint: "a".repeat(64) },
      } as any,
    ];
    const mapped = { "3:leave:annual": { type: "paid_leave" as const } };
    const first = convertDingtalkAttendance(
      source,
      options({ approvalMappings: mapped }),
    );
    expect(first.complete).toBe(true);
    const replay = convertDingtalkAttendance(
      source,
      options({
        previous: first.sourceState,
        observationVersion: 2,
        approvalMappings: mapped,
      }),
    );
    expect(replay.complete).toBe(true);
    expect(replay.sourceState).toEqual(first.sourceState);
  });
  it("does not equate a disappeared external leave with a superseded derived normal fact", () => {
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const mapped = { "3:leave:annual": { type: "paid_leave" as const } };
    const first = convertDingtalkAttendance(
      source,
      options({ approvalMappings: mapped }),
    );
    const next = convertDingtalkAttendance(
      read(),
      options({
        previous: first.sourceState,
        observationVersion: 2,
        approvalMappings: mapped,
      }),
    );
    expect(next.complete).toBe(false);
    expect(next.pending.map((row) => row.code)).toContain(
      "SOURCE_DISAPPEARED_UNPROVEN",
    );
    expect(next.input.records.some((row) => row.state === "cancelled")).toBe(
      false,
    );
  });
  it("cannot version a replacement tombstone using the same persisted observation", () => {
    const first = convertDingtalkAttendance(read(), options());
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const result = convertDingtalkAttendance(
      source,
      options({
        previous: first.sourceState,
        approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
      }),
    );
    expect(result.complete).toBe(false);
    expect(result.pending.map((row) => row.code)).toContain(
      "SOURCE_VERSION_NOT_NEWER",
    );
  });
  it("requires offset-qualified actual punch times for Late facts", () => {
    const source = read();
    source.days[0].punches[0].result = "Late";
    source.days[0].punches[0].checkedAt = "2026-11-02T10:00:00";
    expect(convertDingtalkAttendance(source, options()).complete).toBe(false);
  });
  it("versions obsolete derived normal facts when an approved full-day leave replaces them, including replay", () => {
    const initial = convertDingtalkAttendance(read(), options());
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const mapped = { "3:leave:annual": { type: "paid_leave" as const } };
    const next = convertDingtalkAttendance(
      source,
      options({
        previous: initial.sourceState,
        observationVersion: 2,
        approvalMappings: mapped,
      }),
    );
    expect(next.complete).toBe(true);
    expect(
      next.input.records.filter((row) => row.state === ("superseded" as any)),
    ).toHaveLength(2);
    for (const prior of initial.sourceState) {
      expect(
        next.sourceState.find((row) => row.sourceId === prior.sourceId),
      ).toMatchObject({
        sourceVersion: 2,
        record: { state: "superseded" },
        proof: { kind: "superseded-normal" },
      });
    }
    expect(
      normalizeAttendance({
        ...next.input,
        records: [...initial.input.records, ...next.input.records],
      }).issues,
    ).toEqual([]);
    const replay = convertDingtalkAttendance(
      source,
      options({
        previous: next.sourceState,
        observationVersion: 3,
        approvalMappings: mapped,
      }),
    );
    expect(replay.complete).toBe(true);
    expect(replay.sourceState).toEqual(next.sourceState);
  });
  it("does not retire a derived normal source without complete current-day proof", () => {
    const initial = convertDingtalkAttendance(read(), options());
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    source.days[0].complete = false;
    const next = convertDingtalkAttendance(
      source,
      options({
        previous: initial.sourceState,
        observationVersion: 2,
        approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
      }),
    );
    expect(next.complete).toBe(false);
    expect(next.pending.map((row) => row.code)).toContain(
      "SOURCE_DISAPPEARED_UNPROVEN",
    );
    expect(
      next.input.records.some((row) => row.state === ("superseded" as any)),
    ).toBe(false);
  });
  it("versions a terminal-cancelled leave and restores normal coverage without weakening old revoked facts", () => {
    const source = read();
    source.days[0].approvals = [
      { ...approved(), endsAt: at("18:00"), duration: "8" },
    ];
    const mapped = { "3:leave:annual": { type: "paid_leave" as const } };
    const initial = convertDingtalkAttendance(
      source,
      options({ approvalMappings: mapped }),
    );
    source.days[0].approvals = [
      {
        ...source.days[0].approvals[0],
        state: "cancelled",
        terminalProof: { status: "TERMINATED", fingerprint: "a".repeat(64) },
      } as any,
    ];
    const next = convertDingtalkAttendance(
      source,
      options({
        previous: initial.sourceState,
        observationVersion: 2,
        approvalMappings: mapped,
      }),
    );
    expect(next.complete).toBe(true);
    expect(
      next.input.records.filter((row) => row.state === ("cancelled" as any)),
    ).toHaveLength(2);
    expect(
      next.input.records
        .filter((row) => row.type === "normal")
        .reduce((sum, row) => sum + Number(row.hours), 0),
    ).toBe(8);
    expect(
      normalizeAttendance({
        ...next.input,
        records: [...initial.input.records, ...next.input.records],
      }).issues,
    ).toEqual([]);
    const replay = convertDingtalkAttendance(
      source,
      options({
        previous: next.sourceState,
        observationVersion: 3,
        approvalMappings: mapped,
      }),
    );
    expect(replay.complete).toBe(true);
    expect(replay.sourceState).toEqual(next.sourceState);
    source.days[0].approvals = [];
    const later = convertDingtalkAttendance(
      source,
      options({
        previous: replay.sourceState,
        observationVersion: 4,
        approvalMappings: mapped,
      }),
    );
    expect(later.complete).toBe(true);
    expect(
      later.input.records.some((row) => row.state === ("cancelled" as any)),
    ).toBe(true);
  });
  it.each(["no_proof", "missing_punch"])(
    "does not accept cancelled approval without %s coverage",
    (condition) => {
      const source = read();
      source.days[0].approvals = [
        {
          ...approved(),
          state: "cancelled",
          ...(condition === "no_proof"
            ? {}
            : {
                terminalProof: {
                  status: "TERMINATED",
                  fingerprint: "a".repeat(64),
                },
              }),
        } as any,
      ];
      if (condition === "missing_punch") source.days[0].punches = [];
      expect(
        convertDingtalkAttendance(
          source,
          options({
            approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
          }),
        ).complete,
      ).toBe(false);
    },
  );
  it.each([
    ["Late", "14:00", "18:00", "4", "0", "4"],
    ["Early", "09:00", "11:00", "0", "6", "2"],
    ["Both", "11:00", "14:00", "2", "4", "2"],
    ["Late", "12:30", "18:00", "3", "0", "5"],
    ["Early", "09:00", "12:30", "0", "5", "3"],
  ])(
    "splits proven %s punches around rests into late/early and normal facts",
    (kind, on, off, late, early, normal) => {
      const source = read();
      source.days[0].punches[0].checkedAt = at(on);
      source.days[0].punches[1].checkedAt = at(off);
      if (kind !== "Early") source.days[0].punches[0].result = "Late";
      if (kind !== "Late") source.days[0].punches[1].result = "Early";
      const initial = convertDingtalkAttendance(read(), options());
      const result = convertDingtalkAttendance(
        source,
        options({ previous: initial.sourceState, observationVersion: 2 }),
      );
      expect(result.complete).toBe(true);
      const total = (type: string) =>
        String(
          result.input.records
            .filter((row) => row.type === type && row.state === "effective")
            .reduce((sum, row) => sum + Number(row.hours), 0),
        );
      expect([total("late"), total("early"), total("normal")]).toEqual([
        late,
        early,
        normal,
      ]);
      expect(
        normalizeAttendance({
          ...result.input,
          records: [...initial.input.records, ...result.input.records],
        }).issues,
      ).toEqual([]);
    },
  );
  it.each([
    "unknown",
    "wrong_card",
    "missing_time",
    "outside_shift",
    "crossed_punches",
  ])("keeps %s punch facts pending", (condition) => {
    const source = read(),
      [on, off] = source.days[0].punches;
    on.result = "Late";
    on.checkedAt = at("10:00");
    if (condition === "unknown") on.result = "SeriousLate";
    if (condition === "wrong_card") off.result = "Late";
    if (condition === "missing_time") on.checkedAt = null;
    if (condition === "outside_shift") on.checkedAt = at("19:00");
    if (condition === "crossed_punches") {
      off.result = "Early";
      off.checkedAt = at("09:30");
    }
    expect(convertDingtalkAttendance(source, options()).complete).toBe(false);
  });
  it("retains a configurable 89-character mapping key and enforces total 200 / segment 190 limits", () => {
    const source = read();
    source.days[0].approvals = [{ ...approved(), subType: "x".repeat(81) }];
    const result = convertDingtalkAttendance(source, options());
    expect(result.complete).toBe(false);
    expect(result.pending).toContainEqual(
      expect.objectContaining({
        code: "APPROVAL_TYPE_UNMAPPED",
        mappingKey: `3:leave:${"x".repeat(81)}`,
      }),
    );
    source.days[0].approvals = [
      { ...approved(), tagName: "tagname", subType: "x".repeat(190) },
    ];
    expect(convertDingtalkAttendance(source, options()).pending).toContainEqual(
      expect.objectContaining({
        code: "APPROVAL_TYPE_UNMAPPED",
        mappingKey: `3:tagname:${"x".repeat(190)}`,
      }),
    );
    source.days[0].approvals[0].tagName = "tagnames";
    const tooLong = convertDingtalkAttendance(source, options());
    expect(tooLong.pending.some((row) => row.mappingKey)).toBe(false);
    expect(tooLong.pending.map((row) => row.code)).toContain(
      "APPROVAL_MAPPING_KEY_UNSUPPORTED",
    );
    source.days[0].approvals = [{ ...approved(), subType: "x".repeat(191) }];
    expect(
      convertDingtalkAttendance(source, options()).pending.some(
        (row) => row.mappingKey,
      ),
    ).toBe(false);
  });
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
