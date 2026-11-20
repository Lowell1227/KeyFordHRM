import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentSharesService } from './talent-shares.service';
import { CreateShareDto } from './dto/create-share.dto';

const actor = { id: 'hr', name: 'Synthetic HR' } as AuthUser;
const requestId = '00000000-0000-4000-8000-000000000001';
const input = { requestId, recipientIds: ['recipient-a', 'recipient-b'], expiresInDays: 7, message: ' Synthetic message ' };

// Stateful transaction double: proves service transaction boundaries, not PostgreSQL acceptance.
function fixture() {
  let state: any = { shares: [], notifications: [], audits: [] };
  const trace: string[] = [];
  const candidate = { id: 'candidate', name: 'Synthetic', deletedAt: null as Date | null };
  let failAt: 'notification' | 'audit' | null = null;
  let recipients = ['recipient-a', 'recipient-b'];
  const client = (get: () => any, scope: string): any => ({
    $queryRaw: jest.fn(async () => { trace.push(`${scope}:lock`); return [{ id: candidate.id }]; }),
    talentCandidate: { findFirst: jest.fn(async () => { trace.push(`${scope}:candidate`); return candidate.deletedAt ? null : candidate; }) },
    employmentRecord: { findMany: jest.fn(async () => { trace.push(`${scope}:employment`); return []; }) },
    user: { findMany: jest.fn(async () => { trace.push(`${scope}:recipients`); return recipients.map(id => ({ id })); }) },
    talentShare: {
      findUnique: jest.fn(async ({ where }) => get().shares.find(s => s.requestId === where.requestId) ?? null),
      create: jest.fn(async ({ data }) => {
        const share = { id: `share-${get().shares.length + 1}`, createdAt: new Date(), ...data };
        get().shares.push(share); trace.push(`${scope}:share`); return share;
      }),
    },
    notificationLog: { create: jest.fn(async ({ data }) => {
      if (failAt === 'notification' && get().notifications.length === 1) throw new Error('Synthetic notification failure');
      get().notifications.push(data); trace.push(`${scope}:notification`);
    }) },
    auditLog: { create: jest.fn(async ({ data }) => {
      if (failAt === 'audit') throw new Error('Synthetic audit failure');
      get().audits.push(data); trace.push(`${scope}:audit`);
    }) },
  });
  const prisma = client(() => state, 'outside');
  prisma.$transaction = jest.fn(async callback => {
    const pending = structuredClone(state);
    const result = await callback(client(() => pending, 'tx'));
    state = pending;
    return result;
  });
  const sut = new TalentSharesService(prisma, { findActive: async () => candidate } as any);
  return { sut, trace, candidate, state: () => state, fail: (at: typeof failAt) => { failAt = at; },
    recipients: (ids: string[]) => { recipients = ids; } };
}

describe('atomic idempotent talent sharing', () => {
  it('external response-loss retry returns the same token without recipient lookup or notifications', async () => {
    const f = fixture();
    const external = { requestId, isPublicLink: true, expiresInDays: 7 };
    const first = await f.sut.create('candidate', external, actor);
    const second = await f.sut.create('candidate', external, actor);
    expect(second).toEqual(first);
    expect(f.state().shares).toHaveLength(1);
    expect(f.state().shares[0]).toMatchObject({ isPublicLink: true, recipientIds: [], includeResume: false });
    expect(f.state().notifications).toHaveLength(0);
    expect(f.state().audits).toHaveLength(1);
    expect(f.trace).not.toContain('tx:recipients');
    await expect(f.sut.create('candidate', input, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().shares).toHaveLength(1);
  });

  it.each(['notification', 'audit'] as const)('rolls back share and every notification when %s fails; retry creates exactly one set', async failure => {
    const f = fixture();
    f.fail(failure);
    await expect(f.sut.create('candidate', input, actor)).rejects.toThrow(`Synthetic ${failure} failure`);
    expect(f.state()).toEqual({ shares: [], notifications: [], audits: [] });
    f.fail(null);
    const result = await f.sut.create('candidate', input, actor);
    expect(result.id).toBe('share-1');
    expect(f.state().shares).toHaveLength(1);
    expect(f.state().notifications).toHaveLength(2);
    expect(f.state().audits).toHaveLength(1);
    expect(f.trace[0]).toBe('tx:lock');
    expect(f.trace.every(event => event.startsWith('tx:'))).toBe(true);
    expect(f.state().notifications.every(n => n.channel === 'system')).toBe(true);
    expect(JSON.stringify(f.state().audits)).not.toContain('Synthetic message');
  });

  it('returns the original share after response loss, with normalized payload and no repeat notification or audit', async () => {
    const f = fixture();
    const first = await f.sut.create('candidate', input, actor);
    f.recipients([]); // A retry returns the committed response, not a new grant.
    const second = await f.sut.create('candidate', { ...input, recipientIds: [...input.recipientIds].reverse(), message: input.message.trim() }, actor);
    expect(second).toEqual(first);
    expect(f.state().shares).toHaveLength(1);
    expect(f.state().notifications).toHaveLength(2);
    expect(f.state().audits).toHaveLength(1);
  });

  it.each(['candidate', 'actor', 'recipients', 'expiry', 'resume', 'message'])('rejects requestId reuse with a different %s', async change => {
    const f = fixture();
    await f.sut.create('candidate', input, actor);
    const changed = { ...input, ...(change === 'recipients' ? { recipientIds: ['recipient-c'] } : {}),
      ...(change === 'expiry' ? { expiresInDays: 30 } : {}), ...(change === 'resume' ? { includeResume: true } : {}),
      ...(change === 'message' ? { message: 'Different' } : {}) };
    await expect(f.sut.create(change === 'candidate' ? 'other' : 'candidate', changed,
      change === 'actor' ? { ...actor, id: 'other' } : actor)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().shares).toHaveLength(1);
    expect(f.state().notifications).toHaveLength(2);
  });

  it('validates live recipients inside the transaction before creating anything', async () => {
    const f = fixture();
    f.recipients(['recipient-a']);
    await expect(f.sut.create('candidate', input, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.trace.slice(0, 2)).toEqual(['tx:lock', 'tx:candidate']);
    expect(f.trace).toContain('tx:employment');
    expect(f.trace).toContain('tx:recipients');
    expect(f.state()).toEqual({ shares: [], notifications: [], audits: [] });
  });

  it('does not share a deleted candidate after taking its lock', async () => {
    const f = fixture();
    f.candidate.deletedAt = new Date();
    await expect(f.sut.create('candidate', input, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.state().shares).toHaveLength(0);
  });

  it('retains optional requestId compatibility for old clients', async () => {
    const f = fixture();
    const { requestId: _ignored, ...legacy } = input;
    await f.sut.create('candidate', legacy, actor);
    await f.sut.create('candidate', legacy, actor);
    expect(f.state().shares).toHaveLength(2);
    expect(f.state().notifications).toHaveLength(4);
  });

  it('accepts absent or UUID requestId but rejects arbitrary strings at the HTTP boundary', async () => {
    const valid = { recipientIds: [requestId], expiresInDays: 7 };
    expect(await validate(plainToInstance(CreateShareDto, { ...valid, requestId }))).toEqual([]);
    expect(await validate(plainToInstance(CreateShareDto, valid))).toEqual([]);
    expect((await validate(plainToInstance(CreateShareDto, { ...valid, requestId: 'invalid' }))).map(e => e.property)).toContain('requestId');
  });
});
