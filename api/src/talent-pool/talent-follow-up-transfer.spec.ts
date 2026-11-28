import { ConflictException } from '@nestjs/common';
import { selectIntakeFollowUpSource, transferIntakeFollowUpPlan } from './talent-follow-up-transfer';

const source = { id: 'intake', nextFollowUpAt: new Date('2026-12-01T17:30:00.000Z') };
function setup(current: Record<string, unknown> | null = null) {
  const created: any[] = [];
  const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'candidate' }]),
    talentFollowUp: { findUnique: jest.fn(async () => created[0] ?? null), findFirst: jest.fn(async () => current),
      create: jest.fn(async ({ data }) => { const row = { id: 'transferred', ...data }; created.push(row); return row; }),
      update: jest.fn(async ({ data }) => ({ ...current, ...data })) },
    talentCandidate: { updateMany: jest.fn() }, auditLog: { create: jest.fn() } };
  return { tx, created };
}
describe('intake follow-up plan transfer', () => {
  it('selects the shown primary or unique associated promise, requiring a choice for multiple associated promises', () => {
    const main = { id: 'main', nextFollowUpAt: null };
    const related = [{ ...source, associatedToId: main.id }];
    expect(selectIntakeFollowUpSource(main, related, {})).toEqual(related[0]);
    expect(selectIntakeFollowUpSource({ ...main, nextFollowUpAt: source.nextFollowUpAt }, related, {})?.id).toBe(main.id);
    const second = { id: 'second', associatedToId: main.id, nextFollowUpAt: new Date('2026-12-03') };
    expect(() => selectIntakeFollowUpSource(main, [...related, second], {})).toThrow(ConflictException);
    expect(selectIntakeFollowUpSource(main, [...related, second], { followUpSourceIntakeId: 'second', expectedFollowUpSourceAt: second.nextFollowUpAt.toISOString() })?.id).toBe('second');
    for (const choice of [{ followUpSourceIntakeId: 'unrelated' }, { followUpSourceIntakeId: 'second', expectedFollowUpSourceAt: '2026-12-04T00:00:00Z' }]) {
      expect(() => selectIntakeFollowUpSource(main, [...related, second], choice)).toThrow(ConflictException);
    }
  });
  it('carries a plan and exact source time once, without claiming a communication or changing talent ownership', async () => {
    const { tx } = setup();
    await transferIntakeFollowUpPlan(tx, source, 'candidate', {}, 'operator');
    expect(tx.talentFollowUp.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recordType: 'plan', sourceIntakeId: source.id,
      sourceFollowUpAt: source.nextFollowUpAt, nextFollowUpAt: new Date('2026-12-02T00:00:00.000Z'), planStatus: 'pending' }) });
    expect(tx.talentCandidate.updateMany).not.toHaveBeenCalled();
    await transferIntakeFollowUpPlan(tx, source, 'candidate', {}, 'operator');
    expect(tx.talentFollowUp.create).toHaveBeenCalledTimes(1);
  });
  it('preserves the current plan by default and retains the incoming promise as an inactive source record', async () => {
    const { tx } = setup({ id: 'prior', nextFollowUpAt: new Date('2026-12-03'), sourceFollowUpAt: null });
    await transferIntakeFollowUpPlan(tx, source, 'candidate', {}, 'operator');
    expect(tx.talentFollowUp.update).not.toHaveBeenCalled();
    expect(tx.talentFollowUp.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recordType: 'plan', planStatus: 'superseded' }) });
  });
  it('requires an exact pending-plan comparison before replacement and never writes after a stale choice', async () => {
    const { tx } = setup({ id: 'prior', nextFollowUpAt: new Date('2026-12-03'), sourceFollowUpAt: null });
    for (const expectedFollowUpPlanId of [undefined, null, 'stale']) {
      await expect(transferIntakeFollowUpPlan(tx, source, 'candidate', { followUpPlanAction: 'replace', expectedFollowUpPlanId }, 'operator')).rejects.toThrow(ConflictException);
    }
    expect(tx.talentFollowUp.create).not.toHaveBeenCalled(); expect(tx.talentFollowUp.update).not.toHaveBeenCalled();
    await transferIntakeFollowUpPlan(tx, source, 'candidate', { followUpPlanAction: 'replace', expectedFollowUpPlanId: 'prior' }, 'operator');
    expect(tx.talentFollowUp.update).toHaveBeenCalledWith({ where: { id: 'prior' }, data: expect.objectContaining({ planStatus: 'superseded' }) });
    expect(tx.talentFollowUp.create).toHaveBeenCalledWith({ data: expect.objectContaining({ planStatus: 'pending' }) });
  });
});
