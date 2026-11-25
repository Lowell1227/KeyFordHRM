import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DingtalkService } from './dingtalk.service';
import {
  DingtalkDeadlineError,
  withDingtalkDeadline,
} from './dingtalk-request-deadline';

export interface RecruitmentDemandSource {
  organizationKey: string;
  processCode: string;
  instanceId: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'unknown';
  rawDepartment: string | null;
  rawPosition: string | null;
  rawHeadcount: string | null;
  approvedAt: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceLink: string | null;
  mainInstanceId: string | null;
  bizAction: string | null;
  supersedesInstanceId?: string | null;
}

export interface RecruitmentDemandSubmissionVerification {
  source: RecruitmentDemandSource;
  relatedSources: RecruitmentDemandSource[];
  replacementCoverage: 'complete' | 'unproven';
  checkedAt: string;
}

const keys = [
  'DINGTALK_CORP_ID',
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  'DINGTALK_RECRUITMENT_PROCESS_CODE',
  'DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID',
  'DINGTALK_RECRUITMENT_POSITION_CONTROL_ID',
  'DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID',
] as const;
type Settings = Record<(typeof keys)[number], string>;
type Json = Record<string, unknown>;
interface VerificationReads {
  details: Map<string, VerifiedInstance>;
  attempted: Set<string>;
}
interface VerifiedInstance {
  data: Json;
  createdAt: string;
  createdThrough: number;
}
const day = 86400000;
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;
const controlIdPattern = /^[\p{L}\p{N}_-]{1,200}$/u;
class ReadFailure extends Error {}
function fail(code: string): never {
  throw new ReadFailure(`RECRUITMENT_${code}`);
}
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : fail('RESPONSE_INVALID');

function timestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return null;
  const date = value.slice(0, 10),
    midnight = Date.parse(`${date}T00:00:00Z`);
  const time = Date.parse(value);
  return Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === date &&
    Number.isFinite(time)
    ? new Date(time).toISOString()
    : null;
}
function minuteZCandidates(value: unknown): number[] {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(value)
  )
    return [];
  const utc = timestamp(value),
    local = timestamp(`${value.slice(0, -1)}:00+08:00`);
  return utc && local ? [Date.parse(utc), Date.parse(local)] : [];
}
function finishTimestamp(value: unknown, createdAt: string): string | null {
  const parsed = timestamp(value);
  if (!parsed) return null;
  const candidates = minuteZCandidates(value);
  if (!candidates.length) return parsed;
  // Creation membership proves no finish-time clock. Keep ambiguous approval times unusable.
  const possible = candidates.filter(
    (start) => start + 59999 >= Date.parse(createdAt) && start <= Date.now(),
  );
  return possible.length === 1 ? new Date(possible[0]).toISOString() : null;
}
function boundary(value: string, end: boolean): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = timestamp(
    dateOnly ? `${value}T${end ? '23:59:59.999' : '00:00:00'}+08:00` : value,
  );
  if (!parsed) throw new BadRequestException('RECRUITMENT_RANGE_INVALID');
  return Date.parse(parsed);
}
function field(values: unknown, id: string): string | null {
  if (!Array.isArray(values)) return null;
  const matches = values.filter(
    (value) => value && typeof value === 'object' && value.id === id,
  );
  if (matches.length !== 1 || typeof matches[0].value !== 'string') return null;
  const text = matches[0].value;
  // Department controls may contain serialized JSON; preserve only these allowlisted strings, never parse them.
  return text.trim() && text.length <= 2000 ? text : null;
}

@Injectable()
export class DingtalkRecruitmentService {
  constructor(
    private readonly dingtalk: DingtalkService,
    private readonly config: ConfigService,
  ) {}

  status(): {
    configured: boolean;
    missing: string[];
    readOnly: true;
    scopeVerified: boolean;
    scope?: { organizationKey: string; processCode: string };
  } {
    const values = this.settings();
    const missing: string[] = keys.filter(
      (key) =>
        !values[key] ||
        (key !== 'DINGTALK_APP_SECRET' &&
          !(key.endsWith('_CONTROL_ID') ? controlIdPattern : idPattern).test(
            values[key],
          )),
    );
    const controls = keys.slice(4).map((key) => values[key]);
    if (new Set(controls).size !== controls.length && !missing.length)
      missing.push('RECRUITMENT_CONTROL_IDS_DISTINCT');
    return {
      configured: missing.length === 0,
      missing,
      readOnly: true,
      scopeVerified: !missing.length && this.scopeVerified(values),
      ...(!missing.length
        ? {
            scope: {
              organizationKey: values.DINGTALK_CORP_ID,
              processCode: values.DINGTALK_RECRUITMENT_PROCESS_CODE,
            },
          }
        : {}),
    };
  }

