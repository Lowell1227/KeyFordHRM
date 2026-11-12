import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { InterviewCalendarReconciliationService } from './interview-calendar-reconciliation.service';
import { InterviewCalendarDispatcher } from './interview-calendar-dispatcher';

const editor = { id: 'editor', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] } as AuthUser;

function setup() {
  const interview: any = { id: 'interview', version: 3, status: 'scheduled', syncStatus: 'uncertain',
    calendarEventId: null, calendarOrganizerUnionId: 'frozen-organizer', externalCalendarId: 'primary', calendarSyncedVersion: 0,
    createdById: 'editor', candidateNameSnapshot: 'Synthetic', invitationText: 'Synthetic invitation',
    startsAt: new Date('2035-01-01T01:00:00Z'), endsAt: new Date('2035-01-01T02:00:00Z') };
  const intent: any = { id: 'intent', interviewId: 'interview', version: 3, operation: 'upsert', status: 'uncertain',
    claimToken: 'old-claim', claimedAt: new Date('2035-01-01T01:00:00Z'), updatedAt: new Date('2035-01-01T01:01:00Z'),
    calendarEventId: null, calendarOrganizerUnionId: 'frozen-organizer', externalCalendarId: 'primary', participantIds: ['participant'], attempts: 1 };
  const intents = [intent];
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    talentInterview: { findUnique: jest.fn(async () => structuredClone(interview)),
      update: jest.fn(async ({ data }) => Object.assign(interview, data)),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.id !== interview.id || where.version !== interview.version) return { count: 0 };
        Object.assign(interview, data); return { count: 1 };
      }) },
    talentInterviewSync: {
      findMany: jest.fn(async ({ where }) => structuredClone(intents.filter(row =>
        (typeof where.status === 'string' ? [where.status] : where.status.in).includes(row.status)))),
      findUnique: jest.fn(async () => structuredClone({ ...intent, interview })),
      findFirst: jest.fn(async ({ where }) => intents.find(row => where.status.in.includes(row.status)) ?? null),
      update: jest.fn(async ({ data }) => {
        const { attempts, ...rest } = data;
        Object.assign(intent, rest);
        if (attempts) intent.attempts += attempts.increment;
        return structuredClone(intent);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const statuses = typeof where.status === 'string' ? [where.status] : where.status.in;
        if (intent.id !== where.id || !statuses.includes(intent.status) || intent.claimToken !== where.claimToken) return { count: 0 };
        Object.assign(intent, data); return { count: 1 };
      }),
    },
    externalIdentityBinding: { findMany: jest.fn(async () => [
      { userId: 'editor', externalUnionId: 'new-organizer-binding' },
      { userId: 'participant', externalUnionId: 'synthetic-participant' },
    ]) },
    auditLog: { create: jest.fn() },
  };
  let gate = Promise.resolve();
  prisma.$transaction = jest.fn(async (fn) => {
    const previous = gate;
    let release!: () => void;
    gate = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(prisma); } finally { release(); }
  });
  const calendar = { isEnabled: jest.fn().mockReturnValue(true), locate: jest.fn().mockResolvedValue({ kind: 'found', eventId: 'verified-event' }),
    create: jest.fn().mockRejectedValue(new Error('A reconciled intent must never create')),
    update: jest.fn().mockResolvedValue(undefined), cancel: jest.fn().mockResolvedValue(undefined) };
  return { interview, intent, intents, prisma, calendar, service: new InterviewCalendarReconciliationService(prisma, calendar as any) };
}

