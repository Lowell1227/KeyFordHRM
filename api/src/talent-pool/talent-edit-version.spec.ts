import { ConflictException } from '@nestjs/common';
import { TalentsService } from './talents.service';
import type { AuthUser } from '@/common/types/auth.types';

const hr = { id: 'synthetic-hr', sysRole: 'hr' } as AuthUser;

function fixture() {
  const row: any = { id: 'synthetic-talent', name: 'Synthetic', phone: '10000000000',
    status: 'new', note: 'Original', appliedPosition: 'Original position',
    deletedAt: null, expectSalaryMin: 10, expectSalaryMax: 20,
    updatedAt: new Date('2026-11-17T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'),
    files: [], followUps: [], shares: [], tags: [] };
  const auditLog = { create: jest.fn() };
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: row.id }]),
    talentCandidate: {
      findFirst: jest.fn(async () => row.deletedAt ? null : { ...row }),
      update: jest.fn(async ({ data }) => { Object.assign(row, data); return { ...row }; }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) }, auditLog,
    $transaction: jest.fn(async callback => callback(prisma)),
  };
  return { row, prisma, sut: new TalentsService(prisma) };
}

describe('talent edit baseline', () => {
  it('rejects a stale full form and preserves the first HR edit', async () => {
    const { row, prisma, sut } = fixture();
    const original: any = await sut.detail(row.id);
    await sut.update(row.id, { note: 'First HR edit', editVersion: original.editVersion } as never, hr);
    await expect(sut.update(row.id, { note: 'Original', appliedPosition: 'Second HR edit',
      editVersion: original.editVersion } as never, hr)).rejects.toBeInstanceOf(ConflictException);
    expect(row.note).toBe('First HR edit');
    expect(row.appliedPosition).toBe('Original position');
    expect(prisma.talentCandidate.update).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', 'invalid'])('does not accept an absent or malformed baseline: %s', async editVersion => {
    const { row, prisma, sut } = fixture();
    await expect(sut.update(row.id, { note: 'Unsafe', editVersion } as never, hr)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refresh returns a new baseline and legitimate edits advance update time without exposing audit values', async () => {
    const { row, prisma, sut } = fixture();
    const before: any = await sut.detail(row.id);
    expect(before.editVersion).toMatch(/^[a-f0-9]{64}$/);
    const oldDate = row.updatedAt.getTime();
    const saved: any = await sut.update(row.id, { note: 'Sensitive synthetic note',
      editVersion: before.editVersion } as never, hr);
    expect(saved.editVersion).not.toBe(before.editVersion);
    expect(row.updatedAt.getTime()).toBeGreaterThan(oldDate);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'update_talent_candidate', newValue: { changedFields: ['note'] },
    }) }));
    const audit = JSON.stringify(prisma.auditLog.create.mock.calls);
    expect(audit).not.toContain('Sensitive synthetic note');
    expect(audit).not.toContain(row.phone);
    await expect(sut.update(row.id, { appliedPosition: 'Allowed after refresh', editVersion: saved.editVersion } as never, hr))
      .resolves.toMatchObject({ appliedPosition: 'Allowed after refresh' });
  });

  it('a same-value submission does not change the timestamp or create audit noise', async () => {
    const { row, prisma, sut } = fixture();
    const before: any = await sut.detail(row.id);
    const saved: any = await sut.update(row.id, { note: row.note, editVersion: before.editVersion } as never, hr);
    expect(saved.editVersion).toBe(before.editVersion);
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('arrival changes invalidate the old form even when its timestamp was not advanced', async () => {
    const { row, prisma, sut } = fixture();
    const before: any = await sut.detail(row.id);
    Object.assign(row, { status: 'hired', convertedUserId: 'synthetic-employee', convertedAt: new Date() });
    await expect(sut.update(row.id, { note: 'Stale ordinary field', editVersion: before.editVersion } as never, hr))
      .rejects.toBeInstanceOf(ConflictException);
    expect(row.convertedUserId).toBe('synthetic-employee');
    expect(prisma.talentCandidate.update).not.toHaveBeenCalled();
  });

  it('a stale status after arrival returns the reloadable edit conflict before terminal validation', async () => {
    const { row, sut } = fixture();
    const before = await sut.detail(row.id);
    Object.assign(row, { status: 'hired', convertedUserId: 'synthetic-employee', convertedAt: new Date() });
    await expect(sut.update(row.id, { status: 'new', note: 'Retained input', editVersion: before.editVersion }, hr))
      .rejects.toMatchObject({ response: expect.objectContaining({ data: { reason: 'TALENT_EDIT_CONFLICT' } }) });
    const current = await sut.detail(row.id);
    await expect(sut.update(row.id, { status: 'new', editVersion: current.editVersion }, hr))
      .rejects.toThrow('已入职为终态');
  });
});