  async listIds(range: {
    from: string;
    to: string;
  }): Promise<{ instanceIds: string[]; complete: boolean }> {
    const config = this.configured();
    const start = boundary(range.from, false),
      end = boundary(range.to, true);
    if (end < start || end - start >= 366 * day)
      throw new BadRequestException('RECRUITMENT_RANGE_INVALID');
    return this.withBudget((signal) => this.ids(config, start, end, signal));
  }

  async readInstance(instanceId: string): Promise<RecruitmentDemandSource> {
    const config = this.configured();
    if (!idPattern.test(instanceId))
      throw new BadRequestException('RECRUITMENT_INSTANCE_INVALID');
    return this.withBudget((signal) =>
      this.readVerified(config, instanceId, signal),
    );
  }

  async verifyForSubmission(
    instanceId: string,
  ): Promise<RecruitmentDemandSubmissionVerification> {
    const config = this.configured();
    if (!idPattern.test(instanceId))
      throw new BadRequestException('RECRUITMENT_INSTANCE_INVALID');
    return this.withBudget(async (signal) => {
      const receiptMatches = this.scopeVerified(config);
      const reads: VerificationReads = {
        details: new Map(),
        attempted: new Set(),
      };
      const sources = new Map<string, RecruitmentDemandSource>();
      const read = async (id: string, listedIds?: ReadonlySet<string>) => {
        const known = sources.get(id);
        if (known) return known;
        const value = await this.readVerified(
          config,
          id,
          signal,
          listedIds,
          reads,
        );
        sources.set(id, value);
        return value;
      };
      const trace = async (
        first: RecruitmentDemandSource,
        listedIds?: ReadonlySet<string>,
      ) => {
        const path: RecruitmentDemandSource[] = [],
          seen = new Set<string>();
        let current = first;
        for (;;) {
          signal.throwIfAborted();
          if (
            seen.has(current.instanceId) ||
            current.status === 'unknown' ||
            !current.sourceCreatedAt
          )
            return null;
          seen.add(current.instanceId);
          path.push(current);
          if (current.bizAction === 'NONE' && !current.mainInstanceId)
            return path;
          if (
            !['MODIFY', 'REVOKE'].includes(current.bizAction ?? '') ||
            !current.mainInstanceId
          )
            return null;
          try {
            const parent = await read(current.mainInstanceId, listedIds);
            if (
              !parent.sourceCreatedAt ||
              Date.parse(parent.sourceCreatedAt) >
                (reads.details.get(current.instanceId)?.createdThrough ??
                  Date.parse(current.sourceCreatedAt))
            )
              return null;
            current = parent;
          } catch {
            signal.throwIfAborted();
            return null;
          }
        }
      };
      const source = await read(instanceId);
      const selectedPath = await trace(source);
      const cutoff = Date.now();
      const earliest = selectedPath?.at(-1)?.sourceCreatedAt;
      const necessaryStart = earliest
        ? Math.floor(Date.parse(earliest) / 60000) * 60000
        : NaN;
      const windowKnown =
        Number.isFinite(necessaryStart) &&
        necessaryStart <= cutoff &&
        cutoff - necessaryStart <= 120 * day;
      let complete = receiptMatches && windowKnown && !!selectedPath;
      const from = complete ? necessaryStart : cutoff - 120 * day + 1;
      const paths = new Map<string, RecruitmentDemandSource[] | null>([
        [instanceId, selectedPath],
      ]);
      try {
        const listing = await this.ids(config, from, cutoff, signal, 2);
        const listedIds = new Set(listing.instanceIds);
        if (
          !listing.complete ||
          listedIds.size > 20 ||
          !listedIds.has(instanceId)
        )
          complete = false;
        for (const id of listing.instanceIds) {
          signal.throwIfAborted();
          try {
            const candidate = await read(id, listedIds);
            const path = await trace(candidate, listedIds);
            paths.set(id, path);
            if (
              !path ||
              !candidate.sourceCreatedAt ||
              Date.parse(candidate.sourceCreatedAt) < from ||
              Date.parse(candidate.sourceCreatedAt) > cutoff
            )
              complete = false;
          } catch {
            signal.throwIfAborted();
            complete = false;
          }
        }
        for (const value of sources.values()) {
          if (
            value.sourceCreatedAt &&
            Date.parse(value.sourceCreatedAt) >= from &&
            Date.parse(value.sourceCreatedAt) <= cutoff &&
            !listedIds.has(value.instanceId)
          )
            complete = false;
        }
      } catch {
        signal.throwIfAborted();
        complete = false;
      }
      const selectedRoot = selectedPath?.at(-1)?.instanceId;
      const selectedChain = new Set(
        selectedPath?.map((row) => row.instanceId) ?? [],
      );
      for (const [id, path] of paths) {
        if (!path) {
          complete = false;
          continue;
        }
        // A same-root sibling does not identify whether it directly replaces this selection.
        if (
          !selectedChain.has(id) &&
          path.at(-1)?.instanceId === selectedRoot &&
          !path.some((row) => row.instanceId === instanceId)
        )
          complete = false;
      }
      const relatedSources: RecruitmentDemandSource[] = [];
      const relatedIds = new Set([instanceId]);
      let added: boolean;
      do {
        added = false;
        for (const candidate of sources.values()) {
          if (relatedIds.has(candidate.instanceId)) continue;
          const predecessor =
            candidate.supersedesInstanceId ?? candidate.mainInstanceId;
          if (!predecessor || !relatedIds.has(predecessor)) continue;
          relatedIds.add(candidate.instanceId);
          relatedSources.push(candidate);
          added = true;
        }
      } while (added);
      signal.throwIfAborted();
      // Complete means only this receipted scope/window and its readable explicit relationships.
      return {
        source,
        relatedSources,
        replacementCoverage: complete ? 'complete' : 'unproven',
        checkedAt: new Date(cutoff).toISOString(),
      };
    });
  }

