import { Inject } from '@nestjs/common';
import { RuntimeSettingsService } from '@/system-configuration/runtime-settings.service';
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { isUUID } from "class-validator";
import { DingtalkIdentity, DingtalkService } from "./dingtalk.service";
import {
  DingtalkDeadlineError,
  withDingtalkDeadline,
} from "./dingtalk-request-deadline";

export interface DingtalkAttendanceBinding {
  employeeId: string;
  dingtalkUserId: string;
  corpId: string;
}
export interface DingtalkAttendanceQuery {
  month: string;
  from: string;
  to: string;
  organization: { corpId: string; verified: true };
  /** The authenticated HRM operator's confirmed binding, never inferred from the target person. */
  operator: DingtalkAttendanceBinding;
  bindings: DingtalkAttendanceBinding[];
  workflowInstanceRead?: boolean;
}
export interface DingtalkAttendancePending {
  code: string;
  employeeId?: string;
  workDate?: string;
  endpoint?: string;
  httpStatus?: number;
  upstreamCode?: string;
  mappingKey?: string;
}
export interface DingtalkAttendancePunch {
  id: string;
  planId: string;
  workDate: string;
  checkType: string;
  plannedAt: string;
  checkedAt: string | null;
  result: string;
  location: string;
  approvalLinked: boolean;
  processInstanceId?: string;
  approvalId?: string;
}
export interface DingtalkAttendanceSchedule {
  id: string;
  classId: string;
  workDate: string;
  checkType: string;
  plannedAt: string | null;
  isRest: boolean;
  approvalLinked: boolean;
  approvalId?: string;
}
export interface DingtalkAttendanceApproval {
  processInstanceId: string;
  businessType: number | null;
  tagName: string;
  subType: string;
  startsAt: string | null;
  endsAt: string | null;
  duration: string | null;
  unit: string | null;
  state: "approved" | "pending" | "revoked" | "cancelled";
  terminalProof?: { status: "TERMINATED"; fingerprint: string };
}
export interface DingtalkAttendanceDay {
  employeeId: string;
  workDate: string;
  complete: boolean;
  punches: DingtalkAttendancePunch[];
  schedule: DingtalkAttendanceSchedule[];
  approvals: DingtalkAttendanceApproval[];
  restsKnown: boolean;
  rests: Array<{ startsAt: string; endsAt: string }>;
}
export interface DingtalkAttendanceRead {
  month: string;
  organizationKey: string;
  scope: { employeeIds: string[]; from: string; to: string };
  days: DingtalkAttendanceDay[];
  pending: DingtalkAttendancePending[];
  complete: boolean;
}

type Json = Record<string, any>;
class ReadFailure extends Error {
  constructor(readonly issue: DingtalkAttendancePending) {
    super(issue.code);
  }
}
const failure = (code: string): never => {
  throw new ReadFailure({ code });
};
const object = (raw: unknown): Json =>
  raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Json)
    : failure("RESPONSE_INVALID");
const text = (raw: unknown): string | null =>
  typeof raw === "string" && !!raw.trim() && raw.length <= 200
    ? raw.trim()
    : null;
const sourceId = (raw: unknown): string =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? String(raw)
    : typeof raw === "string" && /^\d{1,20}$/.test(raw)
      ? raw
      : failure("SOURCE_ID_INVALID");
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const localDay = (iso: string) =>
  new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
function timestamp(raw: unknown): string | null {
  if (typeof raw === "number")
    return Number.isSafeInteger(raw) && raw > 0 && raw <= 8640000000000000
      ? new Date(raw).toISOString()
      : null;
  if (typeof raw !== "string") return null;
  const date = raw.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    return null;
  const value = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(raw)
    ? raw.replace(" ", "T") + "+08:00"
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
          raw,
        )
      ? raw
      : null;
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function dateOf(raw: unknown): string {
  const value = timestamp(raw);
  return value ? localDay(value) : failure("WORK_DATE_INVALID");
}
function dates(from: string, to: string): string[] {
  const result: string[] = [];
  for (
    let value = Date.parse(`${from}T00:00:00Z`);
    value <= Date.parse(`${to}T00:00:00Z`);
    value += 86400000
  )
    result.push(new Date(value).toISOString().slice(0, 10));
  return result;
}

