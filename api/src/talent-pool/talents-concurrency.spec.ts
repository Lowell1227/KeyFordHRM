import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from './talents.service';
import { talentEditVersion } from './talent-edit-version';

const operator = { id: 'hr-editor' } as AuthUser;

function fixture() {
  const before = {
    id: 'candidate', name: 'Synthetic talent', phone: '17000000000',
    status: 'interviewing', convertedUserId: null as string | null,
    convertedAt: null as Date | null, deletedAt: null as Date | null,
    updatedAt: new Date('2026-11-16T01:00:00.000Z'),
    expectSalaryMin: 10, expectSalaryMax: 20, note: 'Original',
  };
  const row = { ...before };
  const trace: string[] = [];
  const read = jest.fn(async (_args: any) => { trace.push('read'); return row.deletedAt ? null : { ...row }; });
  const write = jest.fn(async ({ data }) => {
    trace.push('write'); Object.assign(row, data); return { ...row, files: [], followUps: [] };
  });
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray, ..._values: unknown[]) => { trace.push(sql.join('').includes('FROM users') ? 'actor-lock' : 'lock'); return [{ id: row.id }]; }),
    user: { findUnique: jest.fn().mockResolvedValue({ id: operator.id, sysRole: 'hr', status: 'active', archivedAt: null, deletedAt: null, isAssessorOnly: false }) },
    talentCandidate: { findFirst: read, update: write },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    // An outside read misses the writer that finishes while the row lock is acquired.
    talentCandidate: { findFirst: jest.fn(async () => ({ ...before })), update: write },
    $transaction: jest.fn(async callback => callback(tx)),
  };
  return { row, tx, prisma, trace, service: new TalentsService(prisma as never) };
}

describe('TalentsService concurrent editing boundary', () => {
  it('rejects a stale status after arrival wins the row lock, preserving ordinary fields', async () => {
    const f = fixture();
    Object.assign(f.row, { status: 'hired', convertedUserId: 'employee', convertedAt: new Date() });
    await expect(f.service.update(f.row.id, { status: 'contacted', note: 'Stale edit' }, operator))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ data: { reason: 'TALENT_EDIT_CONFLICT' } }) });
    expect(f.row).toMatchObject({ status: 'hired', convertedUserId: 'employee', note: 'Original' });
    expect(f.tx.talentCandidate.update).not.toHaveBeenCalled();
  });

  it('locks before reading and validates/writes using the same transaction', async () => {
    const f = fixture();
    await expect(f.service.update(f.row.id, { note: 'Current edit', editVersion: talentEditVersion(f.row as never) }, operator))
      .resolves.toMatchObject({ note: 'Current edit', files: [], followUps: [] });
    expect(f.trace).toEqual(['lock', 'actor-lock', 'read', 'write']);
    expect(f.tx.$queryRaw.mock.calls[1][0].join('?')).toContain('FOR SHARE');
    expect(f.prisma.talentCandidate.findFirst).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(f.tx.$queryRaw.mock.calls[0][1]).toBe(f.row.id);
  });

  it('does not edit a candidate deleted before its row lock is acquired', async () => {
    const f = fixture();
    f.row.deletedAt = new Date();
    await expect(f.service.update(f.row.id, { note: 'Stale edit' }, operator)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.row.note).toBe('Original');
  });

  it('validates partial salary changes against the latest same-talent edit', async () => {
    const f = fixture();
    f.row.expectSalaryMax = 15;
    await expect(f.service.update(f.row.id, { expectSalaryMin: 18, editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.row).toMatchObject({ expectSalaryMin: 10, expectSalaryMax: 15 });
  });

  it.each([undefined, 'hired'] as const)('allows ordinary fields after reload (status=%s)', async status => {
    const f = fixture();
    Object.assign(f.row, { status: 'hired', convertedUserId: 'employee', convertedAt: new Date() });
    const convertedAt = f.row.convertedAt;
    await expect(f.service.update(f.row.id, { note: 'Current edit', editVersion: talentEditVersion(f.row as never), ...(status ? { status } : {}) }, operator))
      .resolves.toMatchObject({ status: 'hired', convertedUserId: 'employee', convertedAt,
        note: 'Current edit', files: [], followUps: [] });
    await expect(f.service.update(f.row.id, { status: 'contacted', editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps manual hire/link restrictions and ordinary status transitions', async () => {
    const f = fixture();
    await expect(f.service.update(f.row.id, { status: 'hired', editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.update(f.row.id, { userId: 'employee', editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.update(f.row.id, { status: 'contacted', editVersion: talentEditVersion(f.row as never) }, operator)).resolves.toMatchObject({ status: 'contacted' });
  });

  it('retains phone-conflict handling after a transaction loses the unique-index race', async () => {
    const f = fixture();
    f.tx.talentCandidate.findFirst.mockResolvedValueOnce(f.row).mockResolvedValueOnce(null);
    f.tx.talentCandidate.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Synthetic unique collision', {
      code: 'P2002', clientVersion: '5.20.0',
    }));
    f.prisma.talentCandidate.findFirst.mockResolvedValue({ ...f.row, id: 'other' });
    await expect(f.service.update(f.row.id, { phone: '17000000001', editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toMatchObject({
      status: 409, response: expect.objectContaining({ data: expect.objectContaining({ reason: 'TALENT_PHONE_EXISTS' }) }),
    });
  });

  it('does not disguise unrelated database errors as conflicts', async () => {
    const f = fixture();
    const failure = new Error('Synthetic database failure');
    f.tx.talentCandidate.update.mockRejectedValueOnce(failure);
    await expect(f.service.update(f.row.id, { note: 'Attempt', editVersion: talentEditVersion(f.row as never) }, operator)).rejects.toBe(failure);
  });
});