  private async readVerified(
    config: Settings,
    instanceId: string,
    signal: AbortSignal,
    listedIds?: ReadonlySet<string>,
    reads?: VerificationReads,
  ): Promise<RecruitmentDemandSource> {
    const verified = await this.verifiedInstance(
      config,
      instanceId,
      signal,
      listedIds,
      reads,
    );
    const { data, createdAt: sourceCreatedAt } = verified;
    const finished = finishTimestamp(data.finishTime, sourceCreatedAt);
    const rawDepartment = field(
      data.formComponentValues,
      config.DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID,
    );
    const rawPosition = field(
      data.formComponentValues,
      config.DINGTALK_RECRUITMENT_POSITION_CONTROL_ID,
    );
    const rawHeadcount = field(
      data.formComponentValues,
      config.DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID,
    );
    const bizAction = ['NONE', 'MODIFY', 'REVOKE'].includes(
      String(data.bizAction),
    )
      ? String(data.bizAction)
      : null;
    const mainInstanceId =
      typeof data.mainProcessInstanceId === 'string' &&
      idPattern.test(data.mainProcessInstanceId)
        ? data.mainProcessInstanceId
        : null;
    let status: RecruitmentDemandSource['status'] =
      data.status === 'RUNNING'
        ? 'pending'
        : data.status === 'TERMINATED'
          ? 'withdrawn'
          : data.status === 'COMPLETED' && data.result === 'refuse'
            ? 'rejected'
            : data.status === 'COMPLETED' && data.result === 'agree'
              ? 'approved'
              : 'unknown';
    let supersedesInstanceId: string | undefined;
    if (status === 'approved') {
      if (
        !finished ||
        !sourceCreatedAt ||
        Date.parse(finished) +
          (minuteZCandidates(data.finishTime).length ? 59999 : 0) <
          Date.parse(sourceCreatedAt) ||
        !rawDepartment ||
        !rawPosition ||
        !rawHeadcount ||
        !bizAction
      )
        status = 'unknown';
      else if (bizAction === 'MODIFY' || bizAction === 'REVOKE') {
        if (!mainInstanceId || mainInstanceId === instanceId)
          status = 'unknown';
        else {
          try {
            const original = await this.verifiedInstance(
              config,
              mainInstanceId,
              signal,
              listedIds,
              reads,
            );
            if (
              Date.parse(original.createdAt) > verified.createdThrough ||
              original.data.mainProcessInstanceId === instanceId
            )
              status = 'unknown';
            else {
              supersedesInstanceId = mainInstanceId;
            }
          } catch {
            signal.throwIfAborted();
            // Unverifiable relationships must not invalidate an existing approved request.
            status = 'unknown';
          }
        }
      } else if (mainInstanceId) status = 'unknown';
    }
    // Official approval AppLink; no upstream URLs, user IDs, task IDs or credentials are copied.
    const sourceLink = new URL('https://applink.dingtalk.com/approval/detail');
    sourceLink.searchParams.set('corpId', config.DINGTALK_CORP_ID);
    sourceLink.searchParams.set('instanceId', instanceId);
    sourceLink.searchParams.set('from', config.DINGTALK_APP_KEY);
    return {
      organizationKey: config.DINGTALK_CORP_ID,
      processCode: config.DINGTALK_RECRUITMENT_PROCESS_CODE,
      instanceId,
      status,
      rawDepartment,
      rawPosition,
      rawHeadcount,
      approvedAt: status === 'approved' ? finished : null,
      sourceCreatedAt,
      // The official detail contract provides no last-modified time; do not invent ordering evidence.
      sourceUpdatedAt: null,
      sourceLink: sourceLink.toString(),
      mainInstanceId,
      bizAction,
      ...(supersedesInstanceId ? { supersedesInstanceId } : {}),
    };
  }

