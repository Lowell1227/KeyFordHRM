import { ConfigService } from "@nestjs/config";
import { DingtalkService } from "./dingtalk.service";
import {
  DingtalkAttendanceService,
  DingtalkAttendanceQuery,
} from "./dingtalk-attendance.service";
import { convertDingtalkAttendance } from "../payroll/payroll-dingtalk-attendance";

const employeeId = "00000000-0000-4000-8000-000000000001";
const operatorId = "00000000-0000-4000-8000-000000000002";
const query = (
  patch: Partial<DingtalkAttendanceQuery> = {},
): DingtalkAttendanceQuery => ({
  month: "2026-11",
  from: "2026-11-02",
  to: "2026-11-02",
  organization: { corpId: "fictional-corp", verified: true },
  operator: {
    employeeId: operatorId,
    dingtalkUserId: "fictional-hr",
    corpId: "fictional-corp",
  },
  bindings: [
    { employeeId, dingtalkUserId: "fictional-staff", corpId: "fictional-corp" },
  ],
  workflowInstanceRead: false,
  ...patch,
});
const stamp = (time: string) => Date.parse(`2026-11-02T${time}:00+08:00`);
const punch = (id: number, checkType = "OnDuty") => ({
  id,
  planId: id,
  recordId: id + 100,
  userId: "fictional-staff",
  workDate: stamp("00:00"),
  baseCheckTime: stamp(checkType === "OnDuty" ? "09:00" : "18:00"),
  userCheckTime: stamp(checkType === "OnDuty" ? "09:00" : "18:00"),
  checkType,
  timeResult: "Normal",
  locationResult: "Normal",
  sourceType: "USER",
});
const schedule = () =>
  [1, 2].map((id, index) => ({
    id,
    user_id: "fictional-staff",
    corp_id: "fictional-corp",
    work_date: "2026-11-02 00:00:00",
    check_type: index ? "OffDuty" : "OnDuty",
    class_id: 1,
    is_rest: "N",
    real_plan_time: `2026-11-02 ${index ? "18:00" : "09:00"}:00`,
    gmt_modified: "2026-11-02 08:00:00",
  }));
const approval = () => ({
  procInst_id: "fictional-process",
  biz_type: 3,
  tag_name: "leave",
  sub_type: "annual",
  begin_time: "2026-11-02 09:00:00",
  end_time: "2026-11-02 11:00:00",
  duration: "2",
  duration_unit: "hour",
  gmt_finished: "2026-11-01 12:00:00",
});

