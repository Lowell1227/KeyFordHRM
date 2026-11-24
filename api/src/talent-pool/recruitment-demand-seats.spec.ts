import { attachRecruitmentDemandSeats, summarizeRecruitmentDemandSeats } from './recruitment-demand-seats';

const demand = { id: 'demand-a', approvedHeadcount: 2, usable: true };
const acceptance = { action: 'accept_offer', version: 3 };
const termination = { action: 'terminate_offer', version: 5 };
const fact = (stage = 'accepted', events = [acceptance], id = 'app-a') => ({ id, recruitmentDemandId: demand.id, stage, events });

describe('recruitment demand seats: explicit application events', () => {
  it.each(['screening', 'hiring_review', 'offered'])('does not occupy before acceptance: %s', stage => {
    expect(summarizeRecruitmentDemandSeats(demand, [fact(stage, [])])).toEqual({ occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2, overCount: 0 });
  });

  it('occupies one seat on candidate acceptance, not once per event or request retry', () => {
    expect(summarizeRecruitmentDemandSeats(demand, [fact('accepted', [acceptance, acceptance])])).toEqual({ occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0 });
  });

  it.each(['accepted', 'onboarding'])('keeps the seat during rescheduling and repeatable onboarding cancellation: %s', stage => {
    const events = [acceptance, { action: 'cancel_onboarding', version: 4 }, { action: 'update', version: 6 }];
    expect(summarizeRecruitmentDemandSeats(demand, [fact(stage, events)]).occupiedCount).toBe(1);
  });

  it('counts arrival as hired without releasing the occupied seat', () => {
    expect(summarizeRecruitmentDemandSeats(demand, [fact('hired', [acceptance, { action: 'activate_onboarding', version: 4 }])]))
      .toEqual({ occupiedCount: 1, acceptedCount: 0, hiredCount: 1, remainingCount: 1, overCount: 0 });
  });

  it('releases only after an explicit termination event, not a generic withdrawal', () => {
    expect(summarizeRecruitmentDemandSeats(demand, [fact('withdrawn', [acceptance, { action: 'withdraw', version: 5 }])]).occupiedCount).toBe(1);
    expect(summarizeRecruitmentDemandSeats(demand, [fact('withdrawn', [acceptance, termination, termination])]))
      .toEqual({ occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2, overCount: 0 });
  });

  it('uses application versions rather than array order and counts a renewed acceptance only once', () => {
    expect(summarizeRecruitmentDemandSeats(demand, [fact('accepted', [termination, { action: 'accept_offer', version: 8 }, acceptance])]).occupiedCount).toBe(1);
  });

  it('counts different applications independently and does not infer a quota-blocking policy', () => {
    const summary = summarizeRecruitmentDemandSeats(demand, [fact(), fact('accepted', [acceptance], 'app-b'), fact('hired', [acceptance], 'app-c')]);
    expect(summary).toEqual({ occupiedCount: 3, acceptedCount: 2, hiredCount: 1, remainingCount: 0, overCount: 1 });
  });

  it('does not attribute another demand or legacy unlinked application to this request', () => {
    expect(summarizeRecruitmentDemandSeats(demand, [{ ...fact(), recruitmentDemandId: 'other' }, { ...fact(), id: 'legacy', recruitmentDemandId: null }]).occupiedCount).toBe(0);
  });

  it('does not display zero available places when the approved capacity is unverified', () => {
    expect(summarizeRecruitmentDemandSeats({ ...demand, usable: false }, [fact()])).toMatchObject({ occupiedCount: 1, remainingCount: null, overCount: null });
    expect(summarizeRecruitmentDemandSeats({ ...demand, approvedHeadcount: null }, [fact()])).toMatchObject({ remainingCount: null, overCount: null });
  });

  it('loads narrow facts in one query, without interpreting deleted candidate data as termination', async () => {
    const findMany = jest.fn().mockResolvedValue([fact()]);
    const rows = await attachRecruitmentDemandSeats({ talentApplication: { findMany } } as never, [demand, { ...demand, id: 'other' }]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toEqual({
      where: { recruitmentDemandId: { in: ['demand-a', 'other'] } },
      select: { id: true, recruitmentDemandId: true, stage: true, events: {
        where: { action: { in: ['accept_offer', 'terminate_offer'] } }, orderBy: { version: 'desc' }, take: 1,
        select: { action: true, version: true },
      } },
    });
    expect(rows).toEqual([{ ...demand, occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0 },
      { ...demand, id: 'other', occupiedCount: 0, acceptedCount: 0, hiredCount: 0, remainingCount: 2, overCount: 0 }]);
  });

  it('avoids a query for an empty list and propagates errors instead of displaying false zeros', async () => {
    const findMany = jest.fn().mockRejectedValue(new Error('fictional query failure'));
    const db = { talentApplication: { findMany } } as never;
    expect(await attachRecruitmentDemandSeats(db, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    await expect(attachRecruitmentDemandSeats(db, [demand])).rejects.toThrow('fictional query failure');
  });
});