  private settings(): Settings {
    return Object.fromEntries(
      keys.map((key) => {
        const value = this.config.get<unknown>(key);
        return [key, typeof value === 'string' ? value.trim() : ''];
      }),
    ) as Settings;
  }
  private configured(): Settings {
    if (!this.status().configured)
      throw new BadRequestException('RECRUITMENT_CONFIG_MISSING');
    return this.settings();
  }

  private scopeVerified(config: Settings): boolean {
    const raw = this.config.get<unknown>('DINGTALK_RECRUITMENT_VERIFIED_SCOPE');
    if (typeof raw !== 'string' || raw.length > 4000) return false;
    try {
      const receipt: unknown = JSON.parse(raw);
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
        return false;
      const value = receipt as Json,
        verifiedAt = timestamp(value.verifiedAt);
      return (
        value.organizationKey === config.DINGTALK_CORP_ID &&
        value.processCode === config.DINGTALK_RECRUITMENT_PROCESS_CODE &&
        value.appKey === config.DINGTALK_APP_KEY &&
        typeof value.recordId === 'string' &&
        !!value.recordId.trim() &&
        value.recordId.length <= 200 &&
        !!verifiedAt &&
        Date.parse(verifiedAt) <= Date.now()
      );
    } catch {
      return false;
    }
  }