describe('Interview calendar reconciliation', () => {
  it('links exactly the verified event and queues the original version without creating a new intent', async () => {
    const { interview, intent, prisma, calendar, service } = setup();
    await expect(service.reconcile('interview', 3, editor)).resolves.toEqual({ status: 'pending', version: 3 });
    expect(calendar.locate).toHaveBeenCalledWith({ invitationId: 'interview', organizerUnionId: 'frozen-organizer', eventId: null, operation: 'upsert' });
    expect(interview).toMatchObject({ calendarEventId: 'verified-event', syncStatus: 'pending', version: 3, calendarSyncedVersion: 0 });
    expect(intent).toMatchObject({ status: 'pending', calendarEventId: 'verified-event', claimToken: null, claimedAt: null, operation: 'upsert', version: 3 });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ userId: editor.id, action: 'reconcile_talent_interview_calendar', entityId: 'interview' });
  });
  it('queues cancellation of the known event, not a create or an upsert', async () => {
    const { interview, intent, calendar, service } = setup();
    interview.status = 'cancelled'; intent.operation = 'cancel';
    interview.calendarEventId = intent.calendarEventId = 'verified-event';
    await service.reconcile('interview', 3, editor);
    expect(calendar.locate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'cancel', eventId: 'verified-event' }));
    expect(intent).toMatchObject({ operation: 'cancel', status: 'pending', calendarEventId: 'verified-event' });
  });
  it.each(['no_match', 'multiple_matches', 'read_failed', 'incomplete_response', 'event_unavailable'])('retains uncertainty on %s', async (reason) => {
    const { interview, intent, prisma, calendar, service } = setup();
    calendar.locate.mockResolvedValue({ kind: 'unresolved', reason } as any);
    await expect(service.reconcile('interview', 3, editor)).resolves.toEqual({ status: 'uncertain', version: 3, reason });
    expect(interview.syncStatus).toBe('uncertain');
    expect(intent.claimToken).toBe('old-claim');
    expect(prisma.talentInterviewSync.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  it('keeps disabled reconciliation entirely offline', async () => {
    const { prisma, calendar, service } = setup();
    calendar.isEnabled.mockReturnValue(false);
    await expect(service.reconcile('interview', 3, editor)).resolves.toEqual({ status: 'unconfigured', version: 3, reason: 'calendar_disabled' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(calendar.locate).not.toHaveBeenCalled();
  });
  it.each([
    { sysRole: 'employee', hrCapabilities: [] },
    { sysRole: 'hr_user', hrCapabilities: ['employee_archive_review'] },
  ])('rejects users without the existing archive-edit capability before reading anything', async (permissions) => {
    const { prisma, calendar, service } = setup();
    await expect(service.reconcile('interview', 3, { ...editor, ...permissions } as AuthUser)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(calendar.locate).not.toHaveBeenCalled();
  });
  it('rejects a stale client version before a remote read', async () => {
    const { calendar, service } = setup();
    await expect(service.reconcile('interview', 2, editor)).rejects.toThrow(ConflictException);
    expect(calendar.locate).not.toHaveBeenCalled();
  });
  it('does not take over a processing claim', async () => {
    const { intent, calendar, service } = setup(); intent.status = 'processing';
    await expect(service.reconcile('interview', 3, editor)).rejects.toThrow(ConflictException);
    expect(calendar.locate).not.toHaveBeenCalled();
  });
  it.each(['missing_organizer', 'different_calendar', 'different_event', 'older_intent', 'multiple_claims', 'wrong_operation'])('does not guess its way around %s', async (fault) => {
    const { interview, intent, intents, calendar, service } = setup();
    if (fault === 'missing_organizer') interview.calendarOrganizerUnionId = intent.calendarOrganizerUnionId = null;
    if (fault === 'different_calendar') intent.externalCalendarId = 'another-calendar';
    if (fault === 'different_event') { intent.calendarEventId = 'one'; interview.calendarEventId = 'another'; }
    if (fault === 'older_intent') intent.version = 2;
    if (fault === 'multiple_claims') intents.push({ ...intent, id: 'another-intent' });
    if (fault === 'wrong_operation') intent.operation = 'cancel';
    await expect(service.reconcile('interview', 3, editor)).resolves.toMatchObject({ status: 'uncertain', reason: 'context_mismatch' });
    expect(calendar.locate).not.toHaveBeenCalled();
  });
  it('does not hold a transaction during the remote read or overwrite a late authoritative finish', async () => {
    const { interview, intent, prisma, calendar, service } = setup();
    calendar.locate.mockImplementation(async () => {
      await prisma.$transaction(async () => {
        intent.status = 'synced'; intent.claimToken = null;
        interview.syncStatus = 'synced'; interview.calendarEventId = 'late-authoritative-id';
      });
      return { kind: 'found', eventId: 'verified-event' };
    });
    await expect(service.reconcile('interview', 3, editor)).rejects.toThrow(ConflictException);
    expect(interview.calendarEventId).toBe('late-authoritative-id');
    expect(prisma.talentInterviewSync.updateMany).not.toHaveBeenCalled();
  });
  it('only one concurrent reconciliation can requeue and audit the same claim', async () => {
    const { prisma, calendar, service } = setup();
    let reads = 0, release!: () => void;
    const bothReading = new Promise<void>(resolve => { release = resolve; });
    calendar.locate.mockImplementation(async () => {
      if (++reads === 2) release(); await bothReading;
      return { kind: 'found', eventId: 'verified-event' };
    });
    const results = await Promise.allSettled([service.reconcile('interview', 3, editor), service.reconcile('interview', 3, editor)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('retains uncertainty and redacts unexpected provider failures', async () => {
    const { intent, calendar, service } = setup();
    calendar.locate.mockRejectedValue(new Error('secret provider body'));
    await expect(service.reconcile('interview', 3, editor)).resolves.toEqual({ status: 'uncertain', version: 3, reason: 'read_failed' });
    expect(intent.status).toBe('uncertain');
  });
  it.each(['upsert', 'cancel'])('runs real dispatcher claim and finish for recovered %s without ever calling create', async (operation) => {
    const { interview, intent, prisma, calendar, service } = setup();
    if (operation === 'cancel') { interview.status = 'cancelled'; intent.operation = 'cancel'; }
    await service.reconcile('interview', 3, editor);
    const dispatcher = new InterviewCalendarDispatcher(prisma, calendar as any);
    await dispatcher.dispatch();
    expect(calendar.create).not.toHaveBeenCalled();
    expect(operation === 'cancel' ? calendar.cancel : calendar.update).toHaveBeenCalledWith('verified-event',
      expect.objectContaining({ organizerUnionId: 'frozen-organizer' }));
    expect(interview).toMatchObject({ syncStatus: 'synced', calendarEventId: 'verified-event', calendarSyncedVersion: 3 });
    expect(intent.status).toBe('synced');
  });
  it('fences the original late finish after reconciliation and before the next dispatch', async () => {
    const { interview, intent, prisma, calendar, service } = setup();
    await service.reconcile('interview', 3, editor);
    const dispatcher = new InterviewCalendarDispatcher(prisma, calendar as any);
    await (dispatcher as any).finish({ id: 'intent', interviewId: 'interview', version: 3, claimToken: 'old-claim' }, 'synced', 'stale-event');
    expect(interview).toMatchObject({ syncStatus: 'pending', calendarEventId: 'verified-event' });
    expect(intent.status).toBe('pending');
    expect(calendar.create).not.toHaveBeenCalled();
  });
});
