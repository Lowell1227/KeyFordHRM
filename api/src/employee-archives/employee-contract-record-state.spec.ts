import { EmployeeArchivesController } from './employee-archives.controller';

const appliedAt = new Date('2026-11-17T06:00:00Z');
const contract = (extra = {}) => ({ id: 'contract-1', isActive: false,
  endedAt: new Date('2026-11-17T05:59:59Z'), name: 'Synthetic contract', ...extra });
const change = (extra = {}) => ({ id: 'request-1', sourceType: 'manual_archive_change',
  recordStatus: 'submitted', profileReviewStatus: 'approved', appliedAt, cancelledAt: null,
  baseValue: { contracts: [{ id: 'contract-1' }] }, proposedValue: { contracts: [] }, ...extra });

async function archiveView(contracts: any[], changes: any[]) {
  const archive = { id: 'employee-1', employeeContracts: contracts };
  const history = { changeHistory: changes, archiveEvents: [] };
  const archives = { findOne: jest.fn(async () => archive), history: jest.fn(async () => history) };
  const controller = new EmployeeArchivesController(archives as any, {} as any, {} as any,
    {} as any, {} as any, {} as any);
  return { view: await controller.findOne('employee-1') as any, archive, history, archives };
}

describe('archive contract record provenance', () => {
  it('returns minimized removal metadata only for an applied manual deletion and retains the history', async () => {
    const row = contract();
    const request = change();
    const { view, archive, history, archives } = await archiveView([row], [request]);
    expect(view.employeeContracts[0]).toMatchObject({ id: row.id, recordState: 'removed',
      recordStateLabel: '已移除', recordStateAt: appliedAt.toISOString() });
    expect(view.changeHistory).toEqual(history.changeHistory);
    expect(archive.employeeContracts[0]).toBe(row);
    expect(row).not.toHaveProperty('recordState');
    expect(archives.findOne).toHaveBeenCalledWith('employee-1');
    expect(archives.history).toHaveBeenCalledWith('employee-1');
    expect(view.employeeContracts[0]).not.toHaveProperty('removalRequest');
  });

  it('always keeps a currently active record active even if an older deletion exists', async () => {
    const { view } = await archiveView([contract({ isActive: true, endedAt: null })], [change()]);
    expect(view.employeeContracts[0]).toMatchObject({ recordState: 'active' });
    expect(view.employeeContracts[0].recordStateAt).toBeUndefined();
  });

  it.each([
    [],
    [change({ sourceType: 'employee_roster_import' })],
    [change({ sourceSystem: 'archive_assistant_pilot' })],
    [change({ recordStatus: 'draft' })],
    [change({ recordStatus: undefined })],
    [change({ profileReviewStatus: 'pending' })],
    [change({ appliedAt: null })],
    [change({ cancelledAt: appliedAt })],
    [change({ baseValue: {} })],
    [change({ proposedValue: {} })],
    [change({ proposedValue: { contracts: null } })],
    [change({ proposedValue: { contracts: [null] } })],
    [change({ baseValue: { contracts: [{ id: 'another-contract' }] } })],
    [change({ proposedValue: { contracts: [{ id: 'contract-1' }] } })],
  ].map(changes => [changes]))('keeps unknown or non-applied inactive provenance retained: %j', async changes => {
    const { view } = await archiveView([contract()], changes);
    expect(view.employeeContracts[0]).toMatchObject({ recordState: 'retained', recordStateLabel: '历史留存' });
    expect(view.employeeContracts[0].recordStateAt).toBeUndefined();
  });

  it('keeps archived applied removal evidence, without treating archive time as termination', async () => {
    const { view } = await archiveView([contract()], [change({ archivedAt: new Date('2026-11-18') })]);
    expect(view.employeeContracts[0]).toMatchObject({ recordState: 'removed', recordStateAt: appliedAt.toISOString() });
  });

  it('does not use old removal evidence after a later applied snapshot retained the ID', async () => {
    const newer = change({ id: 'request-2', appliedAt: new Date('2026-11-18'),
      proposedValue: { contracts: [{ id: 'contract-1' }] } });
    const { view } = await archiveView([contract()], [change(), newer]);
    expect(view.employeeContracts[0].recordState).toBe('retained');
  });

  it('does not attribute a later stop time to an older manual removal', async () => {
    const { view } = await archiveView([contract({ endedAt: new Date('2026-11-19') })], [change()]);
    expect(view.employeeContracts[0].recordState).toBe('retained');
  });

  it('does not guess order when same-time applied snapshots disagree about removal', async () => {
    const kept = change({ id: 'request-2', proposedValue: { contracts: [{ id: 'contract-1' }] } });
    for (const changes of [[change(), kept], [kept, change()]]) {
      const { view } = await archiveView([contract()], changes);
      expect(view.employeeContracts[0].recordState).toBe('retained');
    }
  });

  it('does not mutate contracts or expose request details when no history exists', async () => {
    const { view } = await archiveView([contract({ sourceBatchId: 'import-batch' }), contract({ id: 'current', isActive: true })], []);
    expect(view.employeeContracts.map((row: any) => row.recordState)).toEqual(['retained', 'active']);
  });
});