  private async withBudget<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    try {
      return await withDingtalkDeadline(operation);
    } catch (error) {
      if (error instanceof DingtalkDeadlineError) return fail('TIMEOUT');
      throw error;
    }
  }

  private async ids(
    config: Settings,
    start: number,
    end: number,
    signal: AbortSignal,
    pageLimit = 500,
  ): Promise<{ instanceIds: string[]; complete: boolean }> {
    const ids = new Set<string>();
    let pages = 0;
    for (let from = start; from <= end; from += 120 * day) {
      const to = Math.min(from + 120 * day - 1, end);
      const cursors = new Set<number>();
      let next = 0;
      for (;;) {
        signal.throwIfAborted();
        if (pages++ >= pageLimit || cursors.has(next))
          return { instanceIds: [...ids], complete: false };
        cursors.add(next);
        const result = await this.request(
          '/v1.0/workflow/processes/instanceIds/query',
          {
            processCode: config.DINGTALK_RECRUITMENT_PROCESS_CODE,
            startTime: from,
            endTime: to,
            nextToken: next,
            maxResults: 20,
          },
          signal,
        );
        if (
          !Array.isArray(result.list) ||
          result.list.length > 20 ||
          result.list.some(
            (id) => typeof id !== 'string' || !idPattern.test(id),
          )
        )
          fail('RESPONSE_INVALID');
        for (const id of result.list as string[]) ids.add(id);
        const cursor = result.nextToken;
        const exhausted =
          cursor === null || cursor === undefined || cursor === '';
        if (ids.size >= 10000 && (!exhausted || to < end))
          return { instanceIds: [...ids], complete: false };
        if (exhausted) break;
        if (
          (typeof cursor !== 'string' && typeof cursor !== 'number') ||
          !/^\d+$/.test(String(cursor)) ||
          !Number.isSafeInteger(Number(cursor))
        )
          fail('RESPONSE_INVALID');
        next = Number(cursor);
      }
    }
    return { instanceIds: [...ids], complete: true };
  }

  private async verifiedInstance(
    config: Settings,
    instanceId: string,
    signal: AbortSignal,
    listedIds?: ReadonlySet<string>,
    reads?: VerificationReads,
  ): Promise<VerifiedInstance> {
    signal.throwIfAborted();
    const cached = reads?.details.get(instanceId);
    if (cached) return cached;
    if (reads) {
      if (reads.attempted.has(instanceId)) fail('SOURCE_UNVERIFIED');
      if (reads.attempted.size >= 20) fail('VERIFICATION_LIMIT');
      reads.attempted.add(instanceId);
    }
    const data = await this.request(
      '/v1.0/workflow/processInstances',
      null,
      signal,
      instanceId,
    );
    for (const [key, expected] of [
      ['corpId', config.DINGTALK_CORP_ID],
      ['processCode', config.DINGTALK_RECRUITMENT_PROCESS_CODE],
      ['processInstanceId', instanceId],
    ])
      if (data[key] !== undefined && data[key] !== expected)
        fail('SOURCE_MISMATCH');
    let createdAt = timestamp(data.createTime);
    if (!createdAt) fail('SOURCE_UNVERIFIED');
    const candidates = minuteZCandidates(data.createTime);
    if (candidates.length) {
      const matches: number[] = [];
      // The observed minute-Z wire format can carry Beijing wall time. Prove both hypotheses.
      for (const start of candidates) {
        const membership = await this.ids(config, start, start + 59999, signal);
        if (!membership.complete) fail('SOURCE_UNVERIFIED');
        if (membership.instanceIds.includes(instanceId)) matches.push(start);
      }
      if (!matches.length) fail('SOURCE_MISMATCH');
      if (matches.length !== 1) fail('SOURCE_UNVERIFIED');
      createdAt = new Date(matches[0]).toISOString();
    } else if (!listedIds?.has(instanceId)) {
      // Detail omits processCode/corpId. Prove membership through the exact configured form.
      const start = Math.floor(Date.parse(createdAt) / 60000) * 60000;
      const membership = await this.ids(config, start, start + 59999, signal);
      if (!membership.complete) fail('SOURCE_UNVERIFIED');
      if (!membership.instanceIds.includes(instanceId)) fail('SOURCE_MISMATCH');
    }
    const verified = {
      data,
      createdAt,
      createdThrough: Date.parse(createdAt) + (candidates.length ? 59999 : 0),
    };
    reads?.details.set(instanceId, verified);
    return verified;
  }

  private async request(
    path: string,
    body: Json | null,
    signal: AbortSignal,
    instanceId?: string,
  ): Promise<Json> {
    try {
      signal.throwIfAborted();
      const token = await this.dingtalk.getAccessToken(signal);
      signal.throwIfAborted();
      const url = new URL(path, 'https://api.dingtalk.com');
      if (instanceId) url.searchParams.set('processInstanceId', instanceId);
      const response = await fetch(url.toString(), {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403)
        fail('PERMISSION_DENIED');
      if (!response.ok) fail('READ_FAILED');
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return fail('RESPONSE_INVALID');
      }
      signal.throwIfAborted();
      const envelope = object(raw);
      if (envelope.success !== true && envelope.success !== 'true')
        fail('RESPONSE_INVALID');
      return object(envelope.result);
    } catch (error) {
      if (signal.aborted) return fail('TIMEOUT');
      if (error instanceof ReadFailure) throw error;
      return fail('READ_FAILED');
    }
  }
}
