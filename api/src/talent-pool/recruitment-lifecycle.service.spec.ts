import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { RecruitmentLifecycleService } from './recruitment-lifecycle.service';

const actor = { id: 'operator', sysRole: 'employee', status: 'active', hrCapabilities: ['recruitment_edit'] };
const user = { id: actor.id } as AuthUser;
function fixture() {
  const order: string[] = [];
  const row = { id: 'demand', revision: 4, trackingState: 'recruiting', trackingChangedAt: null,
    trackingChangedById: null, trackingReason: null, sourceState: 'approved', sourceFingerprint: 'source', mappedFingerprint: 'source', approvedHeadcount: 2 };
  const tx = {
    $queryRaw: jest.fn(async (sql: { strings: string[] } | TemplateStringsArray) => {
      const query = ('strings' in sql ? sql.strings : sql).join('');
      if (query.includes('pg_advisory_xact_lock')) order.push('ledger');
      if (query.includes('FOR SHARE')) order.push('actor-lock');
      return query.includes('inProgressCount') ? [{ inProgressCount: 3n }] : [];
    }),
    user: { findUnique: jest.fn(async () => { order.push('actor'); return actor; }), findMany: jest.fn().mockResolvedValue([]) },
    recruitmentDemand: { findUnique: jest.fn(async () => { order.push('demand'); return { ...row }; }),
      update: jest.fn(async ({ data }) => { Object.assign(row, data); return { ...row }; }) },
    recruitmentPosting: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    talentApplication: { findMany: jest.fn().mockResolvedValue([]) },
    recruitmentDemandEvent: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: jest.fn(async callback => callback(tx)) };
  const demands = { currentIntent: jest.fn(async () => ({ revision: row.revision, usable: true })) };
  return { row, order, tx, db, demands, service: new RecruitmentLifecycleService(db as never, demands as never) };
}

describe('recruitment lifecycle mutations', () => {
  it('locks the ledger and actor before rechecking qualification and changes only tracking fields with the shared revision', async () => {
    const { service, tx, db, order } = fixture();
    const result = await service.change('demand', { expectedRevision: 4, trackingState: 'paused', reason: '  Synthetic pause  ' }, user);
    expect(order.slice(0, 4)).toEqual(['ledger', 'actor-lock', 'actor', 'demand']);
    expect(result).toMatchObject({ revision: 5, trackingState: 'paused', trackingReason: 'Synthetic pause', summary: { approvedHeadcount: 2, occupiedCount: 0, inProgressCount: 3 } });
    const data = tx.recruitmentDemand.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['revision', 'trackingState', 'trackingChangedAt', 'trackingChangedById', 'trackingReason'].sort());
    expect(tx.recruitmentDemandEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      demandId: 'demand', revision: 5, actorId: actor.id, action: 'tracking_change', reason: 'Synthetic pause',
      snapshot: expect.objectContaining({ previousTrackingState: 'recruiting', trackingState: 'paused', inProgressCount: 3 }),
    }) }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'ReadCommitted' }));
  });

  it('rejects a stale revision without changing a record or producing an event', async () => {
    const { service, tx } = fixture();
    await expect(service.change('demand', { expectedRevision: 3, trackingState: 'filled', reason: 'Synthetic filled' }, user)).rejects.toThrow(ConflictException);
    expect(tx.recruitmentDemand.update).not.toHaveBeenCalled(); expect(tx.recruitmentDemandEvent.create).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('requires a nonblank reason (%j)', async reason => {
    const { service, tx } = fixture();
    await expect(service.change('demand', { expectedRevision: 4, trackingState: 'cancelled', reason }, user)).rejects.toThrow(BadRequestException);
    expect(tx.recruitmentDemand.update).not.toHaveBeenCalled();
  });

  it('rejects an unsupported state, unsafe revision and an unchanged state', async () => {
    for (const input of [
      { expectedRevision: 4, trackingState: 'approved', reason: 'Synthetic' },
      { expectedRevision: -1, trackingState: 'filled', reason: 'Synthetic' },
      { expectedRevision: 2147483647, trackingState: 'filled', reason: 'Synthetic' },
      { expectedRevision: 4, trackingState: 'recruiting', reason: 'Synthetic' },
    ]) {
      const { service, tx } = fixture();
      await expect(service.change('demand', input as never, user)).rejects.toThrow(BadRequestException);
      expect(tx.recruitmentDemand.update).not.toHaveBeenCalled();
    }
  });

  it.each([
    { ...actor, hrCapabilities: ['recruitment_view'] },
    { ...actor, hrCapabilities: ['talent_hiring_confirm'] },
    { ...actor, hrCapabilities: ['recruitment_demand_review'] },
    { ...actor, status: 'resigned' },
    { ...actor, isAssessorOnly: true },
  ])('rechecks current permissions after taking the lock: %j', async current => {
    const { service, tx, order } = fixture(); tx.user.findUnique.mockResolvedValue(current);
    await expect(service.change('demand', { expectedRevision: 4, trackingState: 'filled', reason: 'Synthetic' }, { ...user, sysRole: 'hr' })).rejects.toThrow(ForbiddenException);
    expect(order.slice(0, 2)).toEqual(['ledger', 'actor-lock']); expect(tx.recruitmentDemand.findUnique).not.toHaveBeenCalled();
  });

  it('does not disclose editor-only external posting metadata to recruitment viewers', async () => {
    const { service, tx } = fixture(); tx.user.findUnique.mockResolvedValue({ ...actor, hrCapabilities: ['recruitment_view'] });
    const result = await service.detail('demand', user);
    expect(result).toMatchObject({ canEdit: false, externalPostings: [] });
    expect(tx.recruitmentPosting.findMany).not.toHaveBeenCalled();
  });

  it('leaves capacity unknown when the existing demand service rejects usability despite an approved sourceState', async () => {
    const { service, demands } = fixture(); demands.currentIntent.mockResolvedValue({ revision: 4, usable: false });
    expect(await service.detail('demand', user)).toMatchObject({ summary: { approvedHeadcount: 2, occupiedCount: 0, remainingCount: null, overCount: null } });
  });
});