@Injectable()
export class DingtalkAttendanceService {
  constructor(
    private readonly dingtalk: DingtalkService,
    @Inject(RuntimeSettingsService) private readonly config: ConfigService,
  ) {}
  async readRange(
    query: DingtalkAttendanceQuery,
    identity: DingtalkIdentity = Object.freeze({ appKey: this.config.get<string>('DINGTALK_APP_KEY'), appSecret: this.config.get<string>('DINGTALK_APP_SECRET'), corpId: this.config.get<string>('DINGTALK_CORP_ID') }),
  ): Promise<DingtalkAttendanceRead> {
    this.validate(query, identity.corpId);
    const workDates = dates(query.from, query.to),
      pending: DingtalkAttendancePending[] = [];
    const days: DingtalkAttendanceDay[] = query.bindings.flatMap((binding) =>
      workDates.map((workDate) => ({
        employeeId: binding.employeeId,
        workDate,
        complete: false,
        punches: [],
        schedule: [],
        approvals: [],
        restsKnown: false,
        rests: [],
      })),
    );
    const dayMap = new Map(
      days.map((day) => [`${day.employeeId}:${day.workDate}`, day]),
    );
    const blocked = new Map<string, DingtalkAttendancePending>();
    const request = async (path: string, body: Json | null): Promise<Json> => {
      if (blocked.has(path)) throw new ReadFailure(blocked.get(path)!);
      try {
        return await this.request(path, body, identity);
      } catch (error) {
        if (
          error instanceof ReadFailure &&
          (error.issue.httpStatus === 403 ||
            /60011|60020|PermissionDenied/.test(error.issue.upstreamCode ?? ""))
        )
          blocked.set(path, error.issue);
        throw error;
      }
    };
    const note = (
      error: unknown,
      endpoint: string,
      day?: DingtalkAttendanceDay,
    ) => {
      pending.push({
        ...(error instanceof ReadFailure
          ? error.issue
          : { code: "READ_FAILED" }),
        endpoint,
        ...(day ? { employeeId: day.employeeId, workDate: day.workDate } : {}),
      });
      if (day) day.complete = false;
    };
    // The official list endpoint caps both persons and rows at 50, and dates at seven inclusive days.
    for (let person = 0; person < query.bindings.length; person += 50)
      for (let start = 0; start < workDates.length; start += 7) {
        const bindings = query.bindings.slice(person, person + 50),
          window = workDates.slice(start, start + 7);
        const members = new Map(
          bindings.map((binding) => [
            binding.dingtalkUserId,
            binding.employeeId,
          ]),
        );
        const accepted: Array<{
            employeeId: string;
            punch: DingtalkAttendancePunch;
          }> = [],
          seen = new Set<string>();
        try {
          for (let page = 0; ; page++) {
            if (page >= 200) failure("PAGINATION_LIMIT");
            const data = await request("/attendance/list", {
              workDateFrom: `${window[0]} 00:00:00`,
              workDateTo: `${window.at(-1)} 00:00:00`,
              userIdList: [...members.keys()],
              offset: page * 50,
              limit: 50,
              isI18n: false,
            });
            if (
              !Array.isArray(data.recordresult) ||
              data.recordresult.length > 50 ||
              typeof data.hasMore !== "boolean"
            )
              failure("PAGINATION_INVALID");
            if (data.hasMore && !data.recordresult.length)
              failure("PAGINATION_STALLED");
            for (const raw of data.recordresult) {
              const row = object(raw),
                employeeId = members.get(row.userId),
                workDate = dateOf(row.workDate);
              if (!employeeId || !window.includes(workDate))
                failure("RESPONSE_SCOPE_MISMATCH");
              if (row.timeZoneId && row.timeZoneId !== "Asia/Shanghai")
                failure("TIMEZONE_UNSUPPORTED");
              const id = sourceId(row.id),
                key = `${employeeId}:${id}`;
              if (seen.has(key)) failure("PAGINATION_DUPLICATE");
              seen.add(key);
              const plannedAt = timestamp(row.baseCheckTime);
              if (
                !plannedAt ||
                !["OnDuty", "OffDuty"].includes(row.checkType) ||
                !text(row.timeResult) ||
                !text(row.locationResult)
              )
                failure("PUNCH_INVALID");
              accepted.push({
                employeeId: employeeId!,
                punch: {
                  id,
                  planId: sourceId(row.planId),
                  workDate,
                  checkType: row.checkType,
                  plannedAt: plannedAt!,
                  checkedAt: timestamp(row.userCheckTime),
                  result: row.timeResult,
                  location: row.locationResult,
                  approvalLinked:
                    !!row.approveId ||
                    !!row.procInstId ||
                    row.sourceType === "APPROVE",
                  ...(row.approveId
                    ? { approvalId: sourceId(row.approveId) }
                    : {}),
                  ...(text(row.procInstId)
                    ? { processInstanceId: row.procInstId }
                    : {}),
                },
              });
            }
            if (!data.hasMore) break;
          }
          for (const binding of bindings)
            for (const date of window)
              dayMap.get(`${binding.employeeId}:${date}`)!.complete = true;
          for (const entry of accepted)
            dayMap
              .get(`${entry.employeeId}:${entry.punch.workDate}`)!
              .punches.push(entry.punch);
        } catch (error) {
          note(error, "punches");
        }
      }
    const workflow = new Map<string, Json | ReadFailure>();
    const workflowState = async (
      id: string,
      userId: string,
      visited = new Set<string>(),
    ): Promise<DingtalkAttendanceApproval["state"]> => {
      if (visited.has(id) || visited.size >= 5)
        failure("APPROVAL_CHAIN_UNPROVEN");
      visited.add(id);
      if (!workflow.has(id)) {
        try {
          workflow.set(
            id,
            object(
              (
                await request("/v1.0/workflow/processInstances", {
                  processInstanceId: id,
                })
              ).result,
            ),
          );
        } catch (error) {
          workflow.set(
            id,
            error instanceof ReadFailure
              ? error
              : new ReadFailure({ code: "WORKFLOW_READ_FAILED" }),
          );
        }
      }
      const instance = workflow.get(id)!;
      if (instance instanceof ReadFailure) throw instance;
      if (
        instance.originatorUserId !== userId ||
        (instance.processInstanceId && instance.processInstanceId !== id)
      )
        failure("APPROVAL_PERSON_MISMATCH");
      if (instance.status === "TERMINATED") return "cancelled";
      if (instance.status !== "COMPLETED" || instance.result !== "agree")
        failure("APPROVAL_TERMINAL_STATE_UNPROVEN");
      const main = text(instance.mainProcessInstanceId);
      if (["MODIFY", "REVOKE"].includes(instance.bizAction) && !main)
        failure("APPROVAL_CHAIN_UNPROVEN");
      if (
        main &&
        main !== id &&
        (await workflowState(main, userId, visited)) !== "approved"
      )
        failure("APPROVAL_CHAIN_UNPROVEN");
      return "approved";
    };
    for (const binding of query.bindings)
      for (const workDate of workDates) {
        const day = dayMap.get(`${binding.employeeId}:${workDate}`)!;
        try {
          const data = await request("/topapi/attendance/schedule/listbyday", {
            op_user_id: query.operator.dingtalkUserId,
            user_id: binding.dingtalkUserId,
            date_time: Date.parse(`${workDate}T00:00:00+08:00`),
          });
          if (!Array.isArray(data.result) || data.result.length > 100)
            failure("SCHEDULE_INVALID");
          const ids = new Set<string>();
          day.schedule = data.result.map((raw: unknown) => {
            const row = object(raw);
            if (
              row.corp_id !== query.organization.corpId ||
              row.user_id !== binding.dingtalkUserId ||
              dateOf(row.work_date) !== workDate
            )
              failure("RESPONSE_SCOPE_MISMATCH");
            const id = sourceId(row.id);
            if (ids.has(id)) failure("SCHEDULE_DUPLICATE");
            ids.add(id);
            if (!["Y", "N"].includes(row.is_rest)) failure("SCHEDULE_INVALID");
            const plannedAt = timestamp(row.real_plan_time);
            if (
              row.is_rest === "N" &&
              (!["OnDuty", "OffDuty"].includes(row.check_type) ||
                (row.real_plan_time != null && !plannedAt))
            )
              failure("SCHEDULE_INVALID");
            return {
              id,
              classId: row.class_id == null ? "" : sourceId(row.class_id),
              workDate,
              checkType: row.check_type ?? "",
              plannedAt,
              isRest: row.is_rest === "Y",
              approvalLinked: !!row.approve_id || !!row.approve_biz_type,
              ...(row.approve_id
                ? { approvalId: sourceId(row.approve_id) }
                : {}),
            };
          });
          if (!day.schedule.length)
            note(
              new ReadFailure({ code: "SCHEDULE_NOT_PROVEN" }),
              "schedule",
              day,
            );
        } catch (error) {
          note(error, "schedule", day);
        }
        try {
          const data = await request("/topapi/attendance/getupdatedata", {
            userid: binding.dingtalkUserId,
            work_date: `${workDate} 00:00:00`,
          });
          const detail = object(data.result);
          if (
            detail.corpId !== query.organization.corpId ||
            detail.userid !== binding.dingtalkUserId ||
            dateOf(detail.work_date) !== workDate
          )
            failure("RESPONSE_SCOPE_MISMATCH");
          if (
            !Array.isArray(detail.approve_list) ||
            detail.approve_list.length > 200
          )
            failure("APPROVAL_LIST_INVALID");
          if (
            !Array.isArray(detail.attendance_result_list) ||
            detail.attendance_result_list.length > 100
          )
            failure("DAILY_PLANS_INVALID");
          const plans = detail.attendance_result_list.map((raw: unknown) => {
            const row = object(raw);
            if (
              (row.userid && row.userid !== binding.dingtalkUserId) ||
              (row.work_date && dateOf(row.work_date) !== workDate)
            )
              failure("RESPONSE_SCOPE_MISMATCH");
            if (!["OnDuty", "OffDuty"].includes(row.check_type))
              failure("DAILY_PLANS_INVALID");
            const plannedAt = timestamp(row.plan_check_time);
            if (row.plan_check_time != null && !plannedAt)
              failure("DAILY_PLANS_INVALID");
            return {
              planId: sourceId(row.plan_id),
              checkType: row.check_type,
              plannedAt,
              processInstanceId: text(row.procInst_id),
            };
          });
          for (const row of day.schedule.filter((entry) => !entry.isRest)) {
            const matched = day.punches.filter(
              (punch) =>
                punch.planId === row.id && punch.checkType === row.checkType,
            );
            const daily = plans.filter(
              (plan: any) =>
                plan.planId === row.id && plan.checkType === row.checkType,
            );
            const candidates = [
              ...new Set(
                [
                  row.plannedAt,
                  ...matched.map((punch) => punch.plannedAt),
                  ...daily.map((plan: any) => plan.plannedAt),
                ].filter(Boolean),
              ),
            ];
            if (candidates.length !== 1) {
              row.plannedAt = null;
              note(
                new ReadFailure({
                  code: candidates.length
                    ? "SCHEDULE_PLAN_CONFLICT"
                    : "SCHEDULE_PLAN_UNPROVEN",
                }),
                "schedule",
                day,
              );
            } else row.plannedAt = candidates[0] as string;
          }
          const rest = detail.class_setting_info?.rest_time_vo_list;
          if (Array.isArray(rest)) {
            day.rests = rest.map((raw: unknown) => {
              const row = object(raw),
                startsAt = timestamp(row.rest_begin_time),
                endsAt = timestamp(row.rest_end_time);
              if (!startsAt || !endsAt || startsAt >= endsAt)
                failure("REST_INTERVAL_UNPROVEN");
              return { startsAt: startsAt!, endsAt: endsAt! };
            });
            day.restsKnown = true;
          }
          const seen = new Set<string>();
          for (const raw of detail.approve_list) {
            const row = object(raw),
              processInstanceId = text(row.procInst_id);
            if (!processInstanceId) {
              note(
                new ReadFailure({ code: "APPROVAL_LINK_UNPROVEN" }),
                "workflow",
                day,
              );
              continue;
            }
            if (seen.has(processInstanceId)) failure("APPROVAL_DUPLICATE");
            seen.add(processInstanceId);
            let state: DingtalkAttendanceApproval["state"] = "pending";
            try {
              if (query.workflowInstanceRead !== true)
                failure("WORKFLOW_PERMISSION_UNCONFIRMED");
              state = await workflowState(
                processInstanceId,
                binding.dingtalkUserId,
              );
            } catch (error) {
              note(error, "workflow", day);
            }
            day.approvals.push({
              processInstanceId,
              businessType: Number.isInteger(row.biz_type)
                ? row.biz_type
                : null,
              tagName: text(row.tag_name) ?? "",
              subType: text(row.sub_type) ?? "",
              startsAt: timestamp(row.begin_time),
              endsAt: timestamp(row.end_time),
              duration:
                typeof row.duration === "string" &&
                /^\d{1,12}(\.\d{1,4})?$/.test(row.duration)
                  ? row.duration
                  : null,
              unit: text(row.duration_unit),
              state,
              ...(state === "cancelled"
                ? {
                    terminalProof: {
                      status: "TERMINATED" as const,
                      fingerprint: digest([
                        "workflow-terminal-v1",
                        processInstanceId,
                        binding.dingtalkUserId,
                        "TERMINATED",
                      ]),
                    },
                  }
                : {}),
            });
          }
          for (const punch of day.punches.filter((row) => row.approvalLinked)) {
            const daily = plans.filter(
              (plan: any) =>
                plan.planId === punch.planId &&
                plan.checkType === punch.checkType &&
                plan.processInstanceId,
            );
            const refs = [
              ...new Set(
                [
                  punch.processInstanceId,
                  ...daily.map((plan: any) => plan.processInstanceId),
                ].filter(Boolean),
              ),
            ];
            if (
              refs.length !== 1 ||
              !seen.has(refs[0] as string) ||
              !daily.length ||
              !day.schedule.some(
                (row) =>
                  row.id === punch.planId && row.checkType === punch.checkType,
              )
            ) {
              note(
                new ReadFailure({ code: "APPROVAL_LINK_UNPROVEN" }),
                "workflow",
                day,
              );
            } else punch.processInstanceId = refs[0] as string;
          }
          for (const row of day.schedule.filter(
            (entry) => entry.approvalLinked,
          )) {
            const matching = day.punches.filter(
              (punch) =>
                punch.planId === row.id &&
                punch.checkType === row.checkType &&
                row.approvalId &&
                row.approvalId === punch.approvalId &&
                punch.processInstanceId &&
                seen.has(punch.processInstanceId),
            );
            if (matching.length !== 1)
              note(
                new ReadFailure({ code: "APPROVAL_LINK_UNPROVEN" }),
                "workflow",
                day,
              );
          }
        } catch (error) {
          note(error, "day", day);
        }
      }
    return {
      month: query.month,
      organizationKey: digest([
        "dingtalk-attendance-v1",
        query.organization.corpId,
      ]),
      scope: {
        employeeIds: query.bindings.map((row) => row.employeeId).sort(),
        from: query.from,
        to: query.to,
      },
      days,
      pending,
      complete: !pending.length && days.every((day) => day.complete),
    };
  }