describe("DingtalkAttendanceService read-only official contracts", () => {
  let service: DingtalkAttendanceService,
    transport: jest.SpyInstance,
    token: jest.Mock;
  let list: (body: any) => any, schedules: any, detail: any, workflow: any;
  beforeEach(() => {
    token = jest.fn(async () => "fictional-token");
    service = new DingtalkAttendanceService(
      { getAccessToken: token } as unknown as DingtalkService,
      new ConfigService({ DINGTALK_CORP_ID: "fictional-corp" }),
    );
    list = () => ({
      errcode: 0,
      recordresult: [punch(1), punch(2, "OffDuty")],
      hasMore: false,
    });
    schedules = { errcode: 0, success: true, result: schedule() };
    detail = {
      errcode: 0,
      success: true,
      result: {
        corpId: "fictional-corp",
        userid: "fictional-staff",
        work_date: "2026-11-02 00:00:00",
        attendance_result_list: [],
        approve_list: [],
        class_setting_info: { rest_time_vo_list: [] },
        check_record_list: [
          { user_address: "PRIVATE", user_longitude: "PRIVATE" },
        ],
      },
    };
    workflow = {
      success: "true",
      result: {
        status: "COMPLETED",
        result: "agree",
        originatorUserId: "fictional-staff",
        bizAction: "NONE",
        title: "PRIVATE",
      },
    };
    transport = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (url: any, init?: any) => {
        const target = new URL(String(url)),
          body = init?.body ? JSON.parse(init.body) : null;
        if (target.pathname === "/attendance/list")
          return new Response(JSON.stringify(list(body)), { status: 200 });
        if (target.pathname === "/topapi/attendance/schedule/listbyday")
          return new Response(JSON.stringify(schedules), { status: 200 });
        if (target.pathname === "/topapi/attendance/getupdatedata")
          return new Response(JSON.stringify(detail), { status: 200 });
        if (target.pathname === "/v1.0/workflow/processInstances")
          return new Response(JSON.stringify(workflow), { status: 200 });
        throw new Error("Unexpected external route");
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("uses the bound operator, not the target, and projects away private detail fields", async () => {
    const result = await service.readRange(query());
    expect(result.complete).toBe(true);
    expect(result.days).toHaveLength(1);
    expect(result.pending).toEqual([]);
    const call = transport.mock.calls.find(([url]) =>
      String(url).includes("/schedule/listbyday"),
    )!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      op_user_id: "fictional-hr",
      user_id: "fictional-staff",
      date_time: stamp("00:00"),
    });
    expect(
      transport.mock.calls.every(
        ([, init]) =>
          init?.redirect === "error" && init.signal instanceof AbortSignal,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|fictional-token|fictional-staff|fictional-corp/,
    );
  });
  it.each([
    { organization: { corpId: "other", verified: true } },
    { organization: { corpId: "fictional-corp", verified: false } },
    {
      operator: {
        employeeId: operatorId,
        dingtalkUserId: "",
        corpId: "fictional-corp",
      },
    },
    { from: "2026-11-31" },
    { to: "2026-12-01" },
    { bindings: [] },
    { bindings: [query().bindings[0], query().bindings[0]] },
  ])(
    "rejects untrusted or ambiguous scope before any request: %j",
    async (patch) => {
      await expect(service.readRange(query(patch as any))).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
      expect(token).not.toHaveBeenCalled();
    },
  );
  it("splits the inclusive range into seven-day windows and follows offset plus limit", async () => {
    schedules = { errcode: 0, success: true, result: [] };
    detail = { errcode: 60011, errmsg: "PRIVATE" };
    list = (body) => ({
      errcode: 0,
      recordresult:
        body.offset === 0 && body.workDateFrom.startsWith("2026-11-01")
          ? Array.from({ length: 50 }, (_, i) => ({
              ...punch(i + 1),
              workDate: Date.parse("2026-11-01T00:00:00+08:00"),
            }))
          : [],
      hasMore: body.offset === 0 && body.workDateFrom.startsWith("2026-11-01"),
    });
    const result = await service.readRange(
      query({ from: "2026-11-01", to: "2026-11-09" }),
    );
    const calls = transport.mock.calls
      .filter(([url]) => String(url).includes("/attendance/list?"))
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(
      calls.map((b) => [b.workDateFrom, b.workDateTo, b.offset, b.limit]),
    ).toEqual([
      ["2026-11-01 00:00:00", "2026-11-07 00:00:00", 0, 50],
      ["2026-11-01 00:00:00", "2026-11-07 00:00:00", 50, 50],
      ["2026-11-08 00:00:00", "2026-11-09 00:00:00", 0, 50],
    ]);
    expect(result.complete).toBe(false);
    expect(result.pending.some((p) => p.upstreamCode === "60011")).toBe(true);
  });
  it.each([
    "duplicate",
    "empty_more",
    "foreign_person",
    "foreign_day",
    "missing_has_more",
    "oversized",
  ])("fails closed on %s punch pagination", async (kind) => {
    list = (body) => ({
      errcode: 0,
      recordresult:
        kind === "empty_more"
          ? []
          : kind === "oversized"
            ? Array.from({ length: 51 }, (_, i) => punch(i + 1))
            : [
                {
                  ...punch(1),
                  ...(kind === "foreign_person" ? { userId: "foreign" } : {}),
                  ...(kind === "foreign_day"
                    ? { workDate: Date.parse("2026-11-03T00:00:00+08:00") }
                    : {}),
                },
              ],
      ...(kind === "missing_has_more"
        ? {}
        : { hasMore: kind === "duplicate" || kind === "empty_more" }),
    });
    const result = await service.readRange(query());
    expect(result.complete).toBe(false);
    expect(result.pending.length).toBeGreaterThan(0);
    expect(
      transport.mock.calls.filter(([url]) =>
        String(url).includes("/attendance/list?"),
      ).length,
    ).toBeLessThanOrEqual(2);
  });
  it("does not treat an existing approval or its finish time as permission or terminal approval", async () => {
    detail.result.approve_list = [approval()];
    const result = await service.readRange(query());
    expect(result.complete).toBe(false);
    expect(result.pending.map((p) => p.code)).toContain(
      "WORKFLOW_PERMISSION_UNCONFIRMED",
    );
    expect(result.days[0].approvals[0].state).toBe("pending");
    expect(
      transport.mock.calls.some(([url]) => String(url).includes("/workflow/")),
    ).toBe(false);
  });
  it.each([
    ["COMPLETED", "agree", "NONE", "approved"],
    ["RUNNING", "agree", "NONE", "pending"],
    ["COMPLETED", "refuse", "NONE", "pending"],
    ["TERMINATED", "agree", "NONE", "cancelled"],
    ["COMPLETED", "agree", "REVOKE", "pending"],
    ["COMPLETED", "agree", "MODIFY", "pending"],
  ])(
    "checks terminal workflow state %s/%s/%s",
    async (status, result, bizAction, state) => {
      detail.result.approve_list = [approval()];
      workflow.result = { ...workflow.result, status, result, bizAction };
      const read = await service.readRange(
        query({ workflowInstanceRead: true }),
      );
      expect(read.days[0].approvals[0].state).toBe(state);
      const call = transport.mock.calls.find(([url]) =>
        String(url).includes("/workflow/"),
      )!;
      expect(call[1]!.method).toBe("GET");
      expect(call[1]!.headers).toMatchObject({
        "x-acs-dingtalk-access-token": "fictional-token",
      });
      expect(
        new URL(String(call[0])).searchParams.get("processInstanceId"),
      ).toBe("fictional-process");
    },
  );
  it("proves a terminal cancellation without making an otherwise complete normal day pending", async () => {
    detail.result.approve_list = [approval()];
    workflow.result.status = "TERMINATED";
    const result = await service.readRange(
      query({ workflowInstanceRead: true }),
    );
    expect(result.complete).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.days[0].approvals[0]).toMatchObject({
      state: "cancelled",
      terminalProof: {
        status: "TERMINATED",
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    const converted = convertDingtalkAttendance(result, {
      expected: [
        { employeeId, workDate: "2026-11-02", required: true, units: "1" },
      ],
      observationVersion: 1,
      previous: [],
      approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
    });
    expect(converted.complete).toBe(true);
    expect(
      converted.input.records.some((row) => row.state === "cancelled"),
    ).toBe(true);
    expect(
      JSON.stringify(converted.sourceState.map((row) => row.proof)),
    ).not.toMatch(/fictional-staff|fictional-process|PRIVATE/);
  });
  it("keeps workflow permission failure pending without leaking upstream messages", async () => {
    detail.result.approve_list = [approval()];
    transport.mockImplementationOnce(
      async () => new Response(JSON.stringify(list({})), { status: 200 }),
    );
    const fallback = transport.getMockImplementation()!;
    transport.mockImplementation(async (url: any, init?: any) =>
      String(url).includes("/workflow/")
        ? new Response(
            JSON.stringify({
              code: "Forbidden.AccessDenied.AccessTokenPermissionDenied",
              message: "PRIVATE fictional-token",
            }),
            { status: 403 },
          )
        : fallback(url, init),
    );
    const read = await service.readRange(query({ workflowInstanceRead: true }));
    expect(read.complete).toBe(false);
    expect(read.pending.some((p) => p.httpStatus === 403)).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/PRIVATE|fictional-token/);
  });
  it("rejects organization/person mismatches in the daily response", async () => {
    detail.result.corpId = "foreign";
    const read = await service.readRange(query());
    expect(read.complete).toBe(false);
    expect(read.pending.map((p) => p.code)).toContain(
      "RESPONSE_SCOPE_MISMATCH",
    );
  });
  it("never treats check_date_time as a plan when no matching authoritative card is available", async () => {
    list = () => ({ errcode: 0, recordresult: [], hasMore: false });
    for (const row of schedules.result) {
      delete row.real_plan_time;
      row.check_date_time = "2026-11-02 10:17:00";
    }
    const result = await service.readRange(query());
    expect(result.complete).toBe(false);
    expect(result.pending.map((p) => p.code)).toContain(
      "SCHEDULE_PLAN_UNPROVEN",
    );
    expect(result.days[0].schedule.every((row) => row.plannedAt === null)).toBe(
      true,
    );
  });
  it("uses matching planId and card baseCheckTime, not the employee check time, when real_plan_time is absent", async () => {
    for (const row of schedules.result) {
      delete row.real_plan_time;
      row.check_date_time = "2026-11-02 10:17:00";
    }
    const result = await service.readRange(query());
    expect(result.complete).toBe(true);
    expect(result.days[0].schedule.map((row) => row.plannedAt)).toEqual([
      "2026-11-02T01:00:00.000Z",
      "2026-11-02T10:00:00.000Z",
    ]);
  });
  it("uses daily plan_check_time only for the same planId and card, and rejects conflicting planned times", async () => {
    list = () => ({ errcode: 0, recordresult: [], hasMore: false });
    delete schedules.result[0].real_plan_time;
    detail.result.attendance_result_list = [
      {
        plan_id: 1,
        check_type: "OnDuty",
        plan_check_time: "2026-11-02 09:00:00",
      },
    ];
    expect(
      (await service.readRange(query())).days[0].schedule[0].plannedAt,
    ).toBe("2026-11-02T01:00:00.000Z");
    schedules.result[0].real_plan_time = "2026-11-02 09:30:00";
    const conflict = await service.readRange(query());
    expect(conflict.complete).toBe(false);
    expect(conflict.pending.map((p) => p.code)).toContain(
      "SCHEDULE_PLAN_CONFLICT",
    );
  });
  it("accepts a numeric approval link only when planId, scheduleId and the same daily workflow reference all agree", async () => {
    list = () => ({
      errcode: 0,
      recordresult: [
        {
          ...punch(1),
          approveId: 7,
          procInstId: "fictional-process",
          sourceType: "APPROVE",
        },
        punch(2, "OffDuty"),
      ],
      hasMore: false,
    });
    schedules.result[0].approve_id = 7;
    detail.result.approve_list = [approval()];
    detail.result.attendance_result_list = [
      {
        plan_id: 1,
        check_type: "OnDuty",
        plan_check_time: "2026-11-02 09:00:00",
        procInst_id: "fictional-process",
      },
    ];
    const confirmed = await service.readRange(
      query({ workflowInstanceRead: true }),
    );
    expect(confirmed.complete).toBe(true);
    const converted = convertDingtalkAttendance(confirmed, {
      observationVersion: 1,
      previous: [],
      expected: [
        { employeeId, workDate: "2026-11-02", required: true, units: "1" },
      ],
      approvalMappings: { "3:leave:annual": { type: "paid_leave" } },
    });
    expect(converted.complete).toBe(true);
    expect(
      converted.input.records
        .filter((row) => row.type === "paid_leave")
        .map((row) => row.hours),
    ).toEqual(["2"]);
    expect(
      converted.input.records
        .filter((row) => row.type === "normal")
        .reduce((sum, row) => sum + Number(row.hours), 0),
    ).toBe(7);
    schedules.result[0].approve_id = 8;
    const mismatch = await service.readRange(
      query({ workflowInstanceRead: true }),
    );
    expect(mismatch.complete).toBe(false);
    expect(mismatch.pending.map((p) => p.code)).toContain(
      "APPROVAL_LINK_UNPROVEN",
    );
  });
  it.each(["MODIFY", "REVOKE"])(
    "requires the main workflow final state for %s, rather than rejecting or accepting the link flag alone",
    async (bizAction) => {
      detail.result.approve_list = [approval()];
      workflow.result.bizAction = bizAction;
      workflow.result.mainProcessInstanceId = "fictional-main";
      const fallback = transport.getMockImplementation()!;
      transport.mockImplementation(async (url: any, init?: any) =>
        new URL(String(url)).searchParams.get("processInstanceId") ===
        "fictional-main"
          ? new Response(
              JSON.stringify({
                success: true,
                result: {
                  status: "COMPLETED",
                  result: "agree",
                  originatorUserId: "fictional-staff",
                  bizAction: "NONE",
                },
              }),
              { status: 200 },
            )
          : fallback(url, init),
      );
      const result = await service.readRange(
        query({ workflowInstanceRead: true }),
      );
      expect(result.days[0].approvals[0].state).toBe("approved");
      expect(result.complete).toBe(true);
    },
  );
  it("does not use a completed child when its main workflow is running or cyclic", async () => {
    detail.result.approve_list = [approval()];
    workflow.result.bizAction = "MODIFY";
    workflow.result.mainProcessInstanceId = "fictional-main";
    const fallback = transport.getMockImplementation()!;
    transport.mockImplementation(async (url: any, init?: any) =>
      new URL(String(url)).searchParams.get("processInstanceId") ===
      "fictional-main"
        ? new Response(
            JSON.stringify({
              success: true,
              result: {
                status: "RUNNING",
                result: "agree",
                originatorUserId: "fictional-staff",
              },
            }),
            { status: 200 },
          )
        : fallback(url, init),
    );
    const result = await service.readRange(
      query({ workflowInstanceRead: true }),
    );
    expect(result.complete).toBe(false);
    expect(result.days[0].approvals[0].state).toBe("pending");
  });
  it("cuts off cyclic main-workflow links without refetching the same instance", async () => {
    detail.result.approve_list = [approval()];
    workflow.result.bizAction = "MODIFY";
    workflow.result.mainProcessInstanceId = "fictional-main";
    const fallback = transport.getMockImplementation()!;
    transport.mockImplementation(async (url: any, init?: any) =>
      new URL(String(url)).searchParams.get("processInstanceId") ===
      "fictional-main"
        ? new Response(
            JSON.stringify({
              success: true,
              result: {
                status: "COMPLETED",
                result: "agree",
                originatorUserId: "fictional-staff",
                bizAction: "MODIFY",
                mainProcessInstanceId: "fictional-process",
              },
            }),
            { status: 200 },
          )
        : fallback(url, init),
    );
    const result = await service.readRange(
      query({ workflowInstanceRead: true }),
    );
    expect(result.pending.map((p) => p.code)).toContain(
      "APPROVAL_CHAIN_UNPROVEN",
    );
    expect(result.complete).toBe(false);
    expect(
      transport.mock.calls.filter(([url]) =>
        String(url).includes("/workflow/"),
      ),
    ).toHaveLength(2);
  });
  it("splits more than 50 explicit bound people without discovering or substituting any personnel", async () => {
    const bindings = Array.from({ length: 51 }, (_, i) => ({
      employeeId: `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
      dingtalkUserId: `fictional-${i}`,
      corpId: "fictional-corp",
    }));
    transport.mockImplementation(async (url: any, init?: any) => {
      const path = new URL(String(url)).pathname,
        body = JSON.parse(init.body);
      if (path === "/attendance/list")
        return new Response(
          JSON.stringify({ errcode: 0, recordresult: [], hasMore: false }),
        );
      if (path.endsWith("/listbyday"))
        return new Response(
          JSON.stringify({
            errcode: 0,
            success: true,
            result: schedule().map((row) => ({
              ...row,
              user_id: body.user_id,
            })),
          }),
        );
      if (path.endsWith("/getupdatedata"))
        return new Response(
          JSON.stringify({
            ...detail,
            result: { ...detail.result, userid: body.userid },
          }),
        );
      throw new Error("Forbidden discovery route");
    });
    const result = await service.readRange(query({ bindings }));
    expect(result.days).toHaveLength(51);
    const requests = transport.mock.calls
      .filter(([url]) => String(url).includes("/attendance/list?"))
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(requests.map((body) => body.userIdList.length)).toEqual([50, 1]);
    expect(requests.flatMap((body) => body.userIdList)).toEqual(
      bindings.map((row) => row.dingtalkUserId),
    );
  });
  it("rejects a truthy non-boolean organization confirmation before using the token", async () => {
    await expect(
      service.readRange(
        query({
          organization: { corpId: "fictional-corp", verified: "yes" } as any,
        }),
      ),
    ).rejects.toThrow();
    expect(token).not.toHaveBeenCalled();
  });
  it("does not call empty schedule and punch results complete coverage or a rest day", async () => {
    list = () => ({ errcode: 0, recordresult: [], hasMore: false });
    schedules.result = [];
    const result = await service.readRange(query());
    expect(result.complete).toBe(false);
    expect(result.pending.map((p) => p.code)).toContain("SCHEDULE_NOT_PROVEN");
  });
  it("applies the shared deadline to a stalled token without exposing its error", async () => {
    jest.useFakeTimers();
    token.mockImplementation(() => new Promise(() => undefined));
    const pending = service.readRange(query());
    await jest.advanceTimersByTimeAsync(10001);
    // Every failed range is returned as incomplete; no real request is retried.
    await jest.runAllTimersAsync();
    const read = await pending;
    expect(read.complete).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
