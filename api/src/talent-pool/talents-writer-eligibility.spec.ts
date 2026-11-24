import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { TalentsService } from './talents.service';
import { talentEditVersion } from './talent-edit-version';

const operator = { id: 'writer', sysRole: 'hr', hrCapabilities: ['employee_archive_edit'] } as AuthUser;

function fixture(revoked = false) {
  const row = { id: 'candidate', name: 'Synthetic applicant', phone: '17000000000', status: 'new',
    note: 'Before', deletedAt: null, updatedAt: new Date('2026-01-01T00:00:00Z'), files: [], followUps: [] };
  const trace: string[] = [];
  const actor = { id: operator.id, sysRole: 'hr_user', status: 'active', archivedAt: null, deletedAt: null,
    isAssessorOnly: false, hrCapabilities: revoked ? ['recruitment_view'] : ['employee_archive_edit'] };
  const tx = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) => { trace.push(sql.join('').includes('talent_candidates') ? 'candidate-lock' : 'actor-lock'); return []; }),
    user: { findUnique: jest.fn(async () => { trace.push('actor-read'); return actor; }), findFirst: jest.fn(async () => actor) },
    talentCandidate: {
      findFirst: jest.fn(async () => { trace.push('candidate-read'); return { ...row }; }),
      findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async ({ data }) => { trace.push('write'); Object.assign(row, data); return { ...row }; }),
      create: jest.fn(async ({ data }) => ({ ...row, ...data })),
    },
    auditLog: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
  return { row, actor, trace, tx, prisma, service: new TalentsService(prisma as never) };
}

describe('talent writes use current eligibility under the business lock', () => {
  it('lets a current explicit operator create and edit under fresh locks, never delete or export', async () => {
    const f = fixture();
    Object.assign(f.actor, { sysRole: 'employee', hrCapabilities: ['recruitment_edit'] });
    await expect(f.service.update(f.row.id, { note: 'Operator edit', editVersion: talentEditVersion(f.row as never) }, operator)).resolves.toMatchObject({ note: 'Operator edit' });
    expect(f.trace.slice(0, 3)).toEqual(['candidate-lock', 'actor-lock', 'actor-read']);
    await expect(f.service.remove(f.row.id, operator)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.exportApplications({} as never, operator)).rejects.toBeInstanceOf(ForbiddenException);
    f.tx.talentCandidate.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.service.create({ name: 'Synthetic operator candidate', phone: '17000000001', sourceChannel: 'other' }, operator)).resolves.toMatchObject({ name: 'Synthetic operator candidate' });
  });
  it('rejects an operator changed to view-only after the candidate lock', async () => {
    const f = fixture(true);
    const request = { ...operator, sysRole: 'employee', hrCapabilities: ['recruitment_edit'] } as AuthUser;
    await expect(f.service.update(f.row.id, { note: 'Denied', editVersion: talentEditVersion(f.row as never) }, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.talentCandidate.update).not.toHaveBeenCalled();
  });
  it('rejects an editor revoked while its candidate lock was queued, despite old session claims', async () => {
    const f = fixture(true);
    await expect(f.service.update(f.row.id, { note: 'After', editVersion: talentEditVersion(f.row as never) }, operator))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(f.row.note).toBe('Before');
    expect(f.tx.talentCandidate.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not soft-delete after the writer loses maintenance eligibility', async () => {
    const f = fixture(true);
    await expect(f.service.remove(f.row.id, operator)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.row.deletedAt).toBeNull();
    expect(f.tx.talentCandidate.update).not.toHaveBeenCalled();
  });

  it('locks and reads the current actor after the candidate lock before making a change', async () => {
    const f = fixture();
    await expect(f.service.update(f.row.id, { note: 'After', editVersion: talentEditVersion(f.row as never) }, operator))
      .resolves.toMatchObject({ note: 'After' });
    expect(f.trace).toEqual(['candidate-lock', 'actor-lock', 'actor-read', 'candidate-read', 'write']);
    expect(f.tx.$queryRaw.mock.calls[1][0].join('')).toContain('FOR SHARE');
  });
});
