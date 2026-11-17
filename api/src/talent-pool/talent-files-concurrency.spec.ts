import { NotFoundException } from '@nestjs/common';
import type { TalentResumeFile } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { TALENT_FILE_LIMIT } from './talent.constants';
import { TalentFilesService } from './talent-files.service';
import { TalentsService } from './talents.service';

const HR = { id: 'hr-1', name: 'HR', sysRole: 'hr', deptId: null, isAssessorOnly: false, canViewAll: false } as AuthUser;
const INPUT = { objectKey: 'talent-resume/new.pdf', fileName: 'resume.pdf', mimeType: 'application/pdf', fileSize: 1024 };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(initialCount = 0) {
  const candidates = new Map(['cand-1', 'cand-2'].map((id) => [id, { id, deletedAt: null as Date | null }]));
  const files: TalentResumeFile[] = Array.from({ length: initialCount }, (_, index) => ({
    id: `existing-${index}`, candidateId: 'cand-1', objectKey: `talent-resume/existing-${index}.pdf`,
    fileName: 'original.pdf', mimeType: 'application/pdf', fileSize: 2048,
    sortOrder: index, uploadedById: HR.id, createdAt: new Date('2026-11-17T00:00:00Z'),
  }));
  const talentCandidate = {
    findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt: null } }) => {
      const candidate = candidates.get(where.id);
      return candidate && candidate.deletedAt === where.deletedAt ? { ...candidate } : null;
    }),
  };
  const talentResumeFile = {
    count: jest.fn(async ({ where }: { where: { candidateId: string } }) => files.filter((file) => file.candidateId === where.candidateId).length),
    findFirst: jest.fn(async ({ where }: { where: { candidateId: string; objectKey: string } }) =>
      files.find((file) => file.candidateId === where.candidateId && file.objectKey === where.objectKey) ?? null),
    create: jest.fn(async ({ data }: { data: Omit<TalentResumeFile, 'id' | 'createdAt'> }) => {
      const file = { ...data, id: `created-${files.length}`, createdAt: new Date('2026-11-17T00:00:00Z') };
      files.push(file);
      return file;
    }),
  };
  // Model candidate-scoped PostgreSQL row locks without opening a database connection.
  const locks = new Map<string, Promise<void>>();
  const prisma = {
    talentCandidate, talentResumeFile,
    $transaction: jest.fn(async (run: (tx: any) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const tx = {
        talentCandidate, talentResumeFile,
        $queryRaw: async (sql: TemplateStringsArray, id: string) => {
          expect(sql.join('?')).toBe('SELECT id FROM talent_candidates WHERE id = ?::uuid FOR UPDATE');
          const previous = locks.get(id) ?? Promise.resolve();
          const current = deferred();
          locks.set(id, current.promise);
          await previous;
          release = current.resolve;
          return candidates.has(id) ? [{ id }] : [];
        },
      };
      try { return await run(tx); } finally { release?.(); }
    }),
  };
  const talents = new TalentsService(prisma as never);
  const storage = { statObject: jest.fn(async (_objectKey: string) => ({ size: 2048, metaData: { 'content-type': 'application/pdf' } })) };
  const service = () => new TalentFilesService(talents, storage as never, prisma as never);
  return { sut: service(), second: service(), prisma, storage, candidates, files };
}

describe('TalentFilesService candidate-scoped binding concurrency', () => {
  it('allows only one of two distinct uploads when two files already exist', async () => {
    const { sut, second, files } = setup(2);
    const results = await Promise.allSettled([
      sut.bind('cand-1', INPUT, HR),
      second.bind('cand-1', { ...INPUT, objectKey: 'talent-resume/other.pdf' }, HR),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { response: { data: { reason: TALENT_FILE_LIMIT } } },
    });
    expect(files).toHaveLength(3);
    expect(files.map((file) => file.sortOrder)).toEqual([0, 1, 2]);
  });

  it('returns the same record for concurrent retries without consuming the last slot twice', async () => {
    const { sut, second, files, storage } = setup(2);
    const [first, retried] = await Promise.all([
      sut.bind('cand-1', INPUT, HR),
      second.bind('cand-1', { ...INPUT, objectKey: ` ${INPUT.objectKey} `, fileName: 'retry.pdf' }, HR),
    ]);

    expect(first.id).toBe(retried.id);
    expect(files).toHaveLength(3);
    expect(files.filter((file) => file.objectKey === INPUT.objectKey)).toHaveLength(1);
    expect(storage.statObject).toHaveBeenCalledTimes(2);
  });

  it('returns the original binding at capacity without changing its metadata', async () => {
    const { sut, files } = setup(3);
    const original = { ...files[0] };

    await expect(sut.bind('cand-1', { ...INPUT, objectKey: original.objectKey, fileName: 'renamed.pdf' }, HR))
      .resolves.toEqual(original);
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual(original);
  });

  it('rejects a binding if deletion commits while storage validation is in flight', async () => {
    const { sut, storage, candidates, files } = setup(2);
    const checking = deferred();
    const checked = deferred();
    storage.statObject.mockImplementationOnce(async () => {
      checking.resolve();
      await checked.promise;
      return { size: 2048, metaData: { 'content-type': 'application/pdf' } };
    });
    const binding = sut.bind('cand-1', INPUT, HR);
    const rejected = expect(binding).rejects.toThrow(NotFoundException);
    await checking.promise;
    candidates.get('cand-1')!.deletedAt = new Date('2026-11-17T01:00:00Z');
    checked.resolve();

    await rejected;
    expect(files).toHaveLength(2);
  });

  it('rechecks deletion after waiting for the candidate row lock', async () => {
    const { sut, prisma, storage, candidates, files } = setup(2);
    const locked = deferred();
    const release = deferred();
    const checked = deferred();
    const deleting = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${'cand-1'}::uuid FOR UPDATE`;
      locked.resolve();
      await release.promise;
      candidates.get('cand-1')!.deletedAt = new Date('2026-11-17T01:00:00Z');
    });
    await locked.promise;
    storage.statObject.mockImplementationOnce(async () => {
      checked.resolve();
      return { size: 2048, metaData: { 'content-type': 'application/pdf' } };
    });
    const binding = sut.bind('cand-1', INPUT, HR);
    const rejected = expect(binding).rejects.toThrow(NotFoundException);
    await checked.promise;
    release.resolve();

    await deleting;
    await rejected;
    expect(files).toHaveLength(2);
  });

  it('does not share object-key identity or row locks across candidates', async () => {
    const { sut, second, prisma, files } = setup();
    const locked = deferred();
    const release = deferred();
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM talent_candidates WHERE id = ${'cand-1'}::uuid FOR UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const blocked = sut.bind('cand-1', INPUT, HR);
    let other: Awaited<ReturnType<TalentFilesService['bind']>>;
    try {
      other = await second.bind('cand-2', INPUT, HR);
      expect(files.filter((file) => file.candidateId === 'cand-2')).toHaveLength(1);
    } finally {
      release.resolve();
      await blocker;
    }
    const first = await blocked;

    expect(first.id).not.toBe(other.id);
    expect(files.filter((file) => file.candidateId === 'cand-1')).toHaveLength(1);
  });
});
