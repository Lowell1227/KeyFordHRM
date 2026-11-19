import { resolveTalentApplicationSource, syncTalentApplicationOnboarding } from './employee-talent-source';

function fixture(stage = 'accepted') {
  const application = { id: 'app', candidateId: 'candidate', stage, revision: 2 };
  const tx: any = { $queryRaw: jest.fn(),
    talentApplication: {
      findUnique: jest.fn(async () => ({ ...application })),
      updateMany: jest.fn(async ({ data }) => { application.stage = data.stage; application.revision++; return { count: 1 }; }),
    }, talentApplicationEvent: { create: jest.fn() },
  };
  return { application, tx };
}

describe('recruitment and onboarding source contract', () => {
  it('requires accepted recruitment for new talent intake, not for direct employee entry', async () => {
    const { tx } = fixture();
    await expect(resolveTalentApplicationSource(tx, 'candidate')).rejects.toThrow('接受录用');
    await expect(resolveTalentApplicationSource(tx, null)).resolves.toBeNull();
    await expect(resolveTalentApplicationSource(tx, 'candidate', 'app')).resolves.toBe('app');
  });
  it.each(['screening', 'hiring_review', 'offered', 'hired'])('rejects intake at %s', async stage => {
    const { tx } = fixture(stage);
    await expect(resolveTalentApplicationSource(tx, 'candidate', 'app')).rejects.toThrow();
  });
  it('preserves old requests that did not have recruitment records', async () => {
    const { tx } = fixture();
    await expect(resolveTalentApplicationSource(tx, 'candidate', undefined, { id: 'legacy', talentCandidateId: 'candidate' })).resolves.toBeNull();
    expect(tx.talentApplication.findUnique).not.toHaveBeenCalled();
  });
  it('rejects changing source or cross-candidate applications', async () => {
    const { tx } = fixture();
    await expect(resolveTalentApplicationSource(tx, 'other', 'app')).rejects.toThrow('不一致');
    await expect(resolveTalentApplicationSource(tx, 'candidate', 'another', { id: 'request', talentApplicationId: 'app' })).rejects.toThrow('不能更换');
  });
  it('retains immutable progress events for start, cancel, resume and arrival', async () => {
    const { tx, application } = fixture();
    const request = { id: 'request', talentApplicationId: 'app' };
    for (const stage of ['onboarding', 'accepted', 'onboarding', 'hired'] as const) {
      await syncTalentApplicationOnboarding(tx, request, stage, 'actor');
    }
    expect(application).toMatchObject({ stage: 'hired', revision: 6 });
    expect(tx.talentApplicationEvent.create.mock.calls.map(([arg]: any[]) => arg.data.action))
      .toEqual(['start_onboarding', 'cancel_onboarding', 'start_onboarding', 'activate_onboarding']);
    await syncTalentApplicationOnboarding(tx, request, 'hired', 'actor');
    expect(tx.talentApplicationEvent.create).toHaveBeenCalledTimes(4);
  });
  it('does not activate an application from the wrong stage or a stale version', async () => {
    const { tx } = fixture();
    await expect(syncTalentApplicationOnboarding(tx, { id: 'r', talentApplicationId: 'app' }, 'hired', 'actor')).rejects.toThrow('已变化');
    tx.talentApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(syncTalentApplicationOnboarding(tx, { id: 'r', talentApplicationId: 'app' }, 'onboarding', 'actor')).rejects.toThrow('已变化');
    expect(tx.talentApplicationEvent.create).not.toHaveBeenCalled();
  });
});
