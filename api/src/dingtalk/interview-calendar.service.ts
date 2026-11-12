import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DingtalkService } from './dingtalk.service';

export type CalendarFailureState = 'unconfigured' | 'failed' | 'uncertain';

export class CalendarSyncError extends Error {
  constructor(public readonly state: CalendarFailureState, message: string) { super(message); }
}

export interface InterviewCalendarEvent {
  invitationId: string;
  version: number;
  organizerUnionId: string;
  participantUnionIds: string[];
  summary: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CalendarEventLocator {
  invitationId: string;
  organizerUnionId: string;
  eventId: string | null;
  operation: 'upsert' | 'cancel';
}

export type CalendarLookupResult = { kind: 'found'; eventId: string } | {
  kind: 'unresolved';
  reason: 'no_match' | 'multiple_matches' | 'incomplete_response' | 'event_unavailable' | 'read_failed';
};

const businessMarker = (id: string) => `[HRM_INTERVIEW_ID=${id}]`;

@Injectable()
export class InterviewCalendarService {
  constructor(private readonly dingtalk: DingtalkService, private readonly config: ConfigService) {}

  isEnabled() { return this.config.get<string>('DINGTALK_INTERVIEW_CALENDAR_ENABLED', 'false') === 'true'; }

  async create(event: InterviewCalendarEvent): Promise<string> {
    const result = await this.request('POST', '', event, {
      ...this.body(event),
      eventConfig: { allowAttendeeAddParticipants: false, allowAttendeeAddConference: false },
    }, 'create');
    if (typeof result?.id !== 'string' || !result.id.trim()) throw this.uncertain();
    return result.id;
  }

  async update(eventId: string, event: InterviewCalendarEvent): Promise<void> {
    await this.request('PUT', `/${encodeURIComponent(eventId)}`, event,
      { id: eventId, ...this.body(event) }, `update-${event.version}`);
  }

  async cancel(eventId: string, event: InterviewCalendarEvent): Promise<void> {
    await this.request('DELETE', `/${encodeURIComponent(eventId)}?pushNotification=true`, event,
      undefined, `cancel-${event.version}`);
  }

  // Read-only discovery never proves that a missing event is safe to recreate.
  async locate(locator: CalendarEventLocator): Promise<CalendarLookupResult> {
    if (!this.isEnabled()) throw new CalendarSyncError('unconfigured', '钉钉日程同步尚未启用');
    const signal = AbortSignal.timeout(15000);
    const read = (suffix: string) => this.request('GET', suffix, locator, undefined, 'lookup', signal);
    const matches = (event: any) => typeof event?.description === 'string'
      && event.description.split(/\r?\n/).filter((line: string) => line.startsWith('[HRM_INTERVIEW_ID=')).join('\n') === businessMarker(locator.invitationId);
    const available = (event: any, id: string) => event?.id === id
      && (event.status === 'confirmed' || (locator.operation === 'cancel' && event.status === 'cancelled'));
    try {
      if (locator.eventId) {
        const event = await read(`/${encodeURIComponent(locator.eventId)}`);
        return available(event, locator.eventId)
          ? { kind: 'found', eventId: locator.eventId }
          : { kind: 'unresolved', reason: 'event_unavailable' };
      }
      const ids = new Set<string>();
      const tokens = new Set<string>();
      let nextToken: string | undefined;
      let complete = false;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ maxResults: '100', showDeleted: 'true' });
        if (nextToken) query.set('nextToken', nextToken);
        const result = await read(`?${query}`);
        if (!Array.isArray(result?.events) || result.events.some((event: any) => typeof event?.id !== 'string' || !event.id.trim())
          || (result.nextToken != null && typeof result.nextToken !== 'string')) {
          return { kind: 'unresolved', reason: 'incomplete_response' };
        }
        for (const event of result.events) if (matches(event)) ids.add(event.id);
        if (ids.size > 1) return { kind: 'unresolved', reason: 'multiple_matches' };
        nextToken = result.nextToken || undefined;
        if (!nextToken) { complete = true; break; }
        if (tokens.has(nextToken)) break;
        tokens.add(nextToken);
      }
      if (!complete) return { kind: 'unresolved', reason: 'incomplete_response' };
      if (!ids.size) return { kind: 'unresolved', reason: 'no_match' };
      const eventId = [...ids][0];
      const event = await read(`/${encodeURIComponent(eventId)}`);
      return available(event, eventId) && matches(event)
        ? { kind: 'found', eventId }
        : { kind: 'unresolved', reason: 'event_unavailable' };
    } catch {
      return { kind: 'unresolved', reason: 'read_failed' };
    }
  }

  // Contract: official @alicloud/dingtalk calendar_1_0 CreateEvent/PatchEvent/DeleteEvent.
  private body(event: InterviewCalendarEvent) {
    return {
      summary: event.summary,
      description: [event.description, this.detailLink(event.invitationId), businessMarker(event.invitationId)].filter(Boolean).join('\n\n'),
      isAllDay: false,
      start: { dateTime: event.startsAt.toISOString(), timeZone: 'Asia/Shanghai' },
      end: { dateTime: event.endsAt.toISOString(), timeZone: 'Asia/Shanghai' },
      attendees: [...new Set(event.participantUnionIds)].map(id => ({ id })),
    };
  }

  private detailLink(id: string): string | null {
    const value = this.config.get<string>('DINGTALK_REDIRECT_URI')?.trim();
    if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return `${url.origin}/talent-interviews/${encodeURIComponent(id)}`;
    } catch { return null; }
  }

  private uncertain() { return new CalendarSyncError('uncertain', '钉钉日程响应未确认，请核对日程后再处理'); }

  private async request(method: string, suffix: string,
    event: Pick<InterviewCalendarEvent, 'invitationId' | 'organizerUnionId'> & { participantUnionIds?: string[] },
    body: unknown, operation: string, signal = AbortSignal.timeout(15000)): Promise<any> {
    if (!this.isEnabled()) throw new CalendarSyncError('unconfigured', '钉钉日程同步尚未启用');
    if (!event.organizerUnionId || event.participantUnionIds?.some(id => !id)) {
      throw new CalendarSyncError('failed', '组织者或参与人尚未绑定有效钉钉身份');
    }
    let token: string;
    try { token = await this.dingtalk.getAccessToken(signal); }
    catch { throw new CalendarSyncError('failed', '无法获取钉钉日程访问凭证，请检查应用配置'); }
    let response: Response;
    try {
      response = await fetch(`https://api.dingtalk.com/v1.0/calendar/users/${encodeURIComponent(event.organizerUnionId)}/calendars/primary/events${suffix}`, {
        method, signal,
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token,
          ...(method === 'GET' ? {} : { 'x-client-token': `hrm-interview-${event.invitationId}-${operation}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw this.uncertain(); }
    if (method === 'DELETE' && response.status === 404) return;
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408) throw this.uncertain();
      throw new CalendarSyncError('failed', response.status === 401 || response.status === 403
        ? '钉钉日程权限不足，请检查应用日程权限及人员授权范围'
        : '钉钉未接受本次日程变更，请检查人员绑定和日程配置');
    }
    if (method === 'DELETE') return;
    try { return await response.json(); } catch { throw this.uncertain(); }
  }
}
