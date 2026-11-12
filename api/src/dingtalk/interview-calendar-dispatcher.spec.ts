import { InterviewCalendarDispatcher } from './interview-calendar-dispatcher';
import { CalendarSyncError } from './interview-calendar.service';

describe('Interview calendar durable dispatcher', () => {
  let service: InterviewCalendarDispatcher;
  let db: any;
  let calendar: any;
  const claimed = { id: 'intent', interviewId: 'interview', version: 1, operation: 'upsert', claimToken: 'claim',
    eventId: null, event: { invitationId: 'interview', version: 1, organizerUnionId: 'bound-organizer',
      participantUnionIds: ['bound-person'], summary: 'Synthetic', description: 'Synthetic',
      startsAt: new Date(), endsAt: new Date() } };
  beforeEach(() => {
    db = { talentInterviewSync: { findMany: jest.fn().mockResolvedValue([{ id: 'intent' }]) } };
    calendar = { isEnabled: jest.fn().mockReturnValue(true), create: jest.fn().mockResolvedValue('external-event'),
      update: jest.fn(), cancel: jest.fn() };
    service = new InterviewCalendarDispatcher(db, calendar);
    jest.spyOn(service as any, 'expireClaims').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'claim').mockResolvedValue(claimed);
    jest.spyOn(service as any, 'finish').mockResolvedValue(undefined);
  });
  it('never dispatches without explicit calendar enablement', async () => {
    calendar.isEnabled.mockReturnValue(false);
    await service.dispatch();
    expect(db.talentInterviewSync.findMany).not.toHaveBeenCalled();
  });
  it('persists the external id after a claimed create', async () => {
    await service.dispatch();
    expect(calendar.create).toHaveBeenCalledTimes(1);
    expect((service as any).finish).toHaveBeenCalledWith(claimed, 'synced', 'external-event');
  });
  it('never creates another event for an update or cancellation', async () => {
    (service as any).claim.mockResolvedValue({ ...claimed, eventId: 'external-event' });
    await service.dispatch();
    expect(calendar.update).toHaveBeenCalledWith('external-event', claimed.event);
    (service as any).claim.mockResolvedValue({ ...claimed, eventId: 'external-event', operation: 'cancel' });
    await service.dispatch();
    expect(calendar.cancel).toHaveBeenCalledWith('external-event', claimed.event);
    expect(calendar.create).not.toHaveBeenCalled();
  });
  it('records uncertainty and never retries a create inside the dispatcher', async () => {
    calendar.create.mockRejectedValue(new CalendarSyncError('uncertain', 'secret-provider-details'));
    await service.dispatch();
    expect((service as any).finish).toHaveBeenCalledWith(claimed, 'uncertain', null);
    expect(calendar.create).toHaveBeenCalledTimes(1);
  });
  it('does not send stale, blocked or concurrently claimed intentions', async () => {
    (service as any).claim.mockResolvedValue(null);
    await service.dispatch();
    expect(calendar.create).not.toHaveBeenCalled();
  });
});
