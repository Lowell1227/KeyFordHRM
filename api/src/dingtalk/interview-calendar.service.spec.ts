import { ConfigService } from '@nestjs/config';
import { InterviewCalendarService, CalendarSyncError } from './interview-calendar.service';

describe('Interview calendar transport', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let token: jest.Mock;
  const event = {
    invitationId: 'invite-1', version: 2, organizerUnionId: 'organizer/one',
    participantUnionIds: ['participant-one'], summary: 'Synthetic interview',
    description: 'Synthetic meeting invitation',
    startsAt: new Date('2035-03-20T01:00:00.000Z'), endsAt: new Date('2035-03-20T02:00:00.000Z'),
  };
  function service(enabled = true, redirectUri?: string) {
    return new InterviewCalendarService({ getAccessToken: token } as any,
      new ConfigService({ DINGTALK_INTERVIEW_CALENDAR_ENABLED: String(enabled), DINGTALK_REDIRECT_URI: redirectUri }));
  }
  beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock; token = jest.fn().mockResolvedValue('synthetic-token'); });
  afterEach(() => { global.fetch = originalFetch; });
  it('does not call any external API until explicitly enabled', async () => {
    await expect(service(false).create(event)).rejects.toMatchObject({ state: 'unconfigured' });
    expect(token).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('creates an event with a stable operation key and no Tencent API invocation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'event-1' }), { status: 200 }));
    await expect(service().create(event)).resolves.toBe('event-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.dingtalk.com/v1.0/calendar/users/organizer%2Fone/calendars/primary/events');
    expect(options.method).toBe('POST');
    expect(options.headers['x-client-token']).toBe('hrm-interview-invite-1-create');
    expect(JSON.parse(options.body)).toStrictEqual({
      summary: 'Synthetic interview', description: 'Synthetic meeting invitation\n\n[HRM_INTERVIEW_ID=invite-1]',
      isAllDay: false, attendees: [{ id: 'participant-one' }],
      start: { dateTime: '2035-03-20T01:00:00.000Z', timeZone: 'Asia/Shanghai' },
      end: { dateTime: '2035-03-20T02:00:00.000Z', timeZone: 'Asia/Shanghai' },
      eventConfig: { allowAttendeeAddParticipants: false, allowAttendeeAddConference: false },
    });
  });
  it('keeps a timed-out create uncertain rather than automatically retryable', async () => {
    fetchMock.mockRejectedValue(new Error('network timeout with secret details'));
    await expect(service().create(event)).rejects.toMatchObject({ state: 'uncertain', message: '钉钉日程响应未确认，请核对日程后再处理' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('quarantines an ambiguous successful response without an event id', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(service().create(event)).rejects.toMatchObject({ state: 'uncertain' });
  });
  it('classifies a permission rejection without leaking provider request or tokens', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'Forbidden', message: 'secret-provider-detail' }), { status: 403 }));
    await expect(service().create(event)).rejects.toMatchObject({ state: 'failed', message: '钉钉日程权限不足，请检查应用日程权限及人员授权范围' });
  });
  it('updates only the known event and treats an already absent cancelled event as success', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await service().update('event-1', event);
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toStrictEqual({
      id: 'event-1', summary: 'Synthetic interview', description: 'Synthetic meeting invitation\n\n[HRM_INTERVIEW_ID=invite-1]',
      isAllDay: false, attendees: [{ id: 'participant-one' }],
      start: { dateTime: '2035-03-20T01:00:00.000Z', timeZone: 'Asia/Shanghai' },
      end: { dateTime: '2035-03-20T02:00:00.000Z', timeZone: 'Asia/Shanghai' },
    });
    await service().cancel('event-1', event);
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[1][0]).toContain('/events/event-1?pushNotification=true');
  });
  it('rejects missing identity before obtaining credentials', async () => {
    await expect(service().create({ ...event, organizerUnionId: '' })).rejects.toBeInstanceOf(CalendarSyncError);
    expect(token).not.toHaveBeenCalled();
  });

  const marker = '[HRM_INTERVIEW_ID=invite-1]';
  const locator = { invitationId: 'invite-1', organizerUnionId: 'organizer/one', eventId: null, operation: 'upsert' as const };
  const remote = { id: 'event-1', status: 'confirmed', description: `Synthetic invitation\n\n${marker}` };
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('persists the same exact business marker through create and update', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply({ id: 'event-1' })));
    await service().create(event);
    await service().update('event-1', { ...event, version: 3, description: 'Changed invitation' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).description).toBe(`Synthetic meeting invitation\n\n${marker}`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).description).toBe(`Changed invitation\n\n${marker}`);
  });
  it('checks a persisted event ID using GET only, including legacy events without a marker', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'event-1', status: 'confirmed' }));
    await expect((service() as any).locate({ ...locator, eventId: 'event-1' })).resolves.toEqual({ kind: 'found', eventId: 'event-1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.dingtalk.com/v1.0/calendar/users/organizer%2Fone/calendars/primary/events/event-1');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-client-token');
  });
  it('scans every page then confirms one exact marker match with GET', async () => {
    fetchMock.mockResolvedValueOnce(reply({ events: [{ id: 'unrelated', status: 'confirmed', description: `${marker}-not-exact` }], nextToken: 'page/two' }))
      .mockResolvedValueOnce(reply({ events: [remote] })).mockResolvedValueOnce(reply(remote));
    await expect((service() as any).locate(locator)).resolves.toEqual({ kind: 'found', eventId: 'event-1' });
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('nextToken')).toBe('page/two');
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });
  it.each([
    [{ events: [] }, 'no_match'],
    [{ events: [remote, { ...remote, id: 'event-2' }] }, 'multiple_matches'],
    [{ items: [remote] }, 'incomplete_response'],
  ])('leaves missing, duplicate or malformed matches unresolved', async (response, reason) => {
    fetchMock.mockResolvedValue(reply(response));
    await expect((service() as any).locate(locator)).resolves.toEqual({ kind: 'unresolved', reason });
  });
  it('does not accept a match when pagination loops or never completes', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply({ events: [remote], nextToken: 'repeated' })));
    await expect((service() as any).locate(locator)).resolves.toEqual({ kind: 'unresolved', reason: 'incomplete_response' });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
  });
  it('does not accept a match if the confirming GET has changed identity', async () => {
    fetchMock.mockResolvedValueOnce(reply({ events: [remote] })).mockResolvedValueOnce(reply({ ...remote, description: 'Removed marker' }));
    await expect((service() as any).locate(locator)).resolves.toEqual({ kind: 'unresolved', reason: 'event_unavailable' });
  });
  it.each([403, 404, 500])('does not treat GET status %s as proof that recreation is safe', async (status) => {
    fetchMock.mockResolvedValue(new Response('secret-provider-detail', { status }));
    await expect((service() as any).locate({ ...locator, eventId: 'event-1' })).resolves.toEqual({ kind: 'unresolved', reason: 'read_failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('never resurrects a remotely cancelled event but permits cancelling its known ID again', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply({ ...remote, status: 'cancelled' })));
    await expect((service() as any).locate({ ...locator, eventId: 'event-1' })).resolves.toEqual({ kind: 'unresolved', reason: 'event_unavailable' });
    await expect((service() as any).locate({ ...locator, eventId: 'event-1', operation: 'cancel' })).resolves.toEqual({ kind: 'found', eventId: 'event-1' });
  });
  it('does not perform reconciliation reads when disabled', async () => {
    await expect((service(false) as any).locate(locator)).rejects.toMatchObject({ state: 'unconfigured' });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('adds the controlled interview entry from the configured HTTPS origin, never from invitation content', async () => {
    fetchMock.mockResolvedValue(reply({ id: 'event-1' }));
    await service(true, 'https://hrm.example.test/auth/callback?code=not-for-description').create({
      ...event, description: 'https://meeting.tencent.com/dm/synthetic',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).description)
      .toBe(`https://meeting.tencent.com/dm/synthetic\n\nhttps://hrm.example.test/talent-interviews/invite-1\n\n${marker}`);
  });
  it.each(['http://hrm.example.test/auth/callback', 'https://name:secret@hrm.example.test/callback',
    'https://hrm.example.test\\@evil.test', 'not-a-url', 'https://hrm.example.test/\ncallback'])('does not derive a detail link from invalid redirect configuration %s', async (uri) => {
    fetchMock.mockResolvedValue(reply({ id: 'event-1' }));
    await service(true, uri).create(event);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).description).toBe(`Synthetic meeting invitation\n\n${marker}`);
  });
});