  private validate(query: DingtalkAttendanceQuery, corpId: string | undefined): void {
    const invalid = () => {
      throw new BadRequestException("Invalid confirmed HRM attendance scope");
    };
    if (
      !query ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ||
      query.organization?.verified !== true ||
      !text(query.organization.corpId) ||
      query.organization.corpId !== corpId
    )
      invalid();
    for (const day of [query.from, query.to])
      if (
        typeof day !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !day.startsWith(query.month + "-") ||
        !timestamp(`${day} 00:00:00`)
      )
        invalid();
    if (
      query.from > query.to ||
      !Array.isArray(query.bindings) ||
      !query.bindings.length ||
      query.bindings.length > 1000 ||
      dates(query.from, query.to).length * query.bindings.length > 10000
    )
      invalid();
    for (const row of [query.operator, ...query.bindings])
      if (
        !row ||
        !isUUID(row.employeeId) ||
        !text(row.dingtalkUserId) ||
        row.corpId !== query.organization.corpId
      )
        invalid();
    if (
      new Set(query.bindings.map((row) => row.employeeId)).size !==
        query.bindings.length ||
      new Set(query.bindings.map((row) => row.dingtalkUserId)).size !==
        query.bindings.length
    )
      invalid();
  }

  private async request(path: string, body: Json | null, identity: DingtalkIdentity): Promise<Json> {
    try {
      return await withDingtalkDeadline(async (signal) => {
        let token: string;
        try {
          token = await this.dingtalk.getAccessToken(signal, identity);
        } catch {
          return failure("TOKEN_UNAVAILABLE");
        }
        const modern = path === "/v1.0/workflow/processInstances";
        const url = new URL(
          path,
          modern ? "https://api.dingtalk.com" : "https://oapi.dingtalk.com",
        );
        if (modern)
          url.searchParams.set("processInstanceId", body!.processInstanceId);
        else url.searchParams.set("access_token", token);
        const response = await fetch(url, {
          method: modern ? "GET" : "POST",
          redirect: "error",
          signal,
          headers: {
            "Content-Type": "application/json",
            ...(modern ? { "x-acs-dingtalk-access-token": token } : {}),
          },
          ...(modern ? {} : { body: JSON.stringify(body) }),
        });
        const data = object(await response.json());
        if (
          !response.ok ||
          (modern && data.success !== true && data.success !== "true") ||
          (!modern && (data.errcode !== 0 || data.success === false))
        ) {
          const code = String(data.sub_code ?? data.errcode ?? data.code ?? "");
          throw new ReadFailure({
            code: "UPSTREAM_REJECTED",
            httpStatus: response.status,
            ...(/^[A-Za-z0-9_.-]{1,100}$/.test(code)
              ? { upstreamCode: code }
              : {}),
          });
        }
        return data;
      });
    } catch (error) {
      if (error instanceof ReadFailure) throw error;
      throw new ReadFailure({
        code:
          error instanceof DingtalkDeadlineError
            ? "DEADLINE_EXCEEDED"
            : "TRANSPORT_OR_RESPONSE_FAILED",
      });
    }
  }
}
